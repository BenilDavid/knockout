import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { issueMail, makeAccount } from "../src/identity.js";
import { actionEmail, mailProvider, sendMail } from "../src/mailer.js";
import { ApiError } from "../src/tournaments.js";

const KEYS = [
  "RESEND_API_KEY",
  "SMTP_URL",
  "MAIL_FROM",
  "NODE_ENV",
  "PUBLIC_ORIGIN",
  "DATABASE_URL",
  "DATA_FILE",
  "SESSION_SECRET",
] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  calls = [];
});
afterEach(() => {
  for (const k of KEYS)
    saved[k] === undefined
      ? delete process.env[k]
      : (process.env[k] = saved[k]);
  globalThis.fetch = realFetch;
});

const stubFetch = (respond: () => Response | Promise<Response>) => {
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as typeof fetch;
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const sample = {
  to: "player@example.com",
  subject: "Hello",
  text: "plain body",
  html: "<p>html body</p>",
};

test("mailProvider needs MAIL_FROM and prefers Resend over SMTP", () => {
  assert.equal(mailProvider(), null);
  process.env.RESEND_API_KEY = "re_test";
  assert.equal(mailProvider(), null, "no MAIL_FROM");
  process.env.MAIL_FROM = "Knockout <no-reply@example.com>";
  assert.equal(mailProvider(), "resend");
  process.env.SMTP_URL = "smtp://localhost:2525";
  assert.equal(mailProvider(), "resend", "Resend wins when both are set");
  delete process.env.RESEND_API_KEY;
  assert.equal(mailProvider(), "smtp");
});

test("sendMail posts to the Resend API with the key and message", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "Knockout <no-reply@example.com>";
  stubFetch(() => json(200, { id: "email_123" }));
  assert.equal(await sendMail(sample), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer re_test_key");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.from, "Knockout <no-reply@example.com>");
  assert.deepEqual([body.to].flat(), ["player@example.com"]);
  assert.equal(body.subject, "Hello");
  assert.equal(body.text, "plain body");
  assert.equal(body.html, "<p>html body</p>");
});

test("sendMail turns Resend API errors into a 502 without leaking details", async () => {
  process.env.RESEND_API_KEY = "re_bad";
  process.env.MAIL_FROM = "Knockout <no-reply@example.com>";
  stubFetch(() =>
    json(403, {
      statusCode: 403,
      name: "validation_error",
      message: "The example.com domain is not verified.",
    }),
  );
  const quiet = console.error;
  console.error = () => {};
  try {
    await assert.rejects(sendMail(sample), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.statusCode, 502);
      assert.doesNotMatch(e.message, /domain|verified|re_bad/i);
      return true;
    });
  } finally {
    console.error = quiet;
  }
});

test("sendMail turns network failures into a 502", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "Knockout <no-reply@example.com>";
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      sendMail(sample),
      (e: unknown) => e instanceof ApiError && e.statusCode === 502,
    );
  } finally {
    console.error = quiet;
  }
});

test("sendMail does nothing and returns false when no provider is configured", async () => {
  stubFetch(() => json(200, {}));
  assert.equal(await sendMail(sample), false);
  assert.equal(calls.length, 0);
});

test("actionEmail escapes HTML in the link and text", () => {
  const { text, html } = actionEmail({
    heading: "Hi <b>",
    intro: "intro",
    button: "Go",
    url: "https://example.com/?auth=verify&token=abc",
  });
  assert.match(html, /href="https:\/\/example\.com\/\?auth=verify&amp;token=abc"/);
  assert.match(html, /Hi &lt;b&gt;/);
  assert.ok(text.includes("https://example.com/?auth=verify&token=abc"));
});

test("production refuses to issue mail until a provider is configured", async () => {
  process.env.NODE_ENV = "production";
  const account = makeAccount("someone@example.com", "Someone", "hash");
  const state = { tokens: [] } as any;
  await assert.rejects(
    issueMail(state, account, "verify"),
    (e: unknown) => e instanceof ApiError && e.statusCode === 503,
  );
  assert.equal(state.tokens.length, 0);
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "Knockout <no-reply@example.com>";
  const issued = await issueMail(state, account, "verify");
  assert.equal(issued.email, "someone@example.com");
  assert.equal(state.tokens.length, 1);
});

test("registration sends the verification email through Resend", async () => {
  const dir = await mkdtemp(join(tmpdir(), "knockout-mailer-"));
  process.env.DATA_FILE = join(dir, "state.json");
  process.env.SESSION_SECRET = "test-only-session-secret-32-characters-long";
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "Knockout <no-reply@example.com>";
  process.env.PUBLIC_ORIGIN = "http://localhost:5173";
  stubFetch(() => json(200, { id: "email_123" }));
  const { app } = await createApp({ seedDemo: false, logger: false });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "x-knockout-client": "web" },
    payload: {
      email: "new.player@test.local",
      password: "participant-pass-123",
      name: "New Player",
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(
    JSON.parse(res.body).developmentLink,
    undefined,
    "no preview link once real delivery is configured",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual([body.to].flat(), ["new.player@test.local"]);
  assert.equal(body.subject, "Verify your Knockout account");
  assert.match(body.text, /auth=verify&token=[0-9a-f]{64}/);
  assert.match(body.html, /auth=verify&amp;token=[0-9a-f]{64}/);
  await app.close();
});
