import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Repository, audit, type State } from "./storage.js";
import {
  requireUser,
  requireAdmin,
  requireStaff,
  staff,
  now,
} from "./identity.js";
import { publicUser } from "./phase-types.js";
import {
  ApiError,
  requireTournament,
  serialize,
  colors,
  report,
  managerFor,
} from "./tournaments.js";
import {
  synchronize,
  grant,
  ownMatch,
  marketLocked,
  place,
  cancel,
  settle,
  refund,
  reconcile,
  entry,
  walletFor,
} from "./predictions.js";

const integer = z.coerce.number().int().min(0);
const reasonSchema = z.string().trim().min(5).max(1000);
export async function mutateAs<T>(
  repo: Repository,
  req: FastifyRequest,
  fn: (s: State) => Promise<T> | T,
): Promise<T> {
  return repo.mutate(async (s) => {
    const current = s.accounts.find(
      (u) => u.id === req.user?.id && !u.disabled,
    );
    const session = s.sessions.find(
      (x) => x.id === req.sessionId && !x.revoked && x.expiresAt > now(),
    );
    if (!current || !session || current.role !== req.user?.role)
      throw new ApiError(401, "Your session changed. Sign in again.");
    req.user = current;
    if (!req.routeOptions.config.phase2) {
      const tid = /^\/api\/tournaments\/(\d+)/.exec(req.url)?.[1];
      if (tid && /\/(result|metadata)$/.test(req.url))
        requireStaff(s, req, Number(tid));
      else requireAdmin(req);
    }
    const prior = new Set(
      s.tournaments.flatMap((t) => t.audit.map((a) => a.id)),
    );
    for (const t of s.tournaments) synchronize(s, t);
    const result = await fn(s);
    for (const t of s.tournaments) {
      synchronize(s, t);
      for (const a of t.audit)
        if (!prior.has(a.id)) {
          a.actorId = current.id;
          a.actorName = current.name;
        }
    }
    // Engine propagation can void downstream markets and append audit records.
    // Return the revision after those consequences have been applied.
    if (
      result &&
      typeof result === "object" &&
      "matches" in result &&
      "rounds" in result &&
      "id" in result &&
      typeof result.id === "number"
    )
      return serialize(requireTournament(s, result.id)) as T;
    return result;
  });
}
export function publicTournament(s: State, tid: number, req: FastifyRequest) {
  const t = serialize(requireTournament(s, tid));
  if (!staff(s, req.user, tid))
    t.audit = t.audit
      .filter(
        (a) =>
          !/(MEMBER|STAFF|WALLET|MARKET|SUBMISSION|PREDICTION)/.test(a.action),
      )
      .map(({ before, after, actorId, ...a }) => a);
  return t;
}
export function installCommunity(
  app: FastifyInstance,
  repo: Repository,
  changed: (id: number) => void,
) {
  const route = (method: any, url: string, handler: any) =>
    app.route({ method, url, config: { phase2: true }, handler });
  const tid = (req: FastifyRequest) => integer.parse((req.params as any).id);
  const mid = (req: FastifyRequest) =>
    integer.parse((req.params as any).matchId);
  const write = async (
    req: FastifyRequest,
    fn: (s: State) => Promise<unknown> | unknown,
  ) => {
    const result = await mutateAs(repo, req, fn);
    if ((req.params as any)?.id) changed(tid(req));
    return result ?? { ok: true };
  };
  route(
    "POST",
    "/api/tournaments/:id/markets/:marketId/reopen",
    async (req: FastifyRequest) => {
      requireAdmin(req);
      const { reason } = z.object({ reason: reasonSchema }).parse(req.body);
      return write(req, (s) => {
        const t = requireTournament(s, tid(req));
        if (t.status !== "live")
          throw new ApiError(409, "Only an active event can reopen a market.");
        const m = s.markets.find(
          (m) =>
            m.id === (req.params as any).marketId && m.tournamentId === t.id,
        );
        if (!m || m.state !== "locked")
          throw new ApiError(
            409,
            "Only an unplayed locked market can be reopened.",
          );
        const match = t.engine.match.find((x) => x.id === m.matchId);
        const schedule = t.metadata[m.matchId]?.scheduledAt;
        if (
          !match ||
          match.status === 3 ||
          match.opponent1?.result ||
          match.opponent2?.result ||
          (schedule && Date.parse(schedule) <= Date.now())
        )
          throw new ApiError(
            409,
            "Reschedule to a future time before reopening an unplayed match. Started and finished matches stay locked.",
          );
        m.state = "open";
        m.lockedAt = null;
        audit(t, "MARKET_REOPENED", `Match ${m.matchId + 1}: ${reason}`);
      });
    },
  );
  route(
    "POST",
    "/api/tournaments/:id/members/:memberId/checkin",
    async (req: FastifyRequest) => {
      const { reason } = z.object({ reason: reasonSchema }).parse(req.body);
      return write(req, (s) => {
        const t = requireTournament(s, tid(req));
        requireStaff(s, req, t.id);
        if (t.registration !== "checkin" || t.status !== "draft")
          throw new ApiError(409, "Check-in is not open.");
        const m = s.memberships.find(
          (m) =>
            m.id === (req.params as any).memberId &&
            m.tournamentId === t.id &&
            m.status === "approved" &&
            m.kind === "competitor",
        );
        if (!m)
          throw new ApiError(404, "Approved competition entry not found.");
        m.checkedIn = true;
        audit(
          t,
          "MEMBER_CHECKED_IN",
          `${s.accounts.find((a) => a.id === m.userId)?.name} checked in by staff. ${reason}`,
        );
      });
    },
  );
  route("GET", "/api/me/workspace", async (req: FastifyRequest) => {
    const u = requireUser(req);
    const s = await repo.snapshot();
    return {
      memberships: s.memberships.filter((m) => m.userId === u.id),
      wallets: s.wallets.filter((w) => w.userId === u.id),
      ledger: s.ledger
        .filter((l) =>
          s.wallets.some((w) => w.id === l.walletId && w.userId === u.id),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      teams: s.teamMembers
        .filter((m) => m.userId === u.id)
        .map((m) => ({
          ...m,
          player: s.players.find((p) => p.id === m.playerId),
        })),
      predictions: s.predictions.filter((p) => p.userId === u.id),
      notifications: s.submissions.filter(
        (x) =>
          u.notifications &&
          x.userId === u.id &&
          ["rejected", "approved", "disputed"].includes(x.status),
      ),
    };
  });
  route("GET", "/api/admin/users", async (req: FastifyRequest) => {
    requireAdmin(req);
    return (await repo.snapshot()).accounts.map((u) => ({
      ...publicUser(u),
      disabled: u.disabled,
    }));
  });
  route(
    "POST",
    "/api/admin/players/:playerId/owner",
    async (req: FastifyRequest) => {
      requireAdmin(req);
      const b = z
        .object({ userId: z.string(), reason: reasonSchema })
        .parse(req.body);
      return write(req, (s) => {
        const playerId = (req.params as any).playerId;
        const p = s.players.find((p) => p.id === playerId),
          u = s.accounts.find(
            (u) => u.id === b.userId && u.verified && !u.disabled,
          );
        if (!p || !u)
          throw new ApiError(404, "Verified account or player not found.");
        const events = s.tournaments.filter((t) =>
          t.entries.some((e) => e.id === playerId),
        );
        if (
          events.some((t) =>
            s.predictions.some(
              (p) =>
                p.userId === u.id &&
                p.status === "reserved" &&
                s.markets.some(
                  (m) => m.id === p.marketId && m.tournamentId === t.id,
                ),
            ),
          )
        )
          throw new ApiError(
            409,
            "Resolve this account’s predictions in affected events before assigning ownership.",
          );
        for (const m of s.teamMembers.filter(
          (m) => m.playerId === playerId && m.role === "captain",
        ))
          m.role = "member";
        let member = s.teamMembers.find(
          (m) => m.playerId === playerId && m.userId === u.id,
        );
        if (member) Object.assign(member, { role: "captain", accepted: true });
        else
          s.teamMembers.push({
            id: crypto.randomUUID(),
            playerId,
            userId: u.id,
            role: "captain",
            accepted: true,
          });
        for (const t of events)
          audit(
            t,
            "MEMBER_OWNER_ASSIGNED",
            `${p.name} assigned to ${u.name}. ${b.reason}`,
          );
        return { message: "Existing player/team ownership assigned." };
      });
    },
  );
  route("PATCH", "/api/admin/users/:userId", async (req: FastifyRequest) => {
    requireAdmin(req);
    const b = z
      .object({
        disabled: z.boolean().optional(),
        role: z.enum(["admin", "participant"]).optional(),
        // Manually verify an account whose email could not be confirmed.
        verified: z.literal(true).optional(),
        reason: reasonSchema,
      })
      .parse(req.body);
    return write(req, (s) => {
      requireAdmin(req);
      const u = s.accounts.find((u) => u.id === (req.params as any).userId);
      if (!u) throw new ApiError(404, "Account not found.");
      if (u.id === req.user!.id)
        throw new ApiError(
          409,
          "Use another administrator to change your own access.",
        );
      if (
        b.role === "admin" &&
        s.predictions.some((p) => p.userId === u.id && p.status === "reserved")
      )
        throw new ApiError(
          409,
          "Resolve this account’s predictions before granting staff access.",
        );
      if (b.disabled !== undefined) u.disabled = b.disabled;
      if (b.role) u.role = b.role;
      const verifiedNow = b.verified && !u.verified;
      if (verifiedNow) {
        u.verified = true;
        // Old verification links must not work after manual approval.
        for (const tok of s.tokens.filter(
          (x) => x.userId === u.id && x.kind === "verify",
        ))
          tok.used = true;
      }
      for (const session of s.sessions.filter((x) => x.userId === u.id))
        session.revoked = true;
      for (const t of s.tournaments)
        audit(
          t,
          "STAFF_ACCOUNT_CHANGED",
          `${u.name}: ${verifiedNow ? "verified by administrator. " : ""}${b.reason}`,
        );
      return publicUser(u);
    });
  });
  route("POST", "/api/teams", async (req: FastifyRequest) => {
    const u = requireUser(req);
    const b = z
      .object({
        name: z.string().trim().min(2).max(80),
        tag: z.string().trim().min(1).max(8),
      })
      .parse(req.body);
    return write(req, (s) => {
      if (s.players.some((p) => p.name.toLowerCase() === b.name.toLowerCase()))
        throw new ApiError(409, "This name is already taken.");
      const p = {
        id: crypto.randomUUID(),
        ...b,
        color: colors[s.players.length % colors.length],
        createdAt: now(),
      };
      s.players.push(p);
      s.teamMembers.push({
        id: crypto.randomUUID(),
        userId: u.id,
        playerId: p.id,
        role: "captain",
        accepted: true,
      });
      return p;
    });
  });
  route("POST", "/api/teams/:playerId/invite", async (req: FastifyRequest) => {
    const u = requireUser(req);
    const b = z
      .object({ email: z.email().trim().toLowerCase() })
      .parse(req.body);
    return write(req, (s) => {
      const playerId = (req.params as any).playerId;
      if (
        !s.teamMembers.some(
          (m) =>
            m.userId === u.id &&
            m.playerId === playerId &&
            m.role === "captain" &&
            m.accepted,
        )
      )
        throw new ApiError(403, "Only the team captain can invite members.");
      const member = s.accounts.find(
        (a) => a.email === b.email && a.verified && !a.disabled,
      );
      if (!member)
        throw new ApiError(
          404,
          "Ask this person to register and verify their account first.",
        );
      if (
        s.teamMembers.some(
          (m) => m.userId === member.id && m.playerId === playerId,
        )
      )
        throw new ApiError(409, "Already invited or a team member.");
      for (const membership of s.memberships.filter(
        (m) => m.playerId === playerId && m.status === "approved",
      )) {
        const t = requireTournament(s, membership.tournamentId);
        if (
          s.predictions.some(
            (p) =>
              p.userId === member.id &&
              s.markets.some(
                (m) => m.id === p.marketId && m.tournamentId === t.id,
              ) &&
              p.status === "reserved",
          )
        )
          throw new ApiError(
            409,
            "This person has active predictions in a tournament involving this team.",
          );
      }
      s.teamMembers.push({
        id: crypto.randomUUID(),
        userId: member.id,
        playerId,
        role: "member",
        accepted: false,
      });
      return { message: "Invitation added to their account." };
    });
  });
  route("POST", "/api/me/teams/:memberId/accept", async (req: FastifyRequest) =>
    write(req, (s) => {
      const m = s.teamMembers.find(
        (m) =>
          m.id === (req.params as any).memberId && m.userId === req.user!.id,
      );
      if (!m) throw new ApiError(404, "Invitation not found.");
      if (
        s.predictions.some(
          (p) =>
            p.userId === req.user!.id &&
            p.status === "reserved" &&
            s.markets.some(
              (x) =>
                x.id === p.marketId &&
                s.tournaments.some(
                  (t) =>
                    t.id === x.tournamentId &&
                    t.entries.some((e) => e.id === m.playerId),
                ),
            ),
        )
      )
        throw new ApiError(
          409,
          "Cancel your eligible open predictions involving this team before accepting.",
        );
      m.accepted = true;
    }),
  );
  route(
    "GET",
    "/api/tournaments/:id/community",
    async (req: FastifyRequest) => {
      const s = await repo.snapshot();
      const t = requireTournament(s, tid(req));
      synchronize(s, t);
      const u = req.user;
      const isStaff = staff(s, u, t.id);
      const wallets = s.wallets.filter((w) => w.tournamentId === t.id);
      const sorted = [...wallets].sort(
        (a, b) =>
          b.available + b.reserved - (a.available + a.reserved) ||
          a.userId.localeCompare(b.userId),
      );
      return {
        membership:
          s.memberships.find(
            (m) => m.tournamentId === t.id && m.userId === u?.id,
          ) ?? null,
        staff: isStaff,
        ownMatches: u
          ? t.engine.match
              .filter((m) => ownMatch(s, u, t, m.id))
              .map((m) => m.id)
          : [],
        registration:
          t.registration ?? (t.status === "draft" ? "open" : "closed"),
        predictionsEnabled: t.predictionsEnabled ?? false,
        stakeLimit: t.stakeLimit ?? 25,
        members: isStaff
          ? s.memberships
              .filter((m) => m.tournamentId === t.id)
              .map((m) => ({
                ...m,
                name:
                  s.accounts.find((a) => a.id === m.userId)?.name ?? "Unknown",
                player: s.players.find((p) => p.id === m.playerId)?.name,
              }))
          : [],
        markets: s.markets
          .filter((m) => m.tournamentId === t.id)
          .sort((a, b) => a.matchId - b.matchId)
          .map((m) => {
            const locked = marketLocked(t, m);
            const ps = s.predictions.filter(
              (p) => p.marketId === m.id && p.status !== "cancelled",
            );
            return {
              ...m,
              state: m.state === "open" && locked ? "locked" : m.state,
              mine: ps.find((p) => p.userId === u?.id) ?? null,
              ...(locked
                ? {
                    homePool: ps
                      .filter((p) => p.side === "home")
                      .reduce((n, p) => n + p.stake, 0),
                    awayPool: ps
                      .filter((p) => p.side === "away")
                      .reduce((n, p) => n + p.stake, 0),
                  }
                : {}),
              eligible: Boolean(u && !isStaff && !ownMatch(s, u, t, m.matchId)),
            };
          }),
        wallet: wallets.find((w) => w.userId === u?.id) ?? null,
        wallets:
          u?.role === "admin"
            ? wallets.map((w) => ({
                ...w,
                name:
                  s.accounts.find((a) => a.id === w.userId)?.name ??
                  "Participant",
              }))
            : [],
        leaderboard: sorted.map((w, i) => ({
          rank:
            1 +
            sorted.filter(
              (x) => x.available + x.reserved > w.available + w.reserved,
            ).length,
          userId: w.userId,
          name:
            s.accounts.find((a) => a.id === w.userId)?.name ?? "Participant",
          points: w.available + w.reserved,
          reserved: w.userId === u?.id ? w.reserved : null,
          correct: s.predictions.filter(
            (p) =>
              p.userId === w.userId &&
              p.status === "settled" &&
              s.markets.some(
                (m) =>
                  m.id === p.marketId &&
                  m.tournamentId === t.id &&
                  p.side === m.winner,
              ),
          ).length,
        })),
        submissions: s.submissions
          .filter(
            (x) =>
              x.tournamentId === t.id &&
              (isStaff || (u && ownMatch(s, u, t, x.matchId))),
          )
          .map((x) => ({
            ...x,
            name:
              s.accounts.find((a) => a.id === x.userId)?.name ?? "Participant",
          })),
      };
    },
  );
  route("POST", "/api/tournaments/:id/join", async (req: FastifyRequest) => {
    const u = requireUser(req);
    const b = z
      .object({
        kind: z.enum(["competitor", "predictor"]),
        playerId: z.string().optional(),
      })
      .parse(req.body);
    return write(req, (s) => {
      const t = requireTournament(s, tid(req));
      if (t.status === "archived" || t.status === "completed")
        throw new ApiError(409, "This event is closed.");
      if (staff(s, u, t.id))
        throw new ApiError(
          403,
          "Staff cannot join their own prediction competition.",
        );
      if (
        s.memberships.some((m) => m.tournamentId === t.id && m.userId === u.id)
      )
        throw new ApiError(
          409,
          "Your request is already recorded. Contact the organizer if it was rejected.",
        );
      if (
        b.kind === "competitor" &&
        (t.status !== "draft" || (t.registration ?? "open") !== "open")
      )
        throw new ApiError(409, "Competition registration is closed.");
      if (b.kind === "predictor" && !t.predictionsEnabled)
        throw new ApiError(409, "Predictions are not enabled for this event.");
      let playerId = b.playerId ?? null;
      if (b.kind === "competitor") {
        if (
          !playerId ||
          !s.teamMembers.some(
            (m) =>
              m.userId === u.id &&
              m.playerId === playerId &&
              m.accepted &&
              m.role === "captain",
          )
        )
          throw new ApiError(
            403,
            "Create a player/team profile or select one you captain.",
          );
      } else playerId = null;
      s.memberships.push({
        id: crypto.randomUUID(),
        tournamentId: t.id,
        userId: u.id,
        playerId,
        kind: b.kind,
        role: "participant",
        status: "pending",
        checkedIn: false,
        createdAt: now(),
      });
      audit(
        t,
        "MEMBERSHIP_REQUESTED",
        `${u.name} requested ${b.kind} membership.`,
      );
      return { message: "Request sent. Await organizer approval." };
    });
  });
  route(
    "PATCH",
    "/api/tournaments/:id/members/:memberId",
    async (req: FastifyRequest) => {
      const b = z
        .object({
          status: z.enum(["approved", "rejected"]),
          reason: reasonSchema,
        })
        .parse(req.body);
      return write(req, (s) => {
        const t = requireTournament(s, tid(req));
        requireStaff(s, req, t.id);
        if (t.status === "archived")
          throw new ApiError(409, "Archived events are read-only.");
        const m = s.memberships.find(
          (m) =>
            m.id === (req.params as any).memberId && m.tournamentId === t.id,
        );
        if (!m) throw new ApiError(404, "Request not found.");
        if (m.role === "operator")
          throw new ApiError(409, "Use staff management for operators.");
        if (m.status === "approved" && b.status === "rejected") {
          if (t.status !== "draft" && m.kind === "competitor")
            throw new ApiError(
              409,
              "Competition entries are locked. Resolve the match through the forfeit workflow.",
            );
          for (const market of s.markets.filter(
            (x) => x.tournamentId === t.id,
          )) {
            const p = s.predictions.find(
              (p) =>
                p.marketId === market.id &&
                p.userId === m.userId &&
                p.status === "reserved",
            );
            if (p)
              throw new ApiError(
                409,
                "Resolve this participant’s active predictions first.",
              );
          }
          t.entries = t.entries
            .filter((e) => e.id !== m.playerId)
            .map((e, i) => ({ ...e, seed: i + 1 }));
        }
        if (b.status === "approved" && m.status !== "approved") {
          const u = s.accounts.find((u) => u.id === m.userId)!;
          if (u.disabled || !u.verified)
            throw new ApiError(409, "This account is not eligible.");
          if (m.kind === "competitor") {
            if (t.status !== "draft")
              throw new ApiError(409, "Bracket entries are locked.");
            if (!t.entries.some((e) => e.id === m.playerId)) {
              if (t.entries.length >= t.capacity)
                throw new ApiError(409, "The tournament is full.");
              const p = s.players.find((p) => p.id === m.playerId)!;
              if (t.entries.some((e) => e.name === p.name))
                throw new ApiError(409, "This team is already entered.");
              t.entries.push({ ...p, seed: t.entries.length + 1 });
            }
          }
          grant(s, u, t.id, req.user!.id);
        }
        m.status = b.status;
        audit(
          t,
          "MEMBERSHIP_REVIEWED",
          `${s.accounts.find((u) => u.id === m.userId)?.name}: ${b.status}. ${b.reason}`,
        );
      });
    },
  );
  route("POST", "/api/tournaments/:id/checkin", async (req: FastifyRequest) =>
    write(req, (s) => {
      const t = requireTournament(s, tid(req));
      if (t.registration !== "checkin" || t.status !== "draft")
        throw new ApiError(409, "Check-in is not open.");
      const m = s.memberships.find(
        (m) =>
          m.tournamentId === t.id &&
          m.userId === req.user!.id &&
          m.kind === "competitor" &&
          m.status === "approved",
      );
      if (!m)
        throw new ApiError(403, "An approved competition entry is required.");
      m.checkedIn = true;
      audit(t, "MEMBER_CHECKED_IN", `${req.user!.name} checked in.`);
    }),
  );
  route(
    "PATCH",
    "/api/tournaments/:id/workflow",
    async (req: FastifyRequest) => {
      const b = z
        .object({
          registration: z.enum(["open", "closed", "checkin"]).optional(),
          predictionsEnabled: z.boolean().optional(),
          stakeLimit: z.number().int().min(1).max(100).optional(),
        })
        .parse(req.body);
      return write(req, (s) => {
        const t = requireTournament(s, tid(req));
        requireAdmin(req);
        if (t.status === "archived")
          throw new ApiError(409, "Archived events are read-only.");
        if (b.registration && t.status !== "draft")
          throw new ApiError(
            409,
            "Competition registration is locked after generation.",
          );
        if (
          b.predictionsEnabled === false &&
          s.markets.some(
            (m) =>
              m.tournamentId === t.id &&
              s.predictions.some(
                (p) => p.marketId === m.id && p.status === "reserved",
              ),
          )
        )
          throw new ApiError(
            409,
            "Void or settle active prediction markets before disabling.",
          );
        if (
          b.stakeLimit &&
          b.stakeLimit !== (t.stakeLimit ?? 25) &&
          s.predictions.some((p) =>
            s.markets.some(
              (m) => m.id === p.marketId && m.tournamentId === t.id,
            ),
          )
        )
          throw new ApiError(
            409,
            "Stake limits are locked after the first prediction.",
          );
        Object.assign(t, b);
        synchronize(s, t);
        audit(
          t,
          "WORKFLOW_UPDATED",
          "Registration and prediction rules updated.",
        );
      });
    },
  );
  route("POST", "/api/tournaments/:id/staff", async (req: FastifyRequest) => {
    requireAdmin(req);
    const b = z
      .object({
        userId: z.string(),
        role: z.enum(["operator", "participant"]),
        reason: reasonSchema,
      })
      .parse(req.body);
    return write(req, (s) => {
      const t = requireTournament(s, tid(req));
      if (t.status === "archived")
        throw new ApiError(409, "Archived events are read-only.");
      const u = s.accounts.find(
        (u) => u.id === b.userId && u.verified && !u.disabled,
      );
      if (!u) throw new ApiError(404, "Verified account not found.");
      if (
        b.role === "operator" &&
        (s.memberships.some(
          (m) =>
            m.tournamentId === t.id &&
            m.userId === u.id &&
            m.kind === "competitor" &&
            m.status === "approved",
        ) ||
          s.predictions.some(
            (p) =>
              p.userId === u.id &&
              p.status === "reserved" &&
              s.markets.some(
                (m) => m.id === p.marketId && m.tournamentId === t.id,
              ),
          ))
      )
        throw new ApiError(
          409,
          "Competitors and active predictors cannot become tournament staff.",
        );
      let m = s.memberships.find(
        (m) => m.userId === u.id && m.tournamentId === t.id,
      );
      if (!m) {
        m = {
          id: crypto.randomUUID(),
          tournamentId: t.id,
          userId: u.id,
          playerId: null,
          kind: "staff",
          role: b.role,
          status: "approved",
          checkedIn: false,
          createdAt: now(),
        };
        s.memberships.push(m);
      }
      m.role = b.role;
      if (b.role === "participant") m.status = "rejected";
      audit(t, "STAFF_ASSIGNED", `${u.name}: ${b.role}. ${b.reason}`);
    });
  });
  route(
    "POST",
    "/api/tournaments/:id/matches/:matchId/start",
    async (req: FastifyRequest) =>
      write(req, async (s) => {
        const t = requireTournament(s, tid(req));
        requireStaff(s, req, t.id);
        if (t.status !== "live")
          throw new ApiError(409, "The tournament is not in progress.");
        const m = t.engine.match.find((x) => x.id === mid(req));
        if (
          !m ||
          m.opponent1?.id == null ||
          m.opponent2?.id == null ||
          m.opponent1.result ||
          m.opponent2.result
        )
          throw new ApiError(
            409,
            "Both opponents must be ready and the match must be unfinished.",
          );
        synchronize(s, t);
        for (const market of s.markets.filter(
          (x) =>
            x.tournamentId === t.id && x.matchId === m.id && x.state === "open",
        )) {
          market.state = "locked";
          market.lockedAt = now();
        }
        await managerFor(t).update.match({ id: m.id, status: 3 });
        audit(
          t,
          "MATCH_STARTED",
          `Match ${m.id + 1} started. Predictions locked.`,
        );
      }),
  );
  route(
    "POST",
    "/api/tournaments/:id/matches/:matchId/submissions",
    async (req: FastifyRequest) => {
      const b = z
        .object({
          homeScore: z.number().int().min(0).max(999),
          awayScore: z.number().int().min(0).max(999),
          evidence: z.string().trim().max(2000),
        })
        .parse(req.body);
      return write(req, (s) => {
        const t = requireTournament(s, tid(req));
        if (t.status !== "live" || !ownMatch(s, req.user!, t, mid(req)))
          throw new ApiError(
            403,
            "Only a competitor in this match can submit its score.",
          );
        const match = t.engine.match.find((m) => m.id === mid(req));
        if (match?.opponent1?.result || match?.opponent2?.result)
          throw new ApiError(409, "This match already has an official result.");
        if (
          s.submissions.some(
            (x) =>
              x.tournamentId === t.id &&
              x.matchId === mid(req) &&
              x.userId === req.user!.id &&
              ["pending", "confirmed", "disputed"].includes(x.status),
          )
        )
          throw new ApiError(409, "Your score is already under review.");
        s.submissions.push({
          id: crypto.randomUUID(),
          tournamentId: t.id,
          matchId: mid(req),
          userId: req.user!.id,
          ...b,
          status: "pending",
          response: "",
          createdAt: now(),
        });
        audit(
          t,
          "SUBMISSION_ADDED",
          `A competitor submitted match ${mid(req) + 1} for review.`,
        );
      });
    },
  );
  route(
    "POST",
    "/api/tournaments/:id/submissions/:submissionId/respond",
    async (req: FastifyRequest) => {
      const b = z
        .object({
          action: z.enum(["confirm", "dispute"]),
          reason: reasonSchema,
        })
        .parse(req.body);
      return write(req, (s) => {
        const t = requireTournament(s, tid(req));
        const x = s.submissions.find(
          (x) =>
            x.id === (req.params as any).submissionId &&
            x.tournamentId === t.id,
        );
        if (!x) throw new ApiError(404, "Submission not found.");
        if (
          t.status !== "live" ||
          x.userId === req.user!.id ||
          !ownMatch(s, req.user!, t, x.matchId)
        )
          throw new ApiError(403, "Only the opposing competitor can respond.");
        const author = s.accounts.find((a) => a.id === x.userId)!;
        const match = serialize(t).matches.find((m) => m.id === x.matchId)!;
        const teams = (u: string) =>
          s.teamMembers
            .filter((m) => m.userId === u && m.accepted)
            .map((m) => m.playerId);
        if (teams(author.id).some((id) => teams(req.user!.id).includes(id)))
          throw new ApiError(
            403,
            "A teammate cannot confirm their own team’s submission.",
          );
        if (!["pending", "confirmed", "disputed"].includes(x.status))
          throw new ApiError(409, "Already reviewed.");
        x.status = b.action === "confirm" ? "confirmed" : "disputed";
        x.response = b.reason;
        audit(t, "SUBMISSION_RESPONDED", `Match ${match.id + 1}: ${x.status}.`);
      });
    },
  );
  route(
    "POST",
    "/api/tournaments/:id/submissions/:submissionId/review",
    async (req: FastifyRequest) => {
      const b = z
        .object({ approve: z.boolean(), reason: reasonSchema })
        .parse(req.body);
      return write(req, async (s) => {
        const t = requireTournament(s, tid(req));
        requireStaff(s, req, t.id);
        const x = s.submissions.find(
          (x) =>
            x.id === (req.params as any).submissionId &&
            x.tournamentId === t.id,
        );
        if (!x) throw new ApiError(404, "Submission not found.");
        if (!["pending", "confirmed", "disputed"].includes(x.status))
          throw new ApiError(409, "Already reviewed.");
        if (b.approve) {
          await report(t, x.matchId, {
            homeScore: x.homeScore,
            awayScore: x.awayScore,
            revision: t.revision,
          });
          for (const other of s.submissions.filter(
            (y) =>
              y.tournamentId === t.id &&
              y.matchId === x.matchId &&
              y.id !== x.id &&
              ["pending", "confirmed", "disputed"].includes(y.status),
          )) {
            other.status = "rejected";
            other.response = "Another submission was accepted.";
          }
        }
        x.status = b.approve ? "approved" : "rejected";
        x.response = b.reason;
        audit(
          t,
          "SUBMISSION_REVIEWED",
          `Match ${x.matchId + 1}: ${x.status}. ${b.reason}`,
        );
      });
    },
  );
  route(
    "PUT",
    "/api/tournaments/:id/markets/:marketId/prediction",
    async (req: FastifyRequest) => {
      const b = z
        .object({
          side: z.enum(["home", "away"]),
          stake: z.number().int().min(1).max(100),
        })
        .parse(req.body);
      return write(req, (s) =>
        place(
          s,
          requireTournament(s, tid(req)),
          req.user!,
          (req.params as any).marketId,
          b.side,
          b.stake,
        ),
      );
    },
  );
  route(
    "DELETE",
    "/api/tournaments/:id/markets/:marketId/prediction",
    async (req: FastifyRequest) =>
      write(req, (s) =>
        cancel(
          s,
          requireTournament(s, tid(req)),
          req.user!,
          (req.params as any).marketId,
        ),
      ),
  );
  for (const action of ["finalize", "void", "reconcile"] as const)
    route(
      "POST",
      `/api/tournaments/:id/markets/:marketId/${action}`,
      async (req: FastifyRequest) => {
        requireAdmin(req);
        const { reason } = z.object({ reason: reasonSchema }).parse(req.body);
        return write(req, (s) => {
          const t = requireTournament(s, tid(req));
          if (t.status === "archived")
            throw new ApiError(409, "Archived events are read-only.");
          const m = s.markets.find(
            (m) =>
              m.id === (req.params as any).marketId && m.tournamentId === t.id,
          );
          if (!m) throw new ApiError(404, "Market not found.");
          if (action === "finalize") settle(s, t, m, req.user!.id);
          else if (action === "void") refund(s, t, m, reason, req.user!.id);
          else reconcile(s, t, m, reason, req.user!.id);
          audit(
            t,
            "MARKET_REVIEWED",
            `Match ${m.matchId + 1}: ${action}. ${reason}`,
          );
        });
      },
    );
  route(
    "POST",
    "/api/tournaments/:id/wallets/:walletId/adjust",
    async (req: FastifyRequest) => {
      requireAdmin(req);
      const b = z
        .object({
          amount: z
            .number()
            .int()
            .min(-10000)
            .max(10000)
            .refine((x) => x !== 0),
          reason: reasonSchema,
          requestId: z.uuid(),
        })
        .parse(req.body);
      return write(req, (s) => {
        const t = requireTournament(s, tid(req));
        if (t.status === "archived")
          throw new ApiError(409, "Archived events are read-only.");
        const w = s.wallets.find(
          (w) =>
            w.id === (req.params as any).walletId && w.tournamentId === t.id,
        );
        if (!w) throw new ApiError(404, "Wallet not found.");
        const old = s.ledger.find((l) => l.key === `adjust:${b.requestId}`);
        if (old) {
          if (old.walletId !== w.id || old.availableDelta !== b.amount)
            throw new ApiError(409, "Adjustment key was already used.");
          return;
        }
        entry(
          s,
          w,
          b.amount,
          0,
          "adjustment",
          `adjust:${b.requestId}`,
          b.reason,
          req.user!.id,
        );
        audit(
          t,
          "WALLET_ADJUSTED",
          `${s.accounts.find((a) => a.id === w.userId)?.name}: ${b.amount > 0 ? "+" : ""}${b.amount}. ${b.reason}`,
        );
      });
    },
  );
}
