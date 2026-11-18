import { Trophy, LockKeyhole } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { KnockoutBracket } from "./motion/knockout-bracket";
import { toBeuiRounds } from "../lib/bracket-adapter";
import type { Match, Round, Side, Tournament } from "@knockout/contracts";

const KnockoutWheel = lazy(() => import("./motion/knockout-wheel").then((module) => ({ default: module.KnockoutWheel })));

export function TeamMark({
  name,
  color = "#9a93bf",
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  const letters =
    name === "To be decided"
      ? "?"
      : name
          .split(/[ .]+/)
          .map((x) => x[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
  return (
    <span
      className={`team-mark ${small ? "small" : ""}`}
      style={{ "--team": color } as React.CSSProperties}
    >
      {letters}
    </span>
  );
}
export const playable = (m: Match) => m.home?.id != null && m.away?.id != null;
export const finished = (m: Match) => Boolean(m.home?.result || m.away?.result);
export function MatchCard({
  match: m,
  onSelect,
  index,
  bestOf,
}: {
  match: Match;
  onSelect: (m: Match) => void;
  index: number;
  bestOf: number;
}) {
  const done = finished(m),
    running = m.status === 3,
    ready = playable(m) && !done && !running;
  const side = (s: Side | null) => (
    <div
      className={`match-side ${s?.result === "win" ? "winner" : ""} ${s?.result === "loss" ? "loser" : ""}`}
    >
      {s?.id != null ? (
        <TeamMark name={s.name} color={s.color} small />
      ) : (
        <span className="unknown-team">{s === null ? "—" : "?"}</span>
      )}
      <span className="side-name">
        {s?.id != null ? s.name : s === null ? "BYE" : "To be decided"}
      </span>
      {s?.seed && (
        <span className="side-seed">{String(s.seed).padStart(2, "0")}</span>
      )}
      <span
        className={`match-score ${s?.result === "win" ? "winning-score" : ""}`}
      >
        {s?.forfeit ? "FF" : (s?.score ?? "–")}
      </span>
      {s?.result === "win" && <span className="winner-arrow">◂</span>}
    </div>
  );
  return (
    <button
      className={`match-card ${done ? "finished" : ""} ${ready ? "ready" : ""} ${running ? "running" : ""}`}
      onClick={() => onSelect(m)}
      aria-label={`Match ${index}: ${m.home?.name ?? "BYE"} versus ${m.away?.name ?? "BYE"}`}
    >
      <div className="match-top">
        <span>
          M{String(index).padStart(2, "0")}{" "}
          <span className="match-format">BO{bestOf}</span>
        </span>
        <span className={ready ? "ready-label" : ""}>
          {running ? (
            <>
              <i className="live-dot" /> IN PROGRESS
            </>
          ) : done ? (
            "FINAL"
          ) : ready ? (
            <>
              <i /> READY TO PLAY
            </>
          ) : (
            <LockKeyhole size={10} />
          )}
        </span>
      </div>
      {side(m.home)}
      {side(m.away)}
      {m.scheduledAt && (
        <div className="match-time">
          {new Date(m.scheduledAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {m.venue && ` · ${m.venue}`}
        </div>
      )}
    </button>
  );
}

function Tree({
  rounds,
  tournament,
  onSelect,
  label,
}: {
  rounds: Round[];
  tournament: Tournament;
  onSelect: (m: Match) => void;
  label?: string;
}) {
  return (
    <section className="tree-section">
      {label && <h3 className="tree-label">{label}</h3>}
      <KnockoutBracket
        key={`${tournament.id}:${rounds.map((round) => `${round.id}-${round.matches.length}`).join(",")}`}
        className="beui-bracket"
        rounds={toBeuiRounds(rounds, tournament.bestOf)}
        initialRound={0}
        onMatchSelect={(match) => {
          const original = tournament.matches.find((item) => String(item.id) === match.id);
          if (original) onSelect(original);
        }}
      />
    </section>
  );
}

export default function Bracket({
  tournament: t,
  onSelect,
}: {
  tournament: Tournament;
  onSelect: (m: Match) => void;
}) {
  const [view, setView] = useState<"tree" | "wheel">("tree");
  if (!t.rounds.length)
    return (
      <div className="empty-state">
        <Trophy size={38} />
        <h3>The stage is yours.</h3>
        <p>
          Add your participants, set their seeds, and generate the bracket to
          get started.
        </p>
      </div>
    );
  const groups = [...new Set(t.rounds.map((r) => r.group))];
  if (t.format === "round_robin")
    return (
      <div className="round-robin-grid">
        {t.rounds.map((r) => (
          <section key={r.id}>
            <h3>{r.name}</h3>
            {r.matches.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                bestOf={t.bestOf}
                onSelect={onSelect}
                index={m.id + 1}
              />
            ))}
          </section>
        ))}
      </div>
    );
  return (
    <>
      {t.format === "single_elimination" && (
        <div className="bracket-view-controls" role="group" aria-label="Bracket display">
          <button type="button" aria-pressed={view === "tree"} onClick={() => setView("tree")}>Bracket tree</button>
          <button type="button" aria-pressed={view === "wheel"} onClick={() => setView("wheel")}>Knockout wheel</button>
        </div>
      )}
      {view === "wheel" && t.format === "single_elimination" ? (
        <section className="wheel-view" aria-label="Knockout wheel view">
          <h3>The road to the trophy</h3>
          <p>Teams start on the outside and advance toward the centre. Hover or tap a node for details; use arrow keys to explore. Switch to the tree to open a match.</p>
          <Suspense fallback={<p role="status">Loading tournament wheel…</p>}>
            <KnockoutWheel className="beui-bracket" rounds={toBeuiRounds(t.rounds.filter((round) => round.group === 1), t.bestOf)} />
          </Suspense>
        </section>
      ) : groups.map((g) => (
        <Tree
          key={g}
          tournament={t}
          onSelect={onSelect}
          rounds={t.rounds.filter((r) => r.group === g)}
          label={
            t.format === "double_elimination"
              ? g === 1
                ? "Upper bracket"
                : g === 2
                  ? "Lower bracket"
                  : "Grand final"
              : undefined
          }
        />
      ))}
    </>
  );
}
