import type { Match, Round, Side } from "@knockout/contracts";
import type { Match as BeuiMatch, Round as BeuiRound } from "@/components/motion/knockout-bracket";

export function toBeuiMatch(match: Match, bestOf: number): BeuiMatch {
  const side = (value: Side | null) => ({
    team: value === null ? { name: "BYE" } : value.id == null ? null : { name: value.name },
    score: value?.score ?? null,
  });
  const finished = Boolean(match.home?.result || match.away?.result);
  const scheduled = match.scheduledAt ? new Date(match.scheduledAt) : null;
  return {
    id: String(match.id),
    home: side(match.home),
    away: side(match.away),
    status: finished ? "finished" : "upcoming",
    winner: match.home?.result === "win" ? "home" : match.away?.result === "win" ? "away" : undefined,
    date: scheduled?.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    time: scheduled?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    badge: match.home?.forfeit || match.away?.forfeit ? "Forfeit" : finished ? "Final" : match.status === 3 ? "Live" : `BO${bestOf}`,
  };
}

export function toBeuiRounds(rounds: Round[], bestOf: number): BeuiRound[] {
  return rounds.map((round) => ({ name: round.name, matches: round.matches.map((match) => toBeuiMatch(match, bestOf)) }));
}
