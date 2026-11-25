import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { issueMail, makeAccount, passwordHash } from "../src/identity.js";
import { ApiError } from "../src/tournaments.js";

const KEYS = [
  "RESEND_API_KEY",
  "SMTP_URL",
  "MAIL_FROM",
  "MANUAL_VERIFICATION",
  "NODE_ENV",
  "PUBLIC_ORIGIN",
  "DATABASE_URL",
  "DATA_FILE",
  "SESSION_SECRET",
] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realError = console.error;
const realWarn = console.warn;
let calls: { url: string; body: any }[] = [];

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  calls = [];
  console.error = () => {};
  console.warn = () => {};
});
afterEach(() => {
  for (const k of KEYS)
    saved[k] === undefined
      ? delete process.env[k]
      : (process.env[k] = saved[k]);
  globalThis.fetch = realFetch;
  console.error = realError;
  console.warn = realWarn;
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
/** Resend answering like an unverified sender: rejects every recipient. */
const resendRejects = () =>
  (globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return json(403, {
      statusCode: 403,
      name: "validation_error",
      message: "You can only send testing emails to your own email address.",
    });
  }) as typeof fetch);

async function setup({ manual }: { manual: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "knockout-manual-"));
  process.env.DATA_FILE = join(dir, "state.json");
  process.env.SESSION_SECRET = "test-only-session-secret-32-characters-long";
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "Knockout <onboarding@resend.dev>";
  process.env.PUBLIC_ORIGIN = "http://localhost:5173";
  if (manual) process.env.MANUAL_VERIFICATION = "true";
  resendRejects();
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
  const call = (
    cookie: string | undefined,
    method: string,
    path: string,
    body?: any,
  ) =>
    app.inject({
      method: method as any,
      url: `/api${path}`,
      headers: { "x-knockout-client": "web", ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { payload: body }),
    });
  const login = async (email: string, password: string) => {
    const res = await call(undefined, "POST", "/auth/login", {
      email,
      password,
    });
    return {
      res,
      cookie: String(res.headers["set-cookie"] ?? "").split(";")[0],
    };
  };
  const register = (email: string, name = "New Player") =>
    call(undefined, "POST", "/auth/register", {
      email,
      name,
      password: "participant-pass-123",
    });
  const adminCookie = (await login("admin@test.local", "admin-password-123"))
    .cookie;
  const accountId = async (email: string) =>
    (await call(adminCookie, "GET", "/admin/users"))
      .json()
      .find((u: any) => u.email === email)?.id as string;
  return { app, repo, call, login, register, adminCookie, accountId };
}

test("manual mode: failed email still creates the account and tells the user", async () => {
  const f = await setup({ manual: true });
  const res = await f.register("someone@test.local");
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.match(body.message, /administrator will approve/i);
  assert.equal(body.developmentLink, undefined);
  assert.equal(body.pendingApproval, undefined, "internal flag not exposed");
  assert.equal(calls.length, 1, "delivery was still attempted");
  const id = await f.accountId("someone@test.local");
  assert.ok(id, "account exists");
  const { res: login } = await f.login(
    "someone@test.local",
    "participant-pass-123",
  );
  assert.equal(login.statusCode, 403);
  assert.match(login.json().error, /waiting for administrator approval/i);
  await f.app.close();
});

test("an administrator can verify the account, and the user can then sign in", async () => {
  const f = await setup({ manual: true });
  await f.register("someone@test.local");
  const id = await f.accountId("someone@test.local");
  const patch = await f.call(f.adminCookie, "PATCH", `/admin/users/${id}`, {
    verified: true,
    reason: "Known player from the league",
  });
  assert.equal(patch.statusCode, 200, patch.body);
  assert.equal(patch.json().verified, true);
  const users = (await f.call(f.adminCookie, "GET", "/admin/users")).json();
  assert.equal(users.find((u: any) => u.id === id).verified, true);
  const { res, cookie } = await f.login(
    "someone@test.local",
    "participant-pass-123",
  );
  assert.equal(res.statusCode, 200, res.body);
  const session = (await f.call(cookie, "GET", "/session")).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.verified, true);
  await f.app.close();
});

test("manual verification invalidates the old email link", async () => {
  const f = await setup({ manual: true });
  await f.register("someone@test.local");
  const token = new URL(
    String(calls[0].body.text).match(/https?:\/\/\S+/)![0],
  ).searchParams.get("token");
  assert.match(String(token), /^[0-9a-f]{64}$/);
  const id = await f.accountId("someone@test.local");
  await f.call(f.adminCookie, "PATCH", `/admin/users/${id}`, {
    verified: true,
    reason: "Approved by hand",
  });
  const replay = await f.call(undefined, "POST", "/auth/verify", { token });
  assert.equal(replay.statusCode, 400);
  await f.app.close();
});

test("only administrators can verify accounts, and only to verified", async () => {
  const f = await setup({ manual: true });
  await f.register("target@test.local", "Target");
  const target = await f.accountId("target@test.local");
  await f.repo.mutate(async (s) => {
    const a = makeAccount(
      "member@test.local",
      "Member",
      await passwordHash("participant-pass-123"),
    );
    a.verified = true;
    s.accounts.push(a);
  });
  const member = (await f.login("member@test.local", "participant-pass-123"))
    .cookie;
  const denied = await f.call(member, "PATCH", `/admin/users/${target}`, {
    verified: true,
    reason: "Trying to self-serve",
  });
  assert.equal(denied.statusCode, 403);
  const anonymous = await f.call(undefined, "PATCH", `/admin/users/${target}`, {
    verified: true,
    reason: "Not signed in",
  });
  assert.ok([401, 403].includes(anonymous.statusCode));
  const unverify = await f.call(
    f.adminCookie,
    "PATCH",
    `/admin/users/${target}`,
    {
      verified: false,
      reason: "This is not supported",
    },
  );
  assert.equal(unverify.statusCode, 400);
  const noReason = await f.call(
    f.adminCookie,
    "PATCH",
    `/admin/users/${target}`,
    {
      verified: true,
    },
  );
  assert.equal(noReason.statusCode, 400);
  const users = (await f.call(f.adminCookie, "GET", "/admin/users")).json();
  assert.equal(users.find((u: any) => u.id === target).verified, false);
  await f.app.close();
});

test("without the flag, a failed verification email is still an error", async () => {
  const f = await setup({ manual: false });
  const res = await f.register("someone@test.local");
  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /could not send the email/i);
  const { res: login } = await f.login(
    "someone@test.local",
    "participant-pass-123",
  );
  assert.equal(login.statusCode, 403);
  assert.match(login.json().error, /Verify your email before signing in/);
  await f.app.close();
});

test("manual mode only covers verification: failed password-reset email still errors", async () => {
  const f = await setup({ manual: true });
  await f.repo.mutate(async (s) => {
    const a = makeAccount(
      "member@test.local",
      "Member",
      await passwordHash("participant-pass-123"),
    );
    a.verified = true;
    s.accounts.push(a);
  });
  const res = await f.call(undefined, "POST", "/auth/forgot", {
    email: "member@test.local",
  });
  assert.equal(res.statusCode, 502);
  await f.app.close();
});

test("resend verification hints at administrator approval only in manual mode", async () => {
  const on = await setup({ manual: true });
  await on.register("someone@test.local");
  const a = await on.call(undefined, "POST", "/auth/resend", {
    email: "someone@test.local",
  });
  assert.equal(a.statusCode, 200, a.body);
  assert.match(a.json().message, /ask an administrator to approve/i);
  const unknown = await on.call(undefined, "POST", "/auth/resend", {
    email: "nobody@test.local",
  });
  assert.equal(
    unknown.json().message,
    a.json().message,
    "same reply whether or not the account exists",
  );
  await on.app.close();
});

test("manual mode lets production register without an email provider, but not reset", async () => {
  process.env.NODE_ENV = "production";
  const account = makeAccount("someone@example.com", "Someone", "hash");
  const state = { tokens: [] } as any;
  await assert.rejects(
    issueMail(state, account, "verify"),
    (e: unknown) => e instanceof ApiError && e.statusCode === 503,
  );
  process.env.MANUAL_VERIFICATION = "true";
  const issued = await issueMail(state, account, "verify");
  assert.equal(issued.kind, "verify");
  await assert.rejects(
    issueMail(state, account, "reset"),
    (e: unknown) => e instanceof ApiError && e.statusCode === 503,
  );
});

test("development without a provider still returns the local preview link", async () => {
  const dir = await mkdtemp(join(tmpdir(), "knockout-manual-"));
  process.env.DATA_FILE = join(dir, "state.json");
  process.env.SESSION_SECRET = "test-only-session-secret-32-characters-long";
  process.env.MANUAL_VERIFICATION = "true";
  const { app } = await createApp({ seedDemo: false, logger: false });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "x-knockout-client": "web" },
    payload: {
      email: "dev@test.local",
      name: "Dev",
      password: "participant-pass-123",
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.json().developmentLink, /auth=verify&token=/);
  assert.match(res.json().message, /Check your email/);
  await app.close();
});
