import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { TOTP, Secret } from "otpauth";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import type { Repository, State } from "./storage.js";
import { ApiError } from "./tournaments.js";
import { publicUser, type Account } from "./phase-types.js";
import {
  actionEmail,
  mailProvider,
  manualVerification,
  pendingApprovalMessage,
  sendMail,
} from "./mailer.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: Account;
    sessionId?: string;
  }
  interface FastifyContextConfig {
    phase2?: boolean;
  }
}
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const now = () => new Date().toISOString();
const password = z.string().min(12, "Use at least 12 characters.").max(128);
const email = z.email().trim().toLowerCase().max(200);
const name = z.string().trim().min(2).max(80);
export const passwordHash = (s: string) =>
  hash(s, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export function makeAccount(
  mail: string,
  display: string,
  passwordHash: string,
  admin = false,
): Account {
  return {
    id: crypto.randomUUID(),
    email: mail.toLowerCase(),
    name: display,
    passwordHash,
    verified: admin,
    role: admin ? "admin" : "participant",
    disabled: false,
    createdAt: now(),
    mfaSecret: null,
    mfaPendingSecret: null,
    mfaEnabled: false,
    mfaLastStep: 0,
    notifications: true,
    recoveryHashes: "[]",
  };
}
const unverifiedError = (when: "to continue" | "before signing in") =>
  new ApiError(
    403,
    manualVerification()
      ? "Your account is waiting for administrator approval."
      : `Verify your email ${when}.`,
  );
export function requireUser(req: FastifyRequest): Account {
  if (!req.user || req.user.disabled)
    throw new ApiError(401, "Sign in to continue.");
  if (!req.user.verified) throw unverifiedError("to continue");
  return req.user;
}
export function requireAdmin(req: FastifyRequest) {
  const u = requireUser(req);
  if (u.role !== "admin")
    throw new ApiError(403, "Administrator access is required.");
  if (process.env.NODE_ENV === "production" && !u.mfaEnabled)
    throw new ApiError(
      403,
      "Enable two-factor authentication in Account settings before managing events.",
    );
  return u;
}
export function staff(s: State, u: Account | undefined, tournamentId: number) {
  return Boolean(
    u &&
      !u.disabled &&
      u.verified &&
      (u.role === "admin" ||
        s.memberships.some(
          (m) =>
            m.userId === u.id &&
            m.tournamentId === tournamentId &&
            m.role === "operator" &&
            m.status === "approved",
        )),
  );
}
export function requireStaff(s: State, req: FastifyRequest, tid: number) {
  const u = requireUser(req);
  if (u.role === "admin") requireAdmin(req);
  if (!staff(s, u, tid))
    throw new ApiError(403, "You are not assigned to manage this tournament.");
  return u;
}
const encryptionKey = () => {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new ApiError(
      503,
      "Configure SESSION_SECRET (32+ characters) to use two-factor authentication.",
    );
  return createHash("sha256").update(process.env.SESSION_SECRET).digest();
};
function encrypt(value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [
    iv.toString("hex"),
    c.getAuthTag().toString("hex"),
    body.toString("hex"),
  ].join(".");
}
function decrypt(value: string) {
  const [iv, tag, body] = value.split(".");
  const c = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "hex"),
  );
  c.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    c.update(Buffer.from(body, "hex")),
    c.final(),
  ]).toString("utf8");
}
function validateMfa(u: Account, token: string) {
  if (!u.mfaSecret) throw new ApiError(400, "Set up an authenticator first.");
  const recovery: string[] = JSON.parse(u.recoveryHashes);
  if (recovery.includes(digest(token))) {
    u.recoveryHashes = JSON.stringify(
      recovery.filter((x) => x !== digest(token)),
    );
    return;
  }
  const delta = new TOTP({
    secret: Secret.fromBase32(decrypt(u.mfaSecret)),
  }).validate({ token, window: 1 });
  const step = Math.floor(Date.now() / 30000) + (delta ?? 0);
  if (delta === null || step <= u.mfaLastStep)
    throw new ApiError(401, "Invalid or already-used authenticator code.");
  u.mfaLastStep = step;
}
export async function issueMail(
  s: State,
  u: Account,
  kind: "verify" | "reset",
) {
  // With manual verification, accounts can be approved by an administrator
  // even when no email provider is configured (verification mail only).
  if (
    process.env.NODE_ENV === "production" &&
    !mailProvider() &&
    !(manualVerification() && kind === "verify")
  )
    throw new ApiError(
      503,
      "Email delivery is not configured. Contact the organizer.",
    );
  for (const t of s.tokens.filter((t) => t.userId === u.id && t.kind === kind))
    t.used = true;
  const raw = randomBytes(32).toString("hex");
  s.tokens.push({
    id: digest(raw),
    userId: u.id,
    kind,
    used: false,
    expiresAt: new Date(
      Date.now() + (kind === "reset" ? 1800000 : 86400000),
    ).toISOString(),
  });
  const url = new URL(process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173");
  url.searchParams.set("auth", kind);
  url.searchParams.set("token", raw);
  return { email: u.email, url: url.toString(), kind };
}
/**
 * pendingApproval is set only when MANUAL_VERIFICATION is on and a verification
 * email could not be sent: the account exists and waits for an administrator.
 */
async function deliver(
  mail: Awaited<ReturnType<typeof issueMail>> | undefined,
): Promise<{ pendingApproval?: boolean; developmentLink?: string }> {
  if (!mail) return {};
  const isVerify = mail.kind === "verify";
  const manual = isVerify && manualVerification();
  let sent = false;
  try {
    sent = await sendMail({
      to: mail.email,
      subject: isVerify
        ? "Verify your Knockout account"
        : "Reset your Knockout password",
      ...actionEmail({
        heading: isVerify ? "Verify your email" : "Reset your password",
        intro: isVerify
          ? "Confirm your email address to finish setting up your Knockout account."
          : "Use the button below to choose a new password for your Knockout account.",
        button: isVerify ? "Verify email" : "Reset password",
        url: mail.url,
      }),
    });
  } catch (err) {
    if (!manual) throw err;
    // The provider error itself is already logged by the mailer.
    console.warn(
      "Verification email was not delivered; the account needs manual verification.",
    );
    return { pendingApproval: true };
  }
  if (sent) return {};
  if (process.env.NODE_ENV !== "production")
    return { developmentLink: mail.url };
  return manual ? { pendingApproval: true } : {};
}
export async function installIdentity(app: FastifyInstance, repo: Repository) {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });
  const dummy = await passwordHash(randomBytes(32).toString("hex"));
  const route = (method: any, url: string, handler: any, limited = false) =>
    app.route({
      method,
      url,
      config: {
        phase2: true,
        ...(limited
          ? { rateLimit: { max: 12, timeWindow: "15 minutes" } }
          : {}),
      },
      handler,
    });
  app.addHook("preHandler", async (req) => {
    const raw = req.cookies.knockout_session;
    if (raw) {
      const found = await repo.sessionContext(digest(raw));
      if (found && !found.session.revoked && found.session.expiresAt > now()) {
        req.user = found.account.disabled ? undefined : found.account;
        req.sessionId = found.session.id;
      }
    }
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers["x-knockout-client"] !== "web")
      throw new ApiError(403, "Missing request verification header.");
    const allowed =
      process.env.NODE_ENV === "production"
        ? [process.env.PUBLIC_ORIGIN]
        : [
            process.env.PUBLIC_ORIGIN,
            "http://127.0.0.1:5173",
            "http://localhost:5173",
          ];
    if (req.headers.origin && !allowed.includes(req.headers.origin))
      throw new ApiError(403, "This origin is not allowed.");
    if (!req.url.startsWith("/api/auth/")) requireUser(req);
  });
  async function session(
    s: State,
    u: Account,
    reply: FastifyReply,
    req: FastifyRequest,
  ) {
    const token = randomBytes(32).toString("hex");
    s.sessions.push({
      id: digest(token),
      userId: u.id,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
      label: String(req.headers["user-agent"] ?? "Browser").slice(0, 180),
      revoked: false,
    });
    // Set-Cookie is sent only after the handler's repository transaction commits.
    return () =>
      reply.setCookie("knockout_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
  }
  route("GET", "/api/session", async (req: FastifyRequest) => ({
    authenticated: Boolean(req.user),
    mode: repo.mode,
    demo: false,
    user: req.user ? publicUser(req.user) : null,
  }));
  route(
    "POST",
    "/api/auth/register",
    async (req: FastifyRequest) => {
      const b = z.object({ email, password, name }).parse(req.body);
      const hashed = await passwordHash(b.password);
      const mail = await repo.mutate(async (s) => {
        if (s.accounts.some((u) => u.email === b.email))
          throw new ApiError(
            409,
            "This email is already registered. Sign in or reset your password.",
          );
        const u = makeAccount(b.email, b.name, hashed);
        s.accounts.push(u);
        return issueMail(s, u, "verify");
      });
      const { pendingApproval, ...extra } = await deliver(mail);
      return {
        message: pendingApproval
          ? pendingApprovalMessage
          : "Check your email to verify your account.",
        ...extra,
      };
    },
    true,
  );
  route(
    "POST",
    "/api/auth/verify",
    async (req: FastifyRequest) => {
      const { token } = z
        .object({ token: z.string().length(64) })
        .parse(req.body);
      await repo.mutate((s) => {
        const t = s.tokens.find(
          (t) =>
            t.id === digest(token) &&
            t.kind === "verify" &&
            !t.used &&
            t.expiresAt > now(),
        );
        if (!t)
          throw new ApiError(
            400,
            "This verification link is invalid or expired.",
          );
        const u = s.accounts.find((u) => u.id === t.userId)!;
        u.verified = true;
        t.used = true;
      });
      return { message: "Email verified. You can now sign in." };
    },
    true,
  );
  route(
    "POST",
    "/api/auth/login",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const b = z
        .object({
          email,
          password: z.string().max(128),
          code: z.string().max(100).optional(),
          admin: z.boolean().optional(),
        })
        .parse(req.body);
      const candidate = (await repo.snapshot()).accounts.find(
        (u) => u.email === b.email,
      );
      const valid = await verify(candidate?.passwordHash ?? dummy, b.password);
      if (!candidate || !valid || candidate.disabled)
        throw new ApiError(401, "Incorrect email or password.");
      if (!candidate.verified) throw unverifiedError("before signing in");
      if (b.admin && candidate.role !== "admin")
        throw new ApiError(403, "This account is not an administrator.");
      if (candidate.mfaEnabled && !b.code)
        return reply.code(401).send({
          error: "Enter your authenticator or recovery code.",
          mfaRequired: true,
        });
      const complete = await repo.mutate(async (s) => {
        const u = s.accounts.find((u) => u.id === candidate.id)!;
        if (u.passwordHash !== candidate.passwordHash || u.disabled)
          throw new ApiError(401, "Account changed. Sign in again.");
        if (u.mfaEnabled) validateMfa(u, b.code ?? "");
        return session(s, u, reply, req);
      });
      complete();
      return { user: publicUser(candidate) };
    },
    true,
  );
  route(
    "POST",
    "/api/auth/logout",
    async (req: FastifyRequest, reply: FastifyReply) => {
      await repo.mutate((s) => {
        const current = s.sessions.find((x) => x.id === req.sessionId);
        if (current) current.revoked = true;
      });
      reply.clearCookie("knockout_session", { path: "/" });
      return { ok: true };
    },
  );
  for (const kind of ["forgot", "resend"] as const)
    route(
      "POST",
      `/api/auth/${kind}`,
      async (req: FastifyRequest) => {
        const b = z.object({ email }).parse(req.body);
        const mail = await repo.mutate(async (s) => {
          const u = s.accounts.find((u) => u.email === b.email && !u.disabled);
          if (u && (kind === "forgot" || !u.verified))
            return issueMail(s, u, kind === "forgot" ? "reset" : "verify");
        });
        const { pendingApproval, ...extra } = await deliver(mail);
        return {
          message:
            "If an eligible account exists, an email has been sent." +
            (kind === "resend" && manualVerification()
              ? " If you don't receive one, ask an administrator to approve your account."
              : ""),
          ...extra,
        };
      },
      true,
    );
  route(
    "POST",
    "/api/auth/reset",
    async (req: FastifyRequest) => {
      const b = z
        .object({ token: z.string().length(64), password })
        .parse(req.body);
      const hashed = await passwordHash(b.password);
      await repo.mutate((s) => {
        const token = s.tokens.find(
          (t) =>
            t.id === digest(b.token) &&
            t.kind === "reset" &&
            !t.used &&
            t.expiresAt > now(),
        );
        if (!token)
          throw new ApiError(400, "This reset link is invalid or expired.");
        const u = s.accounts.find((u) => u.id === token.userId)!;
        u.passwordHash = hashed;
        for (const t of s.tokens.filter(
          (t) => t.userId === u.id && t.kind === "reset",
        ))
          t.used = true;
        for (const x of s.sessions.filter((x) => x.userId === u.id))
          x.revoked = true;
      });
      return { message: "Password updated. Sign in again." };
    },
    true,
  );
  route("PATCH", "/api/me", async (req: FastifyRequest) => {
    const u = requireUser(req);
    const b = z.object({ name, notifications: z.boolean() }).parse(req.body);
    return repo.mutate((s) => {
      const account = s.accounts.find((x) => x.id === u.id)!;
      Object.assign(account, b);
      return publicUser(account);
    });
  });
  route(
    "POST",
    "/api/me/password",
    async (req: FastifyRequest) => {
      const u = requireUser(req);
      const b = z
        .object({ currentPassword: z.string().max(128), password })
        .parse(req.body);
      if (!(await verify(u.passwordHash, b.currentPassword)))
        throw new ApiError(401, "Current password is incorrect.");
      const hashed = await passwordHash(b.password);
      await repo.mutate((s) => {
        const current = s.accounts.find((x) => x.id === u.id)!;
        if (current.passwordHash !== u.passwordHash)
          throw new ApiError(409, "Your password changed. Sign in again.");
        current.passwordHash = hashed;
        for (const x of s.sessions.filter((x) => x.userId === u.id))
          x.revoked = true;
      });
      return { message: "Password changed. Sign in again." };
    },
    true,
  );
  route("GET", "/api/me/sessions", async (req: FastifyRequest) => {
    const u = requireUser(req);
    return (await repo.snapshot()).sessions
      .filter((s) => s.userId === u.id && !s.revoked && s.expiresAt > now())
      .map(({ id, createdAt, expiresAt, label }) => ({
        id,
        createdAt,
        expiresAt,
        label,
        current: id === req.sessionId,
      }));
  });
  route("DELETE", "/api/me/sessions/:id", async (req: FastifyRequest) => {
    const u = requireUser(req);
    await repo.mutate((s) => {
      const x = s.sessions.find(
        (s) => s.id === (req.params as any).id && s.userId === u.id,
      );
      if (!x) throw new ApiError(404, "Session not found.");
      x.revoked = true;
    });
    return { ok: true };
  });
  route(
    "POST",
    "/api/me/mfa/setup",
    async (req: FastifyRequest) => {
      const u = requireUser(req);
      const b = z
        .object({
          password: z.string().max(128),
          code: z.string().max(100).optional(),
        })
        .parse(req.body);
      if (!(await verify(u.passwordHash, b.password)))
        throw new ApiError(401, "Password is incorrect.");
      const totp = new TOTP({ issuer: "Knockout", label: u.email });
      await repo.mutate((s) => {
        const current = s.accounts.find((x) => x.id === u.id)!;
        if (current.passwordHash !== u.passwordHash)
          throw new ApiError(409, "Account changed. Sign in again.");
        if (current.mfaEnabled) validateMfa(current, b.code ?? "");
        current.mfaPendingSecret = encrypt(totp.secret.base32);
      });
      return { secret: totp.secret.base32, uri: totp.toString() };
    },
    true,
  );
  route(
    "POST",
    "/api/me/mfa/enable",
    async (req: FastifyRequest) => {
      const u = requireUser(req);
      const { code } = z.object({ code: z.string().length(6) }).parse(req.body);
      return repo.mutate((s) => {
        const a = s.accounts.find((a) => a.id === u.id)!;
        if (!a.mfaPendingSecret)
          throw new ApiError(409, "Set up an authenticator first.");
        const pending = {
          ...a,
          mfaSecret: a.mfaPendingSecret,
          mfaLastStep: 0,
          recoveryHashes: "[]",
        };
        validateMfa(pending, code);
        a.mfaSecret = a.mfaPendingSecret;
        a.mfaPendingSecret = null;
        a.mfaLastStep = pending.mfaLastStep;
        a.mfaEnabled = true;
        for (const session of s.sessions.filter(
          (x) => x.userId === a.id && x.id !== req.sessionId,
        ))
          session.revoked = true;
        const recoveryCodes = Array.from({ length: 8 }, () =>
          randomBytes(8).toString("hex"),
        );
        a.recoveryHashes = JSON.stringify(recoveryCodes.map(digest));
        return { recoveryCodes };
      });
    },
    true,
  );
  route(
    "POST",
    "/api/me/mfa/disable",
    async (req: FastifyRequest) => {
      const u = requireUser(req);
      if (process.env.NODE_ENV === "production" && u.role === "admin")
        throw new ApiError(
          403,
          "Two-factor authentication is required for administrators.",
        );
      const b = z
        .object({ password: z.string().max(128), code: z.string().max(100) })
        .parse(req.body);
      if (!(await verify(u.passwordHash, b.password)))
        throw new ApiError(401, "Password is incorrect.");
      await repo.mutate((s) => {
        const a = s.accounts.find((a) => a.id === u.id)!;
        validateMfa(a, b.code);
        a.mfaEnabled = false;
        a.mfaSecret = null;
        a.mfaPendingSecret = null;
        a.recoveryHashes = "[]";
        a.mfaLastStep = 0;
        for (const x of s.sessions.filter(
          (x) => x.userId === a.id && x.id !== req.sessionId,
        ))
          x.revoked = true;
      });
      return { ok: true };
    },
    true,
  );
}
