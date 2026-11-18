import { BracketsManager } from "brackets-manager";
import type {
  Match,
  Round,
  Tournament,
  Format,
  Entry,
} from "../../../packages/contracts/src/index.js";
import {
  audit,
  BracketStorage,
  emptyEngine,
  type StoredTournament,
  type State,
} from "./storage.js";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const requireTournament = (s: State, id: number) => {
  const t = s.tournaments.find((t) => t.id === id);
  if (!t) throw new ApiError(404, "Tournament not found.");
  return t;
};
export const colors = [
  "#a98aff",
  "#ff815e",
  "#51cfaa",
  "#68b8ef",
  "#e9b953",
  "#f18ec5",
  "#8dbf71",
  "#ea7487",
];
export const managerFor = (t: StoredTournament) =>
  new BracketsManager(new BracketStorage(t.engine).asInterface());

export function serialize(t: StoredTournament): Tournament {
  const participants = t.engine.participant;
  const matches: Match[] = t.engine.match.map((m) => {
    const round = t.engine.round.find((r) => r.id === m.round_id);
    const group = t.engine.group.find((g) => g.id === m.group_id);
    const side = (op: any) => {
      if (op === null) return null;
      const p = participants.find((p) => p.id === op?.id);
      const entry = t.entries.find((e) => e.name === p?.name);
      return {
        id: op?.id ?? null,
        name: p?.name ?? "To be decided",
        color: entry?.color ?? "#656b79",
        seed: entry?.seed,
        score: op?.score,
        result: op?.result,
        forfeit: op?.forfeit,
      };
    };
    return {
      id: m.id,
      number: m.number,
      roundId: m.round_id,
      groupId: m.group_id,
      round: round?.number ?? 1,
      group: group?.number ?? 1,
      status: m.status,
      home: side(m.opponent1),
      away: side(m.opponent2),
      ...t.metadata[m.id],
    };
  });
  const rounds: Round[] = [...t.engine.round]
    .sort((a, b) => a.group_id - b.group_id || a.number - b.number)
    .map((r) => {
      const group =
        t.engine.group.find((g) => g.id === r.group_id)?.number ?? 1;
      const total = Math.max(
        ...t.engine.round
          .filter((x) => x.group_id === r.group_id)
          .map((x) => x.number),
      );
      const remaining = total - r.number;
      const name =
        t.format === "round_robin"
          ? `Round ${r.number}`
          : remaining === 0
            ? "Final"
            : remaining === 1
              ? "Semifinals"
              : remaining === 2
                ? "Quarterfinals"
                : `Round of ${2 ** (remaining + 1)}`;
      return {
        id: r.id,
        number: r.number,
        group,
        name,
        matches: matches
          .filter((m) => m.roundId === r.id)
          .sort((a, b) => a.number - b.number),
      };
    });
  const { engine, metadata, ...rest } = t;
  return {
    registration: t.status === "draft" ? "open" : "closed",
    predictionsEnabled: false,
    stakeLimit: 25,
    ...rest,
    matches,
    rounds,
  };
}

export async function generate(t: StoredTournament) {
  if (t.status !== "draft" || t.engine.stage.length)
    throw new ApiError(409, "This bracket has already been generated.");
  if (t.entries.length < 2)
    throw new ApiError(400, "Add at least two participants first.");
  const ordered = [...t.entries].sort((a, b) => a.seed - b.seed);
  const size =
    t.format === "round_robin"
      ? ordered.length
      : 2 ** Math.ceil(Math.log2(ordered.length));
  await managerFor(t).create.stage({
    tournamentId: t.id,
    name: "Main stage",
    type: t.format,
    seeding: [
      ...ordered.map((e) => e.name),
      ...Array(size - ordered.length).fill(null),
    ],
    settings: {
      balanceByes: true,
      seedOrdering: [
        t.format === "round_robin" ? "groups.effort_balanced" : "inner_outer",
      ],
      ...(t.format === "round_robin" ? { groupCount: 1 } : {}),
      ...(t.format === "double_elimination"
        ? { grandFinal: "double" as const }
        : {}),
    },
  });
  t.status = "live";
  audit(
    t,
    "BRACKET_GENERATED",
    `Generated ${t.format.replaceAll("_", " ")} bracket with ${ordered.length} participants.`,
  );
}

export async function report(
  t: StoredTournament,
  matchId: number,
  body: {
    homeScore: number;
    awayScore: number;
    forfeit?: "home" | "away";
    reason?: string;
    revision: number;
  },
  override = false,
) {
  if (t.status === "archived")
    throw new ApiError(409, "Archived tournaments are read-only.");
  if (t.revision !== body.revision)
    throw new ApiError(409, "This tournament changed. Refresh and try again.");
  const match = t.engine.match.find((m) => m.id === matchId);
  if (!match) throw new ApiError(404, "Match not found.");
  if (
    (!match.opponent1?.id && match.opponent1?.id !== 0) ||
    (!match.opponent2?.id && match.opponent2?.id !== 0)
  )
    throw new ApiError(
      409,
      "Both participants must be decided before reporting a result.",
    );
  const finished = match.opponent1?.result || match.opponent2?.result;
  if (finished && !override)
    throw new ApiError(
      409,
      "Use a result correction to change a completed match.",
    );
  if (override && !body.reason?.trim())
    throw new ApiError(400, "A reason is required for a correction.");
  if (
    body.homeScore === body.awayScore &&
    !body.forfeit &&
    t.format !== "round_robin"
  )
    throw new ApiError(400, "An elimination match cannot end in a tie.");
  if (
    Math.max(body.homeScore, body.awayScore) > t.bestOf ||
    (!body.forfeit &&
      t.bestOf > 1 &&
      (Math.max(body.homeScore, body.awayScore) !== Math.ceil(t.bestOf / 2) ||
        Math.min(body.homeScore, body.awayScore) >= Math.ceil(t.bestOf / 2)))
  )
    throw new ApiError(400, `Enter a valid best-of-${t.bestOf} series result.`);
  const before = structuredClone(match);
  const manager = managerFor(t);
  if (finished && override) {
    try {
      await manager.reset.matchResults(matchId);
    } catch (e) {
      throw new ApiError(
        409,
        `This result is locked by a later match. ${(e as Error).message}`,
      );
    }
  }
  const winner = body.forfeit
    ? body.forfeit === "home"
      ? "away"
      : "home"
    : body.homeScore > body.awayScore
      ? "home"
      : body.homeScore < body.awayScore
        ? "away"
        : "draw";
  await manager.update.match({
    id: matchId,
    opponent1: {
      score: body.homeScore,
      result: winner === "draw" ? "draw" : winner === "home" ? "win" : "loss",
      ...(body.forfeit === "home" ? { forfeit: true } : {}),
    },
    opponent2: {
      score: body.awayScore,
      result: winner === "draw" ? "draw" : winner === "away" ? "win" : "loss",
      ...(body.forfeit === "away" ? { forfeit: true } : {}),
    },
  });
  const view = serialize(t);
  const competitive = view.matches.filter(
    (m) => m.home?.id != null && m.away?.id != null,
  );
  const pending = view.matches.filter(
    (m) => m.status < 4 && (m.home?.id != null || m.away?.id != null),
  );
  t.status =
    competitive.length > 0 && pending.length === 0 ? "completed" : "live";
  const home = view.matches.find((m) => m.id === matchId)?.home?.name;
  const away = view.matches.find((m) => m.id === matchId)?.away?.name;
  audit(
    t,
    override
      ? "RESULT_CORRECTED"
      : body.forfeit
        ? "FORFEIT_RECORDED"
        : "RESULT_REPORTED",
    `${home} ${body.homeScore} – ${body.awayScore} ${away}${body.reason ? ` · ${body.reason}` : ""}`,
    before,
    structuredClone(t.engine.match.find((m) => m.id === matchId)),
  );
}

export function newTournament(
  id: number,
  data: {
    name: string;
    game: string;
    format: Format;
    date: string;
    venue: string;
    prize: string;
    bestOf: number;
    capacity: number;
    description: string;
  },
): StoredTournament {
  return {
    ...data,
    id,
    status: "draft",
    entries: [],
    revision: 0,
    createdAt: new Date().toISOString(),
    audit: [],
    engine: emptyEngine(),
    metadata: {},
  };
}

export async function seed(s: State) {
  const names = [
    "Sentinels",
    "Paper Rex",
    "Fnatic",
    "DRX",
    "Team Liquid",
    "LOUD",
    "Gen.G",
    "Cloud9",
    "G2 Esports",
    "Team Heretics",
    "NRG",
    "100 Thieves",
    "T1",
    "EDward Gaming",
    "Karmine Corp",
    "Leviatán",
  ];
  s.players = names.map((name, i) => ({
    id: crypto.randomUUID(),
    name,
    tag:
      name.replace(/[^A-Z0-9]/g, "").slice(0, 3) ||
      name.slice(0, 3).toUpperCase(),
    color: colors[i % colors.length],
    createdAt: new Date().toISOString(),
  }));
  const t = newTournament(1, {
    name: "Midnight Invitational",
    game: "VALORANT",
    format: "single_elimination",
    date: "2026-10-24T12:30:00.000Z",
    venue: "Mumbai, India",
    prize: "₹50,000",
    bestOf: 3,
    capacity: 16,
    description:
      "Sixteen teams. One champion. Welcome to the Midnight Invitational — where every round matters.",
  });
  t.entries = s.players.map((p, i): Entry => ({ ...p, seed: i + 1 }));
  await generate(t);
  for (const match of [...t.engine.match]
    .filter((m) => m.round_id === 0)
    .slice(0, 4))
    await report(t, match.id, {
      homeScore: 2,
      awayScore: match.number % 2,
      revision: t.revision,
    });
  s.tournaments.push(t);
}
