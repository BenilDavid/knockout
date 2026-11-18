import { test } from "node:test";
import assert from "node:assert/strict";
import type { Match } from "@knockout/contracts";
import { toBeuiMatch, toBeuiRounds } from "./bracket-adapter";

const match: Match = {
  id: 42, number: 1, roundId: 1, groupId: 1, round: 1, group: 1, status: 2,
  home: { id: 1, name: "Alpha", color: "#fff" },
  away: { id: 2, name: "Beta", color: "#fff" },
};

test("BeUI distinguishes byes from unresolved opponents and preserves match IDs", () => {
  const mapped = toBeuiMatch({ ...match, home: null, away: { id: null, name: "To be decided", color: "#fff" } }, 3);
  assert.equal(mapped.id, "42");
  assert.equal(mapped.home.team?.name, "BYE");
  assert.equal(mapped.away.team, null);
  assert.equal(mapped.away.score, null);
  assert.equal(mapped.badge, "BO3");
});

test("BeUI uses official outcomes including zero scores, draws, live play and forfeits", () => {
  const result = toBeuiMatch({ ...match, home: { ...match.home!, score: 0, result: "loss", forfeit: true }, away: { ...match.away!, score: 2, result: "win" } }, 3);
  assert.equal(result.home.score, 0);
  assert.equal(result.winner, "away");
  assert.equal(result.status, "finished");
  assert.equal(result.badge, "Forfeit");
  assert.equal(toBeuiMatch({ ...match, status: 3 }, 3).badge, "Live");
  const draw = toBeuiMatch({ ...match, home: { ...match.home!, result: "draw" } }, 3);
  assert.equal(draw.status, "finished");
  assert.equal(draw.winner, undefined);
});

test("BeUI retains server round and match order and scheduled times", () => {
  const rounds = toBeuiRounds([{ id: 1, name: "Upper final", number: 1, group: 1, matches: [{ ...match, scheduledAt: "2026-10-21T12:30:00Z" }, { ...match, id: 43 }] }], 5);
  assert.equal(rounds[0].name, "Upper final");
  assert.deepEqual(rounds[0].matches.map((item) => item.id), ["42", "43"]);
  assert.ok(rounds[0].matches[0].date);
  assert.ok(rounds[0].matches[0].time);
});
