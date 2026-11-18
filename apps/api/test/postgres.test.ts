import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository, audit, type StoredTournament } from "../src/storage.js";
import {
  newTournament,
  generate,
  report,
  serialize,
} from "../src/tournaments.js";
import { PrismaClient } from "@prisma/client";
import { makeAccount, passwordHash } from "../src/identity.js";
import {
  grant,
  entry,
  synchronize,
  place,
  settle,
} from "../src/predictions.js";

test(
  "PostgreSQL transactions persist engine, metadata, and audit atomically",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const repo = new Repository();
    const prisma = new PrismaClient();
    let tournamentId: number | undefined;
    const playerIds: string[] = [];
    try {
      await repo.ready();
      const saved = await repo.mutate(async (s) => {
        const id = Math.max(0, ...s.tournaments.map((t) => t.id)) + 1;
        const t = newTournament(id, {
          name: `Postgres test ${Date.now()}`,
          game: "Test",
          format: "single_elimination",
          bestOf: 3,
          capacity: 4,
          venue: "Test",
          date: new Date().toISOString(),
          prize: "",
          description: "",
        });
        tournamentId = id;
        for (let i = 0; i < 4; i++) {
          const p = {
            id: crypto.randomUUID(),
            name: `Test team ${i}`,
            tag: `T${i}`,
            color: "#ffa000",
            createdAt: new Date().toISOString(),
          };
          playerIds.push(p.id);
          s.players.push(p);
          t.entries.push({ ...p, seed: i + 1 });
        }
        await generate(t);
        s.tournaments.push(t);
        return serialize(t);
      });
      assert.equal(saved.matches.length, 3);
      await repo.mutate(async (s) => {
        const t = s.tournaments.find((t) => t.id === tournamentId)!;
        await report(t, 0, {
          homeScore: 2,
          awayScore: 1,
          revision: t.revision,
        });
      });
      const persisted = (
        await prisma.tournament.findUniqueOrThrow({
          where: { id: tournamentId },
        })
      ).document as unknown as StoredTournament;
      assert.equal(
        persisted.engine.match[2].opponent1.id,
        persisted.engine.match[0].opponent1.id,
      );
      assert.equal(persisted.audit[0].action, "RESULT_REPORTED");
      const before = await repo.snapshot();
      await assert.rejects(
        repo.mutate((s) => {
          const t = s.tournaments.find((t) => t.id === tournamentId)!;
          audit(t, "TEST", "Must roll back");
          throw new Error("rollback test");
        }),
      );
      assert.deepEqual(await repo.snapshot(), before);
      const restarted = new Repository();
      assert.deepEqual(await restarted.snapshot(), await repo.snapshot());
      await restarted.close();
      // Two competing score submissions with the same revision cannot both commit.
      const revision = persisted.revision;
      const competitor = new Repository();
      const op = (writer: Repository) =>
        writer.mutate(async (s) => {
          const t = s.tournaments.find((t) => t.id === tournamentId)!;
          await report(t, 1, { homeScore: 2, awayScore: 0, revision });
        });
      const outcomes = await Promise.allSettled([op(repo), op(competitor)]);
      await competitor.close();
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1);
    } finally {
      // Remove only records made by this test, never truncate a connected database.
      if (tournamentId !== undefined)
        await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      if (playerIds.length)
        await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
      await repo.close();
      await prisma.$disconnect();
    }
  },
);

test(
  "PostgreSQL wallet reservations serialize across independent writers and survive restart",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const first = new Repository(),
      second = new Repository(),
      db = new PrismaClient();
    let tid: number | undefined;
    let uid: string | undefined;
    const players: string[] = [];
    try {
      const hashed = await passwordHash("postgres-only-password");
      const setup = await first.mutate(async (s) => {
        const u = makeAccount(
          `pg-${crypto.randomUUID()}@test.local`,
          "Postgres predictor",
          hashed,
        );
        u.verified = true;
        uid = u.id;
        s.accounts.push(u);
        const id = Math.max(0, ...s.tournaments.map((t) => t.id)) + 1;
        tid = id;
        const t = newTournament(id, {
          name: "Postgres points test",
          game: "Test",
          format: "round_robin",
          date: new Date().toISOString(),
          venue: "Test",
          prize: "",
          bestOf: 1,
          capacity: 4,
          description: "",
        });
        for (let i = 0; i < 4; i++) {
          const p = {
            id: crypto.randomUUID(),
            name: `PG team ${i}`,
            tag: `P${i}`,
            color: "#ff7700",
            createdAt: new Date().toISOString(),
          };
          players.push(p.id);
          s.players.push(p);
          t.entries.push({ ...p, seed: i + 1 });
        }
        await generate(t);
        t.predictionsEnabled = true;
        s.tournaments.push(t);
        s.memberships.push({
          id: crypto.randomUUID(),
          userId: u.id,
          tournamentId: id,
          playerId: null,
          kind: "predictor",
          role: "participant",
          status: "approved",
          checkedIn: false,
          createdAt: new Date().toISOString(),
        });
        const wallet = grant(s, u, id, "test");
        entry(
          s,
          wallet,
          -75,
          0,
          "adjustment",
          `pg-adjust:${u.id}`,
          "Concurrency fixture balance",
          "test",
        );
        synchronize(s, t);
        return {
          user: u,
          markets: s.markets.filter((m) => m.tournamentId === id).slice(0, 2),
        };
      });
      const op = (repo: Repository, index: number) =>
        repo.mutate((s) =>
          place(
            s,
            s.tournaments.find((t) => t.id === tid)!,
            setup.user,
            setup.markets[index].id,
            "home",
            25,
          ),
        );
      const results = await Promise.allSettled([op(first, 0), op(second, 1)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected").length, 1);
      const snapshot = await first.snapshot(),
        wallet = snapshot.wallets.find((w) => w.userId === uid)!;
      assert.equal(wallet.available, 0);
      assert.equal(wallet.reserved, 25);
      assert.equal(
        snapshot.ledger.filter(
          (l) => l.walletId === wallet.id && l.kind === "grant",
        ).length,
        1,
      );
      const restarted = new Repository();
      assert.deepEqual(
        (await restarted.snapshot()).wallets.find((w) => w.id === wallet.id),
        wallet,
      );
      await restarted.close();
      await first.mutate(async (s) => {
        const t = s.tournaments.find((t) => t.id === tid)!;
        const pick = s.predictions.find(
          (p) => p.userId === uid && p.status === "reserved",
        )!;
        const market = s.markets.find((m) => m.id === pick.marketId)!;
        await report(t, market.matchId, {
          homeScore: 1,
          awayScore: 0,
          revision: t.revision,
        });
        settle(s, t, market, "test");
      });
      const after = (await first.snapshot()).wallets.find(
        (w) => w.id === wallet.id,
      )!;
      assert.equal(after.available, 25);
      assert.equal(after.reserved, 0);
      const concurrentReads = await Promise.all(
        Array.from({ length: 20 }, () => first.snapshot()),
      );
      assert.ok(
        concurrentReads.every(
          (s) => s.wallets.find((w) => w.id === wallet.id)?.available === 25,
        ),
      );
      concurrentReads[0].wallets.find((w) => w.id === wallet.id)!.available =
        999;
      assert.equal(
        (await first.snapshot()).wallets.find((w) => w.id === wallet.id)!
          .available,
        25,
      );
      await assert.rejects(
        db.wallet.update({ where: { id: wallet.id }, data: { available: -1 } }),
      );
    } finally {
      if (tid !== undefined) {
        const markets = await db.predictionMarket.findMany({
          where: { tournamentId: tid },
          select: { id: true },
        });
        await db.prediction.deleteMany({
          where: { marketId: { in: markets.map((m) => m.id) } },
        });
        await db.predictionMarket.deleteMany({ where: { tournamentId: tid } });
        const wallets = await db.wallet.findMany({
          where: { tournamentId: tid },
          select: { id: true },
        });
        await db.ledgerEntry.deleteMany({
          where: { walletId: { in: wallets.map((w) => w.id) } },
        });
        await db.wallet.deleteMany({ where: { tournamentId: tid } });
        await db.membership.deleteMany({ where: { tournamentId: tid } });
        await db.tournament.deleteMany({ where: { id: tid } });
      }
      if (uid) await db.account.deleteMany({ where: { id: uid } });
      if (players.length)
        await db.player.deleteMany({ where: { id: { in: players } } });
      await first.close();
      await second.close();
      await db.$disconnect();
    }
  },
);
