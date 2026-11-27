import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { Repository } from "../src/storage.js";
import { makeAccount, passwordHash } from "../src/identity.js";
import type { Tournament } from "../../../packages/contracts/src/index.js";

test("tournament lifecycle, persistence, validation, and isolation", async (ctx) => {
  const dir = await mkdtemp(join(tmpdir(), "knockout-test-"));
  process.env.DATA_FILE = join(dir, "state.json");
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_KEY;
  const { app, repo } = await createApp({ seedDemo: false, logger: false });
  await repo.mutate(async (s) => {
    s.accounts.push(
      makeAccount(
        "admin@test.local",
        "Test admin",
        await passwordHash("test-password-123"),
        true,
      ),
    );
  });
  const signed = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "x-knockout-client": "web" },
    payload: { email: "admin@test.local", password: "test-password-123" },
  });
  const authCookie = signed.headers["set-cookie"]!.toString().split(";")[0];
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    expected = 200,
  ) => {
    const res = await app.inject({
      method: method as any,
      url: `/api${path}`,
      headers: { "x-knockout-client": "web", cookie: authCookie },
      ...(body === undefined ? {} : { payload: body as any }),
    });
    assert.equal(res.statusCode, expected, `${method} ${path}: ${res.body}`);
    return res.json();
  };
  const make = async (
    name = "Integration Cup",
    format = "single_elimination",
    count = 4,
    bestOf = 3,
  ) => {
    let t: Tournament = await request(
      "POST",
      "/tournaments",
      {
        name,
        game: "Test Game",
        format,
        capacity: 8,
        bestOf,
        date: "2026-11-01T10:00:00.000Z",
      },
      201,
    );
    for (let i = 0; i < count; i++) {
      const p = await request(
        "POST",
        "/players",
        { name: `${name} Team ${i + 1}`, tag: `T${i + 1}` },
        201,
      );
      t = await request("POST", `/tournaments/${t.id}/entries`, {
        playerId: p.id,
      });
    }
    return t;
  };
  try {
    await ctx.test(
      "creates players, seeds, and generates through brackets-manager",
      async () => {
        let t = await make();
        const ids = t.entries.map((e) => e.id).reverse();
        t = await request("PATCH", `/tournaments/${t.id}/seeding`, {
          entryIds: ids,
        });
        assert.equal(t.entries[0].id, ids[0]);
        t = await request("POST", `/tournaments/${t.id}/stages`);
        assert.equal(t.matches.length, 3);
        assert.equal(t.rounds.length, 2);
        assert.equal(t.status, "live");
        assert.equal(t.matches[0].home?.name, t.entries[0].name);
        await request("POST", `/tournaments/${t.id}/stages`, undefined, 409);
        await request(
          "PATCH",
          `/tournaments/${t.id}/seeding`,
          { entryIds: ids },
          409,
        );
        await request(
          "DELETE",
          `/tournaments/${t.id}/entries/${ids[0]}`,
          undefined,
          409,
        );
      },
    );
    await ctx.test(
      "advances winners, rejects stale updates, completes the final",
      async () => {
        let t: Tournament = await request("GET", "/tournaments/1");
        const oldRev = t.revision;
        t = await request("PATCH", `/tournaments/1/matches/0/result`, {
          homeScore: 2,
          awayScore: 1,
          revision: t.revision,
        });
        assert.equal(t.matches[2].home?.id, t.matches[0].home?.id);
        await request(
          "PATCH",
          "/tournaments/1/matches/1/result",
          { homeScore: 2, awayScore: 0, revision: oldRev },
          409,
        );
        t = await request("PATCH", "/tournaments/1/matches/1/result", {
          homeScore: 2,
          awayScore: 0,
          revision: t.revision,
        });
        t = await request("PATCH", "/tournaments/1/matches/2/result", {
          homeScore: 2,
          awayScore: 1,
          revision: t.revision,
        });
        assert.equal(t.status, "completed");
        assert.equal(
          t.matches.filter(
            (m) => m.home?.result === "win" || m.away?.result === "win",
          ).length,
          3,
        );
      },
    );
    await ctx.test(
      "invalid scores roll back without changing revision or audit",
      async () => {
        let t = await make("Rollback Cup");
        t = await request("POST", `/tournaments/${t.id}/stages`);
        const before = await repo.snapshot();
        await request(
          "PATCH",
          `/tournaments/${t.id}/matches/0/result`,
          { homeScore: 1, awayScore: 1, revision: t.revision },
          400,
        );
        await request(
          "PATCH",
          `/tournaments/${t.id}/matches/0/result`,
          { homeScore: -1, awayScore: 2, revision: t.revision },
          400,
        );
        await request(
          "PATCH",
          `/tournaments/${t.id}/matches/0/result`,
          { homeScore: 3, awayScore: 1, revision: t.revision },
          400,
        );
        assert.deepEqual(await repo.snapshot(), before);
      },
    );
    await ctx.test(
      "requires correction reasons and preserves audit before/after",
      async () => {
        let t: Tournament = await request("GET", "/tournaments/2");
        t = await request("PATCH", "/tournaments/2/matches/0/result", {
          homeScore: 2,
          awayScore: 0,
          revision: t.revision,
        });
        await request(
          "PATCH",
          "/tournaments/2/matches/0/result",
          { homeScore: 0, awayScore: 2, revision: t.revision },
          409,
        );
        await request(
          "PATCH",
          "/tournaments/2/matches/0/override",
          { homeScore: 0, awayScore: 2, revision: t.revision },
          400,
        );
        t = await request("PATCH", "/tournaments/2/matches/0/override", {
          homeScore: 0,
          awayScore: 2,
          revision: t.revision,
          reason: "Scores were reversed",
        });
        assert.equal(t.matches[2].home?.id, t.matches[0].away?.id);
        assert.equal(t.audit[0].action, "RESULT_CORRECTED");
        assert.ok(t.audit[0].before);
        assert.ok(t.audit[0].after);
      },
    );
    await ctx.test(
      "correcting an earlier match with completed downstream matches is atomic",
      async () => {
        const t: Tournament = await request("GET", "/tournaments/1");
        const before = await repo.snapshot();
        const res = await app.inject({
          method: "PATCH",
          url: "/api/tournaments/1/matches/0/override",
          headers: { "x-knockout-client": "web", cookie: authCookie },
          payload: {
            homeScore: 0,
            awayScore: 2,
            revision: t.revision,
            reason: "Test locked dependency",
          },
        });
        assert.ok(res.statusCode >= 400);
        assert.deepEqual(await repo.snapshot(), before);
      },
    );
    await ctx.test(
      "bracket IDs are scoped to the tournament and forfeits advance the opponent",
      async () => {
        let t = await make("Forfeit Cup");
        t = await request("POST", `/tournaments/${t.id}/stages`);
        const otherBefore = await request("GET", "/tournaments/2");
        t = await request("PATCH", `/tournaments/${t.id}/matches/0/result`, {
          homeScore: 0,
          awayScore: 0,
          forfeit: "home",
          revision: t.revision,
        });
        assert.equal(t.matches[0].away?.result, "win");
        assert.equal(t.matches[2].home?.id, t.matches[0].away?.id);
        assert.deepEqual(await request("GET", "/tournaments/2"), otherBefore);
      },
    );
    await ctx.test(
      "BYEs preserve slots and automatically advance participants",
      async () => {
        let t = await make("BYE Cup", "single_elimination", 3);
        t = await request("POST", `/tournaments/${t.id}/stages`);
        assert.equal(t.matches.length, 3);
        assert.ok(t.matches.some((m) => !m.home || !m.away));
        let guard = 0;
        while (t.status !== "completed" && guard++ < 5) {
          const m = t.matches.find(
            (m) =>
              m.home?.id != null &&
              m.away?.id != null &&
              !m.home?.result &&
              !m.away?.result,
          );
          assert.ok(m, "a playable match should exist");
          t = await request(
            "PATCH",
            `/tournaments/${t.id}/matches/${m.id}/result`,
            { homeScore: 2, awayScore: 0, revision: t.revision },
          );
        }
        assert.equal(t.status, "completed");
      },
    );
    await ctx.test(
      "round robin generates all pairings and accepts draws",
      async () => {
        let t = await make("League Cup", "round_robin", 4, 1);
        t = await request("POST", `/tournaments/${t.id}/stages`);
        assert.equal(t.matches.length, 6);
        for (const m of t.matches)
          t = await request(
            "PATCH",
            `/tournaments/${t.id}/matches/${m.id}/result`,
            { homeScore: 1, awayScore: 1, revision: t.revision },
          );
        assert.equal(t.matches[0].home?.result, "draw");
        assert.equal(t.status, "completed");
      },
    );
    await ctx.test(
      "double elimination progresses to completion without manual propagation",
      async () => {
        let t = await make("Double Cup", "double_elimination");
        t = await request("POST", `/tournaments/${t.id}/stages`);
        assert.ok(new Set(t.rounds.map((r) => r.group)).size >= 3);
        for (let guard = 0; guard < 20 && t.status !== "completed"; guard++) {
          const m = t.matches.find(
            (m) =>
              m.home?.id != null &&
              m.away?.id != null &&
              !m.home?.result &&
              !m.away?.result,
          );
          assert.ok(
            m,
            "double elimination must always provide next playable match",
          );
          t = await request(
            "PATCH",
            `/tournaments/${t.id}/matches/${m.id}/result`,
            { homeScore: 2, awayScore: 0, revision: t.revision },
          );
        }
        assert.equal(t.status, "completed");
      },
    );
    await ctx.test(
      "registration validates capacity and duplicate entries; removal reseeds",
      async () => {
        let t = await make("Registration Cup", "single_elimination", 2);
        await request(
          "POST",
          `/tournaments/${t.id}/entries`,
          { playerId: t.entries[0].id },
          409,
        );
        t = await request(
          "DELETE",
          `/tournaments/${t.id}/entries/${t.entries[0].id}`,
        );
        assert.equal(t.entries.length, 1);
        assert.equal(t.entries[0].seed, 1);
        await request("POST", `/tournaments/${t.id}/stages`, undefined, 400);
      },
    );
    await ctx.test("bulk registration is atomic and ordered", async () => {
      let t = await make("Bulk Cup", "single_elimination", 1);
      const ids: string[] = [];
      for (let i = 1; i <= 8; i++) {
        const p = await request(
          "POST",
          "/players",
          { name: `Extra ${i}`, tag: `X${i}` },
          201,
        );
        ids.push(p.id);
      }
      const bulk = (playerIds: string[], expected = 200) =>
        request(
          "POST",
          `/tournaments/${t.id}/entries/bulk`,
          { playerIds },
          expected,
        );
      const count = async () =>
        (await request("GET", `/tournaments/${t.id}`)).entries.length;
      await bulk([], 400);
      await bulk(ids, 409); // 8 selected, 7 spots
      assert.equal(await count(), 1);
      await bulk([ids[0], "missing"], 404);
      assert.equal(await count(), 1);
      t = await bulk([ids[2], ids[0], ids[2], ids[1]]);
      assert.deepEqual(
        t.entries.map((e: { name: string; seed: number }) => [e.name, e.seed]),
        [
          ["Bulk Cup Team 1", 1],
          ["Extra 3", 2],
          ["Extra 1", 3],
          ["Extra 2", 4],
        ],
      );
      await bulk([ids[3], ids[0]], 409); // Extra 1 already in
      assert.equal(await count(), 4);
      await request("POST", `/tournaments/${t.id}/stages`);
      await bulk([ids[4]], 409);
    });
    await ctx.test(
      "metadata, archive protection, and verification headers",
      async () => {
        let t: Tournament = await request("GET", "/tournaments/1");
        t = await request("PATCH", "/tournaments/1/matches/2/metadata", {
          scheduledAt: "2026-11-01T14:00:00.000Z",
          venue: "Court A",
          streamUrl: "https://example.com/stream",
        });
        assert.equal(t.matches[2].venue, "Court A");
        await request(
          "PATCH",
          "/tournaments/1/matches/2/metadata",
          { venue: "", streamUrl: "javascript:alert(1)" },
          400,
        );
        t = await request("PATCH", "/tournaments/1", { status: "archived" });
        await request("PATCH", "/tournaments/1", { name: "No" }, 409);
        await request(
          "PATCH",
          "/tournaments/1/matches/2/metadata",
          { venue: "No" },
          409,
        );
        await request(
          "PATCH",
          "/tournaments/1/matches/2/override",
          { homeScore: 0, awayScore: 2, revision: t.revision, reason: "No" },
          409,
        );
        const denied = await app.inject({
          method: "POST",
          url: "/api/players",
          payload: { name: "CSRF", tag: "X" },
        });
        assert.equal(denied.statusCode, 403);
        const origin = await app.inject({
          method: "POST",
          url: "/api/players",
          headers: {
            "x-knockout-client": "web",
            origin: "https://evil.example",
          },
          payload: { name: "CSRF", tag: "X" },
        });
        assert.equal(origin.statusCode, 403);
      },
    );
    await ctx.test("saved data survives a repository restart", async () => {
      const original = await repo.snapshot();
      const restarted = new Repository();
      assert.deepEqual(await restarted.snapshot(), original);
      await restarted.close();
      assert.ok(
        JSON.parse(await readFile(process.env.DATA_FILE!, "utf8")).tournaments
          .length >= 7,
      );
    });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("individual admin sessions guard mutations while allowing public viewing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "knockout-auth-"));
  process.env.DATA_FILE = join(dir, "state.json");
  process.env.ADMIN_KEY = "test-admin-secret";
  const { app, repo } = await createApp({ seedDemo: false, logger: false });
  await repo.mutate(async (s) => {
    s.accounts.push(
      makeAccount(
        "admin@test.local",
        "Test admin",
        await passwordHash("test-password-123"),
        true,
      ),
    );
  });
  try {
    const h = { "x-knockout-client": "web" };
    assert.equal((await app.inject("/api/tournaments")).statusCode, 200);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/players",
          headers: h,
          payload: { name: "No", tag: "NO" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: h,
          payload: { email: "admin@test.local", password: "bad" },
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: h,
      payload: { email: "admin@test.local", password: "test-password-123" },
    });
    assert.equal(login.statusCode, 200);
    assert.ok(login.headers["set-cookie"]?.toString().includes("HttpOnly"));
    const cookie = login.cookies[0];
    const header = `${cookie.name}=${cookie.value}`;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/players",
          headers: { ...h, cookie: header },
          payload: { name: "Allowed", tag: "OK" },
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/players",
          headers: { ...h, cookie: "knockout_session=forged" },
          payload: { name: "No", tag: "NO" },
        })
      ).statusCode,
      401,
    );
  } finally {
    delete process.env.ADMIN_KEY;
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
