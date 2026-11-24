import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOTP, Secret } from "otpauth";
import { createApp } from "../src/app.js";
import { makeAccount, passwordHash } from "../src/identity.js";
import { Repository } from "../src/storage.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "knockout-phase2-"));
  process.env.DATA_FILE = join(dir, "state.json");
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  delete process.env.RESEND_API_KEY;
  process.env.SESSION_SECRET = "test-only-session-secret-32-characters-long";
  const { app, repo } = await createApp({ seedDemo: false, logger: false });
  await repo.mutate(async (s) =>
    s.accounts.push(
      makeAccount(
        "admin@test.local",
        "Admin",
        await passwordHash("admin-password-123"),
        true,
      ),
    ),
  );
  const call = async (
    cookie: string | undefined,
    method: string,
    path: string,
    body?: any,
    status = 200,
  ) => {
    const res = await app.inject({
      method: method as any,
      url: `/api${path}`,
      headers: { "x-knockout-client": "web", ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(res.statusCode, status, `${method} ${path}: ${res.body}`);
    return res;
  };
  const login = async (
    email: string,
    password = "participant-pass-123",
    code?: string,
  ) => {
    const r = await call(undefined, "POST", "/auth/login", {
      email,
      password,
      ...(code ? { code } : {}),
    });
    return r.headers["set-cookie"]!.toString().split(";")[0];
  };
  const admin = await login("admin@test.local", "admin-password-123");
  const user = async (name: string) => {
    const email = `${name.toLowerCase()}@test.local`;
    const registered = (
      await call(undefined, "POST", "/auth/register", {
        email,
        password: "participant-pass-123",
        name,
        role: "admin",
      })
    ).json();
    const token = new URL(registered.developmentLink).searchParams.get("token");
    await call(undefined, "POST", "/auth/verify", { token });
    const cookie = await login(email);
    const profile = (await call(cookie, "GET", "/session")).json().user;
    assert.equal(profile.role, "participant");
    return { ...profile, cookie, email };
  };
  const tournament = async (
    name = "Points Cup",
    count = 4,
    format = "single_elimination",
    bestOf = 3,
  ) => {
    let t = (
      await call(
        admin,
        "POST",
        "/tournaments",
        {
          name,
          game: "Test",
          format,
          bestOf,
          capacity: 16,
          date: new Date(Date.now() + 86400000).toISOString(),
        },
        201,
      )
    ).json();
    for (let i = 0; i < count; i++) {
      const p = (
        await call(
          admin,
          "POST",
          "/players",
          { name: `${name} team ${i}`, tag: `T${i}` },
          201,
        )
      ).json();
      t = (
        await call(admin, "POST", `/tournaments/${t.id}/entries`, {
          playerId: p.id,
        })
      ).json();
    }
    t = (await call(admin, "POST", `/tournaments/${t.id}/stages`)).json();
    await call(admin, "PATCH", `/tournaments/${t.id}/workflow`, {
      predictionsEnabled: true,
    });
    return (await call(admin, "GET", `/tournaments/${t.id}`)).json();
  };
  const community = async (tid: number, cookie?: string) =>
    (await call(cookie, "GET", `/tournaments/${tid}/community`)).json();
  const enroll = async (tid: number, u: any) => {
    await call(u.cookie, "POST", `/tournaments/${tid}/join`, {
      kind: "predictor",
    });
    const c = await community(tid, admin);
    const m = c.members.find((x: any) => x.userId === u.id);
    await call(admin, "PATCH", `/tournaments/${tid}/members/${m.id}`, {
      status: "approved",
      reason: "Approved for this test event",
    });
    return m;
  };
  const result = async (tid: number, match: number, home = 2, away = 0) => {
    const t = (await call(admin, "GET", `/tournaments/${tid}`)).json();
    return (
      await call(
        admin,
        "PATCH",
        `/tournaments/${tid}/matches/${match}/result`,
        { homeScore: home, awayScore: away, revision: t.revision },
      )
    ).json();
  };
  const cleanup = async () => {
    await app.close();
    const target = join(dir, "state.json");
    assert.ok(target.startsWith(dir));
    await rm(dir, { recursive: true, force: true });
  };
  return {
    app,
    repo,
    call,
    login,
    admin,
    user,
    tournament,
    community,
    enroll,
    result,
    cleanup,
  };
}

test("registration, verification, recovery, session revocation, and account privacy", async () => {
  const f = await fixture();
  try {
    const registered = (
      await f.call(undefined, "POST", "/auth/register", {
        email: "new@test.local",
        name: "New player",
        password: "long-enough-password",
        role: "admin",
      })
    ).json();
    await f.call(
      undefined,
      "POST",
      "/auth/login",
      { email: "new@test.local", password: "long-enough-password" },
      403,
    );
    const token = new URL(registered.developmentLink).searchParams.get("token");
    await f.call(undefined, "POST", "/auth/verify", { token });
    await f.call(undefined, "POST", "/auth/verify", { token }, 400);
    const cookie = await f.login("new@test.local", "long-enough-password");
    const profile = (await f.call(cookie, "GET", "/session")).json();
    assert.equal(profile.user.role, "participant");
    assert.equal(profile.user.passwordHash, undefined);
    await f.call(
      cookie,
      "POST",
      "/tournaments",
      { name: "Cannot elevate" },
      403,
    );
    await f.call(cookie, "GET", "/admin/users", undefined, 403);
    await f.call(undefined, "GET", "/me/workspace", undefined, 401);
    const sessions = (await f.call(cookie, "GET", "/me/sessions")).json();
    const adminSessions = (await f.call(f.admin, "GET", "/me/sessions")).json();
    await f.call(
      cookie,
      "DELETE",
      `/me/sessions/${adminSessions[0].id}`,
      undefined,
      404,
    );
    const reset = (
      await f.call(undefined, "POST", "/auth/forgot", {
        email: "new@test.local",
      })
    ).json();
    const resetToken = new URL(reset.developmentLink).searchParams.get("token");
    await f.call(undefined, "POST", "/auth/reset", {
      token: resetToken,
      password: "new-long-password",
    });
    await f.call(cookie, "GET", "/me/workspace", undefined, 401);
    await f.call(
      undefined,
      "POST",
      "/auth/reset",
      { token: resetToken, password: "another-long-password" },
      400,
    );
    const second = await f.login("new@test.local", "new-long-password");
    await f.call(second, "POST", "/auth/logout");
    await f.call(second, "GET", "/me/workspace", undefined, 401);
    assert.equal(sessions.length, 1);
    const stored = (await f.repo.snapshot()).accounts.find(
      (u) => u.email === "new@test.local",
    )!;
    assert.ok(stored.passwordHash.startsWith("$argon2id$"));
    assert.ok(!(await f.repo.snapshot()).tokens.some((x) => x.id === token));
  } finally {
    await f.cleanup();
  }
});

test("100-point grant, private selections, editing, pooled payouts, and idempotent settlement", async () => {
  const f = await fixture();
  try {
    const t = await f.tournament();
    const alice = await f.user("Alice"),
      bob = await f.user("Bobby"),
      cara = await f.user("Cara");
    const am = await f.enroll(t.id, alice);
    await f.enroll(t.id, bob);
    await f.enroll(t.id, cara);
    await f.call(f.admin, "PATCH", `/tournaments/${t.id}/members/${am.id}`, {
      status: "approved",
      reason: "Retry should not issue another grant",
    });
    assert.equal((await f.community(t.id, alice.cookie)).wallet.available, 100);
    await f.call(
      alice.cookie,
      "POST",
      `/tournaments/${t.id}/join`,
      { kind: "predictor" },
      409,
    );
    const market = (await f.community(t.id, alice.cookie)).markets[0];
    const path = `/tournaments/${t.id}/markets/${market.id}`;
    await f.call(
      alice.cookie,
      "PUT",
      `${path}/prediction`,
      { side: "home", stake: 26 },
      400,
    );
    await f.call(alice.cookie, "PUT", `${path}/prediction`, {
      side: "home",
      stake: 10,
    });
    await f.call(alice.cookie, "PUT", `${path}/prediction`, {
      side: "home",
      stake: 15,
    });
    await f.call(bob.cookie, "PUT", `${path}/prediction`, {
      side: "home",
      stake: 15,
    });
    await f.call(cara.cookie, "PUT", `${path}/prediction`, {
      side: "away",
      stake: 10,
    });
    const privateView = await f.community(t.id, bob.cookie);
    assert.equal(privateView.markets[0].homePool, undefined);
    assert.equal(privateView.markets[0].mine.userId, bob.id);
    assert.equal(JSON.stringify(privateView).includes(alice.email), false);
    assert.equal(privateView.wallet.userId, bob.id);
    await f.call(
      f.admin,
      "POST",
      `/tournaments/${t.id}/matches/${market.matchId}/start`,
    );
    await f.call(alice.cookie, "DELETE", `${path}/prediction`, undefined, 409);
    await f.call(
      alice.cookie,
      "PUT",
      `${path}/prediction`,
      { side: "away", stake: 1 },
      409,
    );
    await f.result(t.id, market.matchId);
    await f.call(
      alice.cookie,
      "POST",
      `${path}/finalize`,
      { reason: "Cannot settle my own prediction" },
      403,
    );
    await f.call(f.admin, "POST", `${path}/finalize`, {
      reason: "Official match result verified",
    });
    const before = await f.repo.snapshot();
    await f.call(f.admin, "POST", `${path}/finalize`, {
      reason: "Retrying the same finalization",
    });
    const after = await f.repo.snapshot();
    assert.deepEqual(after.wallets, before.wallets);
    assert.deepEqual(after.ledger, before.ledger);
    assert.equal((await f.community(t.id, alice.cookie)).wallet.available, 105);
    assert.equal((await f.community(t.id, bob.cookie)).wallet.available, 105);
    assert.equal((await f.community(t.id, cara.cookie)).wallet.available, 90);
    assert.equal(
      after.wallets.reduce((n, w) => n + w.available + w.reserved, 0),
      300,
    );
    const official = (
      await f.call(f.admin, "GET", `/tournaments/${t.id}`)
    ).json();
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/${market.matchId}/override`,
      {
        homeScore: 0,
        awayScore: 2,
        reason: "Winner incorrectly recorded",
        revision: official.revision,
      },
      409,
    );
    await f.call(f.admin, "POST", `${path}/reconcile`, {
      reason: "Approved correction requires refund",
    });
    assert.equal((await f.community(t.id, alice.cookie)).wallet.available, 100);
    assert.equal((await f.community(t.id, cara.cookie)).wallet.available, 100);
    const revised = (
      await f.call(f.admin, "GET", `/tournaments/${t.id}`)
    ).json();
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/${market.matchId}/override`,
      {
        homeScore: 0,
        awayScore: 2,
        reason: "Winner incorrectly recorded",
        revision: revised.revision,
      },
    );
    const state = await f.repo.snapshot();
    await assert.rejects(
      f.repo.mutate((s) => {
        s.ledger[0].availableDelta = 999;
      }),
    );
    assert.deepEqual((await f.repo.snapshot()).wallets, state.wallets);
  } finally {
    await f.cleanup();
  }
});

test("concurrent stakes cannot overspend and scheduled deadlines use server time", async () => {
  const f = await fixture();
  try {
    const t = await f.tournament("League", 4, "round_robin", 1);
    const u = await f.user("Concurrent");
    await f.enroll(t.id, u);
    const markets = (await f.community(t.id, u.cookie)).markets;
    assert.equal(markets.length, 6);
    const results = await Promise.all(
      markets.slice(0, 5).map((m: any) =>
        f.app.inject({
          method: "PUT",
          url: `/api/tournaments/${t.id}/markets/${m.id}/prediction`,
          headers: { "x-knockout-client": "web", cookie: u.cookie },
          payload: { side: "home", stake: 25 },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.statusCode === 200).length, 4);
    assert.equal(results.filter((r) => r.statusCode === 409).length, 1);
    let c = await f.community(t.id, u.cookie);
    assert.equal(c.wallet.available, 0);
    assert.equal(c.wallet.reserved, 100);
    const p = markets[0];
    await f.call(
      u.cookie,
      "DELETE",
      `/tournaments/${t.id}/markets/${p.id}/prediction`,
    );
    c = await f.community(t.id, u.cookie);
    assert.equal(c.wallet.available, 25);
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/${p.matchId}/metadata`,
      { scheduledAt: new Date(Date.now() - 1000).toISOString(), venue: "Test" },
    );
    await f.call(
      u.cookie,
      "PUT",
      `/tournaments/${t.id}/markets/${p.id}/prediction`,
      { side: "away", stake: 1, clientTime: "2000-01-01" },
      409,
    );
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/${p.matchId}/metadata`,
      {
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        venue: "Moved",
      },
    );
    await f.call(
      u.cookie,
      "PUT",
      `/tournaments/${t.id}/markets/${p.id}/prediction`,
      { side: "away", stake: 1 },
      409,
    );
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}`,
      { status: "archived" },
      409,
    );
    for (const m of markets)
      await f.call(
        f.admin,
        "POST",
        `/tournaments/${t.id}/markets/${m.id}/void`,
        { reason: "Event cancelled by organizer" },
      );
    c = await f.community(t.id, u.cookie);
    assert.equal(c.wallet.available, 100);
    assert.equal(c.wallet.reserved, 0);
    await f.call(f.admin, "PATCH", `/tournaments/${t.id}`, {
      status: "archived",
    });
  } finally {
    await f.cleanup();
  }
});

test("competitor registration, check-in, submissions, disputes, and scoped operator permissions", async () => {
  const f = await fixture();
  try {
    const a = await f.user("CompetitorA"),
      b = await f.user("CompetitorB"),
      operator = await f.user("Operator");
    const t = (
      await f.call(
        f.admin,
        "POST",
        "/tournaments",
        {
          name: "Registration Cup",
          game: "Game",
          format: "single_elimination",
          capacity: 4,
          bestOf: 3,
          date: new Date(Date.now() + 86400000).toISOString(),
        },
        201,
      )
    ).json();
    for (const u of [a, b]) {
      const p = (
        await f.call(u.cookie, "POST", "/teams", {
          name: `${u.name} team`,
          tag: "TEAM",
        })
      ).json();
      await f.call(u.cookie, "POST", `/tournaments/${t.id}/join`, {
        kind: "competitor",
        playerId: p.id,
      });
      const c = await f.community(t.id, f.admin);
      const member = c.members.find((m: any) => m.userId === u.id);
      await f.call(
        f.admin,
        "PATCH",
        `/tournaments/${t.id}/members/${member.id}`,
        { status: "approved", reason: "Competition entry approved" },
      );
    }
    await f.call(
      f.admin,
      "POST",
      `/tournaments/${t.id}/stages`,
      undefined,
      409,
    );
    await f.call(f.admin, "PATCH", `/tournaments/${t.id}/workflow`, {
      registration: "checkin",
      predictionsEnabled: true,
    });
    await f.call(a.cookie, "POST", `/tournaments/${t.id}/checkin`);
    await f.call(b.cookie, "POST", `/tournaments/${t.id}/checkin`);
    await f.call(f.admin, "POST", `/tournaments/${t.id}/stages`);
    await f.call(f.admin, "POST", `/tournaments/${t.id}/staff`, {
      userId: operator.id,
      role: "operator",
      reason: "Operator assigned for match review",
    });
    const c = await f.community(t.id, a.cookie),
      m = c.markets[0];
    await f.call(
      a.cookie,
      "PUT",
      `/tournaments/${t.id}/markets/${m.id}/prediction`,
      { side: "home", stake: 1 },
      403,
    );
    await f.call(
      operator.cookie,
      "PUT",
      `/tournaments/${t.id}/markets/${m.id}/prediction`,
      { side: "home", stake: 1 },
      403,
    );
    await f.call(
      operator.cookie,
      "POST",
      `/tournaments/${t.id}/matches/0/start`,
    );
    await f.call(
      a.cookie,
      "POST",
      `/tournaments/${t.id}/matches/0/submissions`,
      {
        homeScore: 2,
        awayScore: 1,
        evidence: "Score screenshot verified by teams",
      },
    );
    let community = await f.community(t.id, b.cookie);
    const submission = community.submissions[0];
    assert.equal(
      (await f.call(undefined, "GET", `/tournaments/${t.id}`)).json().matches[0]
        .home.result,
      undefined,
    );
    await f.call(
      a.cookie,
      "POST",
      `/tournaments/${t.id}/submissions/${submission.id}/respond`,
      { action: "confirm", reason: "Cannot confirm own submission" },
      403,
    );
    await f.call(
      b.cookie,
      "POST",
      `/tournaments/${t.id}/submissions/${submission.id}/respond`,
      { action: "dispute", reason: "Please check the screenshot again" },
    );
    await f.call(
      operator.cookie,
      "POST",
      `/tournaments/${t.id}/submissions/${submission.id}/review`,
      { approve: true, reason: "Reviewed both teams evidence" },
    );
    assert.equal(
      (await f.call(undefined, "GET", `/tournaments/${t.id}`)).json().status,
      "completed",
    );
    const other = await f.tournament("Other event");
    await f.call(
      operator.cookie,
      "PATCH",
      `/tournaments/${other.id}/matches/0/metadata`,
      { venue: "Not assigned" },
      403,
    );
    await f.call(
      a.cookie,
      "PATCH",
      `/tournaments/${t.id}/matches/0/metadata`,
      { venue: "Cannot mutate" },
      403,
    );
    await f.call(
      operator.cookie,
      "POST",
      `/tournaments/${t.id}/markets/${m.id}/finalize`,
      { reason: "Operator cannot settle predictions" },
      403,
    );
    assert.equal((await f.community(t.id)).submissions.length, 0);
    assert.equal((await f.community(t.id)).members.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("draws, forfeits, and one-sided pools refund rather than minting rewards", async () => {
  const f = await fixture();
  try {
    const u = await f.user("RefundUser"),
      v = await f.user("RefundOther");
    const t = await f.tournament("Draw event", 4, "round_robin", 1);
    await f.enroll(t.id, u);
    await f.enroll(t.id, v);
    const markets = (await f.community(t.id, u.cookie)).markets;
    for (let i = 0; i < 3; i++) {
      const m = markets[i],
        path = `/tournaments/${t.id}/markets/${m.id}`;
      await f.call(u.cookie, "PUT", `${path}/prediction`, {
        side: "home",
        stake: 10,
      });
      if (i < 2)
        await f.call(v.cookie, "PUT", `${path}/prediction`, {
          side: "away",
          stake: 10,
        });
      if (i === 1) {
        const e = (await f.call(f.admin, "GET", `/tournaments/${t.id}`)).json();
        await f.call(
          f.admin,
          "PATCH",
          `/tournaments/${t.id}/matches/${m.matchId}/result`,
          { homeScore: 0, awayScore: 0, forfeit: "home", revision: e.revision },
        );
      } else await f.result(t.id, m.matchId, 1, i === 0 ? 1 : 0);
      await f.call(f.admin, "POST", `${path}/finalize`, {
        reason: "Reviewed refund outcome",
      });
      assert.equal((await f.community(t.id, u.cookie)).wallet.available, 100);
      assert.equal((await f.community(t.id, v.cookie)).wallet.available, 100);
    }
  } finally {
    await f.cleanup();
  }
});

test("existing ownership, schedule conflict checks, and explicit market reopening", async () => {
  const f = await fixture();
  try {
    const t = await f.tournament("Workflow checks", 4, "round_robin", 1);
    const u = await f.user("CaptainAccount");
    const p = t.entries[0];
    await f.call(
      u.cookie,
      "POST",
      `/admin/players/${p.id}/owner`,
      { userId: u.id, reason: "Participants cannot assign ownership" },
      403,
    );
    await f.call(f.admin, "POST", `/admin/players/${p.id}/owner`, {
      userId: u.id,
      reason: "Connect the existing team captain",
    });
    assert.ok(
      (await f.call(u.cookie, "GET", "/me/workspace"))
        .json()
        .teams.some(
          (m: any) => m.playerId === p.id && m.role === "captain" && m.accepted,
        ),
    );
    await f.enroll(t.id, u);
    let c = await f.community(t.id, u.cookie);
    const own = c.markets.find((m: any) => !m.eligible);
    assert.ok(own);
    await f.call(
      u.cookie,
      "PUT",
      `/tournaments/${t.id}/markets/${own.id}/prediction`,
      { side: "home", stake: 1 },
      403,
    );
    const start = Date.now() + 2 * 86400000;
    const schedule = (millis: number) => ({
      scheduledAt: new Date(millis).toISOString(),
      durationMinutes: 60,
      venue: "Court A",
    });
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/0/metadata`,
      schedule(start),
    );
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/1/metadata`,
      schedule(start + 30 * 60000),
      409,
    );
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/1/metadata`,
      schedule(start + 60 * 60000),
    );
    const market = c.markets.find((m: any) => m.eligible);
    const path = `/tournaments/${t.id}/markets/${market.id}`;
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/${market.matchId}/metadata`,
      {
        scheduledAt: new Date(Date.now() - 60000).toISOString(),
        venue: "Late server",
      },
    );
    await f.call(
      u.cookie,
      "PUT",
      `${path}/prediction`,
      { side: "home", stake: 5 },
      409,
    );
    await f.call(
      f.admin,
      "PATCH",
      `/tournaments/${t.id}/matches/${market.matchId}/metadata`,
      {
        scheduledAt: new Date(start + 6 * 3600000).toISOString(),
        venue: "Late server",
      },
    );
    await f.call(
      u.cookie,
      "POST",
      `${path}/reopen`,
      { reason: "Participant cannot reopen" },
      403,
    );
    await f.call(f.admin, "POST", `${path}/reopen`, {
      reason: "Match postponed before any play",
    });
    await f.call(u.cookie, "PUT", `${path}/prediction`, {
      side: "home",
      stake: 5,
    });
    await f.call(
      f.admin,
      "POST",
      `/admin/players/${t.entries[1].id}/owner`,
      { userId: u.id, reason: "Active predictions prevent assignment" },
      409,
    );
    c = await f.community(t.id, u.cookie);
    assert.equal(c.wallet.available, 95);
  } finally {
    await f.cleanup();
  }
});

test("upstream correction refunds affected downstream stakes and returns the final canonical revision", async () => {
  const f = await fixture();
  try {
    const t = await f.tournament("Correction pool");
    const u = await f.user("CorrectionUser");
    await f.enroll(t.id, u);
    await f.result(t.id, 0);
    await f.result(t.id, 1);
    const c = await f.community(t.id, u.cookie);
    const final = c.markets.find((m: any) => m.matchId === 2);
    assert.ok(final);
    await f.call(
      u.cookie,
      "PUT",
      `/tournaments/${t.id}/markets/${final.id}/prediction`,
      { side: "home", stake: 15 },
    );
    const before = (
      await f.call(f.admin, "GET", `/tournaments/${t.id}`)
    ).json();
    const corrected = (
      await f.call(
        f.admin,
        "PATCH",
        `/tournaments/${t.id}/matches/0/override`,
        {
          homeScore: 0,
          awayScore: 2,
          reason: "Wrong semifinal winner entered",
          revision: before.revision,
        },
      )
    ).json();
    const canonical = (
      await f.call(f.admin, "GET", `/tournaments/${t.id}`)
    ).json();
    assert.equal(corrected.revision, canonical.revision);
    const after = await f.community(t.id, u.cookie);
    assert.equal(after.wallet.available, 100);
    assert.equal(after.wallet.reserved, 0);
    assert.equal(
      after.markets.find((m: any) => m.id === final.id).state,
      "voided",
    );
  } finally {
    await f.cleanup();
  }
});

test("authenticator enrollment, recovery codes, and replay protection", async () => {
  const f = await fixture();
  try {
    const u = await f.user("SecureUser");
    const setup = (
      await f.call(u.cookie, "POST", "/me/mfa/setup", {
        password: "participant-pass-123",
      })
    ).json();
    const code = new TOTP({
      secret: Secret.fromBase32(setup.secret),
    }).generate();
    const enabled = (
      await f.call(u.cookie, "POST", "/me/mfa/enable", { code })
    ).json();
    assert.equal(enabled.recoveryCodes.length, 8);
    await f.call(
      undefined,
      "POST",
      "/auth/login",
      { email: u.email, password: "participant-pass-123" },
      401,
    );
    await f.call(
      undefined,
      "POST",
      "/auth/login",
      { email: u.email, password: "participant-pass-123", code },
      401,
    );
    await f.login(u.email, "participant-pass-123", enabled.recoveryCodes[0]);
    await f.call(
      undefined,
      "POST",
      "/auth/login",
      {
        email: u.email,
        password: "participant-pass-123",
        code: enabled.recoveryCodes[0],
      },
      401,
    );
    const account = (await f.repo.snapshot()).accounts.find(
      (a) => a.id === u.id,
    )!;
    assert.ok(!account.mfaSecret!.includes(setup.secret));
    const oldSecret = account.mfaSecret;
    const rotation = (
      await f.call(u.cookie, "POST", "/me/mfa/setup", {
        password: "participant-pass-123",
        code: enabled.recoveryCodes[1],
      })
    ).json();
    assert.equal(
      (await f.repo.snapshot()).accounts.find((a) => a.id === u.id)!.mfaSecret,
      oldSecret,
    );
    const newCode = new TOTP({
      secret: Secret.fromBase32(rotation.secret),
    }).generate();
    const replacement = (
      await f.call(u.cookie, "POST", "/me/mfa/enable", { code: newCode })
    ).json();
    await f.call(
      undefined,
      "POST",
      "/auth/login",
      {
        email: u.email,
        password: "participant-pass-123",
        code: enabled.recoveryCodes[2],
      },
      401,
    );
    await f.login(
      u.email,
      "participant-pass-123",
      replacement.recoveryCodes[0],
    );
    assert.ok(!account.recoveryHashes.includes(enabled.recoveryCodes[1]));
  } finally {
    await f.cleanup();
  }
});

test("integer pool rounding conserves every point and spent payouts block reconciliation atomically", async () => {
  const f = await fixture();
  try {
    const t = await f.tournament("Rounding league", 4, "round_robin", 1);
    const a = await f.user("RoundingA"),
      b = await f.user("RoundingB"),
      c = await f.user("RoundingC");
    for (const u of [a, b, c]) await f.enroll(t.id, u);
    const markets = (await f.community(t.id, a.cookie)).markets;
    const m = markets[0],
      path = `/tournaments/${t.id}/markets/${m.id}`;
    await f.call(a.cookie, "PUT", `${path}/prediction`, {
      side: "home",
      stake: 3,
    });
    await f.call(b.cookie, "PUT", `${path}/prediction`, {
      side: "home",
      stake: 2,
    });
    await f.call(c.cookie, "PUT", `${path}/prediction`, {
      side: "away",
      stake: 2,
    });
    await f.result(t.id, m.matchId, 1, 0);
    await f.call(f.admin, "POST", `${path}/finalize`, {
      reason: "Rounding allocation checked",
    });
    const ps = (await f.repo.snapshot()).predictions.filter(
      (p) => p.marketId === m.id,
    );
    assert.equal(ps.find((p) => p.userId === a.id)!.payout, 4);
    assert.equal(ps.find((p) => p.userId === b.id)!.payout, 3);
    assert.equal(
      ps.reduce((n, p) => n + p.payout, 0),
      7,
    );
    const second = markets[1],
      secondPath = `/tournaments/${t.id}/markets/${second.id}`;
    await f.call(a.cookie, "PUT", `${secondPath}/prediction`, {
      side: "home",
      stake: 1,
    });
    await f.call(c.cookie, "PUT", `${secondPath}/prediction`, {
      side: "away",
      stake: 25,
    });
    await f.result(t.id, second.matchId, 1, 0);
    await f.call(f.admin, "POST", `${secondPath}/finalize`, {
      reason: "Official score verified",
    });
    // Deliberately reduce available points through a recorded, authorized adjustment.
    const wallet = (await f.community(t.id, a.cookie)).wallet;
    await f.call(
      f.admin,
      "POST",
      `/tournaments/${t.id}/wallets/${wallet.id}/adjust`,
      {
        amount: -wallet.available,
        reason: "Test insufficient unreserved correction balance",
        requestId: crypto.randomUUID(),
      },
    );
    const before = await f.repo.snapshot();
    await f.call(
      f.admin,
      "POST",
      `${secondPath}/reconcile`,
      { reason: "Late correction must not create debt" },
      409,
    );
    assert.deepEqual((await f.repo.snapshot()).wallets, before.wallets);
    assert.deepEqual((await f.repo.snapshot()).ledger, before.ledger);
    await assert.rejects(
      f.repo.mutate((s) => {
        s.ledger = s.ledger.slice(1);
      }),
    );
  } finally {
    await f.cleanup();
  }
});
