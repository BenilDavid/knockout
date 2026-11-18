import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type {
  Tournament,
  Player,
  Audit,
} from "../../../packages/contracts/src/index.js";
import type { CrudInterface } from "brackets-model";
import { emptyPhase, phaseTables, type PhaseState } from "./phase-types.js";
import service from "../../../service.mjs";

// The database arrives through the service declaration on Compute and under
// `prisma dev` (the boot stashes the connection in COMPOSER_DB_URL and
// `service.load()` hydrates the Prisma ORM 8 client from it). A process booted
// without the framework — the repository's file-backed tests and local
// scripts — has no service environment, and the repository keeps its
// file-backed mode.
const dbBinding = (() => {
  try {
    return service.load().db;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('missing required config param "url"')
    )
      return undefined;
    throw error;
  }
})();

export type EngineData = Record<string, Record<string, any>[]>;
export type StoredTournament = Omit<Tournament, "matches" | "rounds"> & {
  engine: EngineData;
  metadata: Record<
    string,
    {
      scheduledAt?: string;
      durationMinutes?: number;
      venue?: string;
      streamUrl?: string;
    }
  >;
};
export interface State extends PhaseState {
  tournaments: StoredTournament[];
  players: Player[];
}
export function normalizeState(value: Partial<State>): State {
  return { tournaments: [], players: [], ...emptyPhase(), ...value };
}
async function loadPhase(db: any): Promise<PhaseState> {
  const rows = await Promise.all(
    Object.values(phaseTables).map((table) =>
      db[table].orderBy((m: any) => m.id.asc()).all(),
    ),
  );
  return Object.fromEntries(
    Object.keys(phaseTables).map((key, i) => [key, rows[i]]),
  ) as unknown as PhaseState;
}
async function savePhase(db: any, state: State, before: PhaseState) {
  for (const record of before.ledger) {
    const current = state.ledger.find((l) => l.id === record.id);
    if (!current || JSON.stringify(record) !== JSON.stringify(current))
      throw new Error("Ledger entries are immutable.");
  }
  for (const w of state.wallets) {
    const entries = state.ledger.filter((l) => l.walletId === w.id);
    if (
      !Number.isSafeInteger(w.available) ||
      !Number.isSafeInteger(w.reserved) ||
      w.available < 0 ||
      w.reserved < 0 ||
      entries.reduce((n, l) => n + l.availableDelta, 0) !== w.available ||
      entries.reduce((n, l) => n + l.reservedDelta, 0) !== w.reserved
    )
      throw new Error("Wallet ledger does not reconcile.");
  }
  for (const [key, table] of Object.entries(phaseTables)) {
    const prior = before[key as keyof PhaseState] as any[];
    for (const record of state[key as keyof PhaseState] as any[]) {
      const old = prior.find((r) => r.id === record.id);
      if (JSON.stringify(old) === JSON.stringify(record)) continue;
      if (key === "ledger" && old)
        throw new Error("Ledger entries are immutable.");
      await db[table].upsert({
        create: record,
        update: record,
      });
    }
  }
}
export const emptyEngine = (): EngineData => ({
  participant: [],
  stage: [],
  group: [],
  round: [],
  match: [],
  match_game: [],
});

/** Isolated working copy: a failed manager operation never leaks into saved state. */
export class BracketStorage {
  constructor(public data: EngineData) {}
  private rows(table: string) {
    return this.data[table] ?? (this.data[table] = []);
  }
  private matches(row: Record<string, any>, filter: Record<string, any>) {
    return Object.entries(filter).every(
      ([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v),
    );
  }
  async insert(table: string, value: any): Promise<any> {
    if (Array.isArray(value)) {
      for (const item of value) await this.insert(table, item);
      return true;
    }
    const rows = this.rows(table);
    const id = Math.max(-1, ...rows.map((r) => Number(r.id))) + 1;
    rows.push(structuredClone({ ...value, id }));
    return id;
  }
  async select(table: string, query?: any): Promise<any> {
    const rows = this.rows(table);
    if (query === undefined) return structuredClone(rows);
    if (typeof query !== "object")
      return structuredClone(rows.find((r) => r.id === query) ?? null);
    return structuredClone(rows.filter((r) => this.matches(r, query)));
  }
  async update(table: string, query: any, value: any) {
    const rows = this.rows(table).filter((r) =>
      typeof query === "object" ? this.matches(r, query) : r.id === query,
    );
    for (const row of rows) Object.assign(row, structuredClone(value));
    return rows.length > 0;
  }
  async delete(table: string, filter?: any) {
    this.data[table] = filter
      ? this.rows(table).filter((r) => !this.matches(r, filter))
      : [];
    return true;
  }
  asInterface() {
    return this as CrudInterface;
  }
}

export function audit(
  t: StoredTournament,
  action: string,
  detail: string,
  before?: unknown,
  after?: unknown,
) {
  const record: Audit = {
    id: crypto.randomUUID(),
    action,
    detail,
    at: new Date().toISOString(),
  };
  if (before !== undefined) record.before = before;
  if (after !== undefined) record.after = after;
  t.audit.unshift(record);
  t.revision++;
}

export class Repository {
  private db = dbBinding?.client;
  private file = process.env.DATA_FILE
    ? resolve(process.env.DATA_FILE)
    : resolve(
        existsSync(resolve("prisma/schema.prisma")) ? "." : "../..",
        "data/knockout.json",
      );
  private queue: Promise<unknown> = Promise.resolve();
  private pendingRead?: Promise<State>;
  // The service's database backs the app unless the process opted into the
  // file-backed store (the repository's tests and file-backed deployments set
  // DATA_FILE).
  private readonly useDb = Boolean(this.db) && !process.env.DATA_FILE;
  readonly mode = this.useDb ? "postgresql" : "local";
  private async read(): Promise<State> {
    if (this.db && this.useDb) {
      return this.db.transaction(async (tx) => {
        const [t, p, phase] = await Promise.all([
          tx.orm.public.Tournament.all(),
          tx.orm.public.Player.all(),
          loadPhase(tx.orm.public),
        ]);
        return {
          ...phase,
          tournaments: t.map(
            (x) => x.document as unknown as StoredTournament,
          ),
          players: p.map((x) => x.document as unknown as Player),
        };
      });
    }
    try {
      return normalizeState(JSON.parse(await readFile(this.file, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return normalizeState({});
      throw e;
    }
  }
  async snapshot() {
    await this.queue;
    if (!this.pendingRead)
      this.pendingRead = this.read().finally(() => {
        this.pendingRead = undefined;
      });
    return structuredClone(await this.pendingRead);
  }
  async mutate<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    const op = this.queue.then(async () => {
      await this.pendingRead;
      if (this.db && this.useDb) {
        return this.db.transaction(async (tx) => {
          // A single database lock also guards ID allocation and player enrollment.
          await tx.execute(
            tx.raw.sql`SELECT pg_advisory_xact_lock(751092)`.affectedCount().build(),
          );
          const [ts, ps, phase] = await Promise.all([
            tx.orm.public.Tournament.all(),
            tx.orm.public.Player.all(),
            loadPhase(tx.orm.public),
          ]);
          const state: State = {
            ...phase,
            tournaments: ts.map(
              (x) => x.document as unknown as StoredTournament,
            ),
            players: ps.map((x) => x.document as unknown as Player),
          };
          const beforePhase = structuredClone(phase);
          const result = await fn(state);
          for (const t of state.tournaments)
            await tx.orm.public.Tournament.upsert({
              create: {
                id: t.id,
                revision: t.revision,
                document: t as unknown as any,
              },
              update: {
                revision: t.revision,
                document: t as unknown as any,
              },
            });
          for (const p of state.players)
            await tx.orm.public.Player.upsert({
              create: {
                id: p.id,
                document: p as unknown as any,
              },
              update: { document: p as unknown as any },
            });
          await savePhase(tx.orm.public, state, beforePhase);
          return result;
        });
      }
      const state = await this.read();
      const previous = structuredClone(state);
      const result = await fn(state);
      // Apply the same balance and immutability checks in file-backed tests.
      await savePhase(
        new Proxy({}, { get: () => ({ upsert: async () => {} }) }),
        state,
        previous,
      );
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(state, null, 2));
      await rename(`${this.file}.tmp`, this.file);
      return result;
    });
    this.queue = op.catch(() => {});
    return op;
  }
  async ready() {
    if (this.db && this.useDb)
      await this.db.execute(this.db.raw.sql`SELECT 1`.affectedCount().build());
    else await this.snapshot();
  }
  async close() {
    await this.queue;
    await this.pendingRead;
    if (this.db && this.useDb) await this.db.close();
  }
}
