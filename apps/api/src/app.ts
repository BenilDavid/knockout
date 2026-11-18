import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Server } from "socket.io";
import { installIdentity, requireAdmin, requireStaff } from "./identity.js";
import { installCommunity, mutateAs, publicTournament } from "./community.js";
import { z } from "zod";
import { Repository, audit } from "./storage.js";
import {
  ApiError,
  requireTournament,
  serialize,
  generate,
  report,
  newTournament,
  seed,
  colors,
} from "./tournaments.js";

const format = z.enum([
  "single_elimination",
  "double_elimination",
  "round_robin",
]);
const text = z.string().trim().min(1).max(100);
const tournamentSchema = z.object({
  name: text,
  game: text,
  format,
  date: z.iso.datetime(),
  venue: z.string().trim().max(150).default("Online"),
  prize: z.string().trim().max(80).default(""),
  bestOf: z
    .union([z.literal(1), z.literal(3), z.literal(5), z.literal(7)])
    .default(3),
  capacity: z.number().int().min(2).max(128).default(16),
  description: z.string().trim().max(2000).default(""),
});
const resultSchema = z.object({
  homeScore: z.number().int().min(0).max(999),
  awayScore: z.number().int().min(0).max(999),
  revision: z.number().int().min(0),
  forfeit: z.enum(["home", "away"]).optional(),
  reason: z.string().trim().max(1000).optional(),
});
const id = (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new ApiError(400, "Invalid ID.");
  return n;
};
export async function createApp(
  options: {
    repository?: Repository;
    seedDemo?: boolean;
    logger?: boolean;
  } = {},
) {
  const repo = options.repository ?? new Repository();
  const production = process.env.NODE_ENV === "production";

  if (
    production &&
    (!process.env.SESSION_SECRET ||
      process.env.SESSION_SECRET.length < 32 ||
      !process.env.DATABASE_URL ||
      !process.env.PUBLIC_ORIGIN?.startsWith("https://"))
  )
    throw new Error(
      "Production requires PostgreSQL, SESSION_SECRET (32+ characters), and an HTTPS PUBLIC_ORIGIN.",
    );
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 128 * 1024,
    trustProxy: (_address: string, hop: number) => production && hop === 0,
  });
  await app.register(cookie, {
    secret: process.env.SESSION_SECRET ?? crypto.randomUUID(),
  });
  const io = new Server(app.server, { maxHttpBufferSize: 10000 });
  await installIdentity(app, repo);
  app.addHook("preHandler", async (req) => {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
      req.routeOptions.config.phase2 ||
      !req.url.startsWith("/api/")
    )
      return;
    const tournamentId = /^\/api\/tournaments\/(\d+)/.exec(req.url)?.[1];
    if (tournamentId && /\/(result|metadata)$/.test(req.url))
      requireStaff(await repo.snapshot(), req, Number(tournamentId));
    else requireAdmin(req);
  });
  app.setErrorHandler((error: any, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error.statusCode)
      return reply.code(error.statusCode).send({ error: error.message });
    req.log.error(error);
    return reply.code(500).send({
      error: "The operation could not be completed. No changes were saved.",
    });
  });
  io.on("connection", (socket) => {
    socket.on("tournament:join", (value: unknown) => {
      const r = z.number().int().positive().safeParse(value);
      if (r.success) socket.join(`tournament:${r.data}`);
    });
    socket.on("tournament:leave", (value: unknown) => {
      if (typeof value === "number") socket.leave(`tournament:${value}`);
    });
  });
  const changed = (tournamentId: number) => {
    io.to(`tournament:${tournamentId}`).emit("bracket:changed", {
      tournamentId,
    });
    io.emit("tournaments:changed");
  };
  installCommunity(app, repo, changed);
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await repo.ready();
    return { status: "ok", storage: repo.mode };
  });
  app.get("/api/tournaments", async (req) => {
    const s = await repo.snapshot();
    return s.tournaments.map((t) => publicTournament(s, t.id, req));
  });
  app.get<{ Params: { id: string } }>("/api/tournaments/:id", async (req) =>
    publicTournament(await repo.snapshot(), id(req.params.id), req),
  );
  app.post("/api/tournaments", async (req, reply) => {
    const body = tournamentSchema.parse(req.body);
    const t = await mutateAs(repo, req, (s) => {
      const t = newTournament(
        Math.max(0, ...s.tournaments.map((t) => t.id)) + 1,
        body,
      );
      audit(
        t,
        "TOURNAMENT_CREATED",
        "Tournament created. Registration is open.",
      );
      s.tournaments.push(t);
      return serialize(t);
    });
    changed(t.id);
    return reply.code(201).send(t);
  });
  app.patch<{ Params: { id: string } }>("/api/tournaments/:id", async (req) => {
    // Zod defaults apply even under partial(); updates must only touch supplied fields.
    const input = z.object({}).passthrough().parse(req.body);
    const body = tournamentSchema
      .partial()
      .extend({ status: z.literal("archived").optional() })
      .parse(input);
    for (const key of Object.keys(body) as (keyof typeof body)[])
      if (!Object.hasOwn(input, key)) delete body[key];
    const t = await mutateAs(repo, req, (s) => {
      const t = requireTournament(s, id(req.params.id));
      if (t.status === "archived")
        throw new ApiError(409, "Archived tournaments are read-only.");
      if (
        body.status === "archived" &&
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
          "Settle or void all reserved predictions before archiving.",
        );
      if (
        t.engine.stage.length &&
        (body.format || body.bestOf || body.capacity)
      )
        throw new ApiError(
          409,
          "Bracket settings are locked after generation.",
        );
      if (body.capacity && body.capacity < t.entries.length)
        throw new ApiError(
          400,
          "Capacity cannot be smaller than the number of registered participants.",
        );
      Object.assign(t, body);
      audit(
        t,
        body.status ? "TOURNAMENT_ARCHIVED" : "SETTINGS_UPDATED",
        body.status ? "Tournament archived." : "Tournament details updated.",
      );
      return serialize(t);
    });
    changed(t.id);
    return t;
  });
  app.get("/api/players", async () => (await repo.snapshot()).players);
  app.post("/api/players", async (req, reply) => {
    const body = z
      .object({ name: text, tag: z.string().trim().min(1).max(8) })
      .parse(req.body);
    const player = await mutateAs(repo, req, (s) => {
      if (
        s.players.some((p) => p.name.toLowerCase() === body.name.toLowerCase())
      )
        throw new ApiError(409, "A participant with this name already exists.");
      const p = {
        id: crypto.randomUUID(),
        ...body,
        color: colors[s.players.length % colors.length],
        createdAt: new Date().toISOString(),
      };
      s.players.push(p);
      return p;
    });
    return reply.code(201).send(player);
  });
  app.post<{ Params: { id: string } }>(
    "/api/tournaments/:id/entries",
    async (req) => {
      const body = z.object({ playerId: z.string() }).parse(req.body);
      const t = await mutateAs(repo, req, (s) => {
        const t = requireTournament(s, id(req.params.id));
        if (t.status !== "draft")
          throw new ApiError(
            409,
            "Registration closes once the bracket is generated.",
          );
        if (t.entries.length >= t.capacity)
          throw new ApiError(409, "This tournament is full.");
        const p = s.players.find((p) => p.id === body.playerId);
        if (!p) throw new ApiError(404, "Participant not found.");
        if (
          t.entries.some(
            (e) =>
              e.id === p.id || e.name.toLowerCase() === p.name.toLowerCase(),
          )
        )
          throw new ApiError(409, "This participant is already registered.");
        t.entries.push({ ...p, seed: t.entries.length + 1 });
        audit(t, "PARTICIPANT_ADDED", `${p.name} joined the tournament.`);
        return serialize(t);
      });
      changed(t.id);
      return t;
    },
  );
  app.delete<{ Params: { id: string; entryId: string } }>(
    "/api/tournaments/:id/entries/:entryId",
    async (req) => {
      const t = await mutateAs(repo, req, (s) => {
        const t = requireTournament(s, id(req.params.id));
        if (t.status !== "draft")
          throw new ApiError(
            409,
            "Entries are locked after bracket generation.",
          );
        const e = t.entries.find((e) => e.id === req.params.entryId);
        if (!e) throw new ApiError(404, "Entry not found.");
        t.entries = t.entries
          .filter((e) => e.id !== req.params.entryId)
          .map((e, i) => ({ ...e, seed: i + 1 }));
        audit(t, "PARTICIPANT_REMOVED", `${e.name} removed.`);
        return serialize(t);
      });
      changed(t.id);
      return t;
    },
  );
  app.patch<{ Params: { id: string } }>(
    "/api/tournaments/:id/seeding",
    async (req) => {
      const { entryIds } = z
        .object({ entryIds: z.array(z.string()).min(2).max(128) })
        .parse(req.body);
      const t = await mutateAs(repo, req, (s) => {
        const t = requireTournament(s, id(req.params.id));
        if (t.status !== "draft")
          throw new ApiError(
            409,
            "Seeding is locked after bracket generation.",
          );
        if (
          entryIds.length !== t.entries.length ||
          new Set(entryIds).size !== entryIds.length ||
          entryIds.some((e) => !t.entries.some((x) => x.id === e))
        )
          throw new ApiError(400, "Include every participant exactly once.");
        t.entries = entryIds.map((e, i) => ({
          ...t.entries.find((x) => x.id === e)!,
          seed: i + 1,
        }));
        audit(t, "SEEDING_UPDATED", "Participant seeding updated.");
        return serialize(t);
      });
      changed(t.id);
      return t;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/tournaments/:id/stages",
    async (req) => {
      const t = await mutateAs(repo, req, async (s) => {
        const t = requireTournament(s, id(req.params.id));
        if (
          s.memberships.some(
            (m) =>
              m.tournamentId === t.id &&
              m.kind === "competitor" &&
              m.status === "approved" &&
              !m.checkedIn,
          )
        )
          throw new ApiError(
            409,
            "Every approved competition entrant must check in before bracket generation.",
          );
        await generate(t);
        t.registration = "closed";
        return serialize(t);
      });
      changed(t.id);
      return t;
    },
  );
  for (const action of ["result", "override"] as const)
    app.patch<{ Params: { id: string; matchId: string } }>(
      `/api/tournaments/:id/matches/:matchId/${action}`,
      async (req) => {
        const body = resultSchema.parse(req.body);
        const t = await mutateAs(repo, req, async (s) => {
          const t = requireTournament(s, id(req.params.id));
          if (
            s.markets.some(
              (m) =>
                m.tournamentId === t.id &&
                m.matchId === id(req.params.matchId) &&
                m.state === "settled",
            )
          )
            throw new ApiError(
              409,
              "Reconcile the settled prediction market before correcting this result.",
            );
          await report(t, id(req.params.matchId), body, action === "override");
          return serialize(t);
        });
        changed(t.id);
        return t;
      },
    );
  app.patch<{ Params: { id: string; matchId: string } }>(
    "/api/tournaments/:id/matches/:matchId/metadata",
    async (req) => {
      const body = z
        .object({
          scheduledAt: z.iso.datetime().optional(),
          durationMinutes: z.number().int().min(1).max(1440).default(30),
          venue: z.string().trim().max(150),
          streamUrl: z
            .union([
              z.literal(""),
              z
                .url()
                .refine(
                  (v) => /^https?:\/\//.test(v),
                  "Use an HTTP or HTTPS URL",
                ),
            ])
            .optional(),
        })
        .parse(req.body);
      const t = await mutateAs(repo, req, (s) => {
        const t = requireTournament(s, id(req.params.id));
        if (t.status === "archived")
          throw new ApiError(409, "Archived tournaments are read-only.");
        const matchId = id(req.params.matchId);
        if (!t.engine.match.some((m) => m.id === matchId))
          throw new ApiError(404, "Match not found.");
        if (body.scheduledAt) {
          const current = serialize(t).matches.find((m) => m.id === matchId)!;
          const names = [current.home?.name, current.away?.name].filter(
            (n) => n && n !== "To be decided",
          );
          const start = Date.parse(body.scheduledAt),
            end = start + body.durationMinutes * 60000;
          for (const event of s.tournaments.filter(
            (e) => e.status !== "archived",
          ))
            for (const other of serialize(event).matches) {
              if (
                (event.id === t.id && other.id === matchId) ||
                !other.scheduledAt
              )
                continue;
              const otherStart = Date.parse(other.scheduledAt),
                otherEnd = otherStart + (other.durationMinutes ?? 30) * 60000;
              if (start >= otherEnd || otherStart >= end) continue;
              const sameVenue =
                body.venue &&
                other.venue &&
                body.venue.toLowerCase() === other.venue.toLowerCase();
              const samePlayer = names.some(
                (n) => n === other.home?.name || n === other.away?.name,
              );
              if (sameVenue || samePlayer)
                throw new ApiError(
                  409,
                  `Scheduling conflict with ${event.name}, match ${other.id + 1}. Choose another time or venue.`,
                );
            }
        }
        t.metadata[matchId] = body;
        audit(
          t,
          "MATCH_SCHEDULED",
          `Schedule updated for match ${matchId + 1}.`,
        );
        return serialize(t);
      });
      changed(t.id);
      return t;
    },
  );
  if (options.seedDemo !== false && !production && repo.mode === "local")
    await repo.mutate(async (s) => {
      if (!s.tournaments.length) await seed(s);
    });
  app.addHook("onClose", async () => {
    io.disconnectSockets(true);
    io.close();
    await repo.close();
  });
  return { app, repo, io };
}
