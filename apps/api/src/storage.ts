import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import type {
  Tournament,
  Player,
  Audit,
} from "../../../packages/contracts/src/index.js";
import type { CrudInterface } from "brackets-model";
import {
  emptyPhase,
  phaseTables,
  type Account,
  type AccountSession,
  type PhaseState,
} from "./phase-types.js";

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
      db[table].findMany({ orderBy: { id: "asc" } }),
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
        where: { id: record.id },
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
  private prisma = process.env.DATABASE_URL ? new PrismaClient() : undefined;
  private file = process.env.DATA_FILE
    ? resolve(process.env.DATA_FILE)
    : resolve(
        existsSync(resolve("prisma/schema.prisma")) ? "." : "../..",
        "data/knockout.json",
      );
  private queue: Promise<unknown> = Promise.resolve();
  private pendingRead?: Promise<State>;
  // Reads are served from memory until the next write (or a short TTL, which
  // also covers CLI scripts that write to the database directly).
  private cache?: { state: State; at: number };
  private static readonly CACHE_TTL_MS = 5000;
  readonly mode = this.prisma ? "postgresql" : "local";
  private async read(): Promise<State> {
    if (this.prisma) {
      return this.prisma.$transaction(
        async (tx) => {
          const [t, p, phase] = await Promise.all([
            tx.tournament.findMany(),
            tx.player.findMany(),
            loadPhase(tx),
          ]);
          return {
            ...phase,
            tournaments: t.map(
              (x) => x.document as unknown as StoredTournament,
            ),
            players: p.map((x) => x.document as unknown as Player),
          };
        },
        { isolationLevel: "RepeatableRead", timeout: 30000, maxWait: 10000 },
      );
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
    if (this.cache && Date.now() - this.cache.at < Repository.CACHE_TTL_MS)
      return structuredClone(this.cache.state);
    if (!this.pendingRead)
      this.pendingRead = this.read()
        .then((state) => {
          this.cache = { state, at: Date.now() };
          return state;
        })
        .finally(() => {
          this.pendingRead = undefined;
        });
    return structuredClone(await this.pendingRead);
  }
  /** Auth hook lookup: two primary-key reads instead of loading every table. */
  async sessionContext(
    sessionId: string,
  ): Promise<{ session: AccountSession; account: Account } | undefined> {
    await this.queue;
    if (!this.prisma) {
      const s = await this.snapshot();
      const session = s.sessions.find((x) => x.id === sessionId);
      const account =
        session && s.accounts.find((u) => u.id === session.userId);
      return session && account ? { session, account } : undefined;
    }
    const session = await this.prisma.accountSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return undefined;
    const account = await this.prisma.account.findUnique({
      where: { id: session.userId },
    });
    return account
      ? {
          session: session as unknown as AccountSession,
          account: account as unknown as Account,
        }
      : undefined;
  }
  async mutate<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    const op = this.queue.then(async () => {
      await this.pendingRead;
      if (this.prisma) {
        return this.prisma.$transaction(
          async (tx) => {
            // A single database lock also guards ID allocation and player enrollment.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(751092)`;
            const [ts, ps, phase] = await Promise.all([
              tx.tournament.findMany(),
              tx.player.findMany(),
              loadPhase(tx),
            ]);
            const state: State = {
              ...phase,
              tournaments: ts.map(
                (x) => x.document as unknown as StoredTournament,
              ),
              players: ps.map((x) => x.document as unknown as Player),
            };
            const beforePhase = structuredClone(phase);
            const beforeTournaments = new Map(
              state.tournaments.map((t) => [t.id, JSON.stringify(t)]),
            );
            const beforePlayers = new Map(
              state.players.map((p) => [p.id, JSON.stringify(p)]),
            );
            const result = await fn(state);
            // Write only the documents this operation actually changed.
            for (const t of state.tournaments) {
              if (beforeTournaments.get(t.id) === JSON.stringify(t)) continue;
              await tx.tournament.upsert({
                where: { id: t.id },
                create: {
                  id: t.id,
                  revision: t.revision,
                  document: t as unknown as Prisma.InputJsonValue,
                },
                update: {
                  revision: t.revision,
                  document: t as unknown as Prisma.InputJsonValue,
                },
              });
            }
            for (const p of state.players) {
              if (beforePlayers.get(p.id) === JSON.stringify(p)) continue;
              await tx.player.upsert({
                where: { id: p.id },
                create: {
                  id: p.id,
                  document: p as unknown as Prisma.InputJsonValue,
                },
                update: { document: p as unknown as Prisma.InputJsonValue },
              });
            }
            await savePhase(tx, state, beforePhase);
            return result;
          },
          { timeout: 30000, maxWait: 10000 },
        );
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
    this.queue = op
      .catch(() => {})
      .then(() => {
        this.cache = undefined;
      });
    return op;
  }
  async ready() {
    if (this.prisma) await this.prisma.$queryRaw`SELECT 1`;
    else await this.snapshot();
  }
  async close() {
    await this.queue;
    await this.pendingRead;
    await this.prisma?.$disconnect();
  }
}
