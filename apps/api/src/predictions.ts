import type { State, StoredTournament } from "./storage.js";
import { audit } from "./storage.js";
import { ApiError, serialize } from "./tournaments.js";
import type { Account, Market, Wallet } from "./phase-types.js";
import { now, staff } from "./identity.js";

export function walletFor(s: State, userId: string, tournamentId: number) {
  const w = s.wallets.find(
    (w) => w.userId === userId && w.tournamentId === tournamentId,
  );
  if (!w)
    throw new ApiError(403, "An approved prediction membership is required.");
  return w;
}
export function entry(
  s: State,
  w: Wallet,
  available: number,
  reserved: number,
  kind: string,
  key: string,
  reason: string,
  actorId: string,
) {
  if (s.ledger.some((l) => l.key === key)) return;
  if (
    !Number.isSafeInteger(w.available + available) ||
    w.available + available < 0 ||
    w.reserved + reserved < 0
  )
    throw new ApiError(409, "Insufficient available points.");
  w.available += available;
  w.reserved += reserved;
  s.ledger.push({
    id: crypto.randomUUID(),
    walletId: w.id,
    key,
    kind,
    availableDelta: available,
    reservedDelta: reserved,
    reason,
    actorId,
    createdAt: now(),
  });
}
export function grant(s: State, u: Account, tid: number, actorId: string) {
  let w = s.wallets.find((w) => w.userId === u.id && w.tournamentId === tid);
  if (!w) {
    w = {
      id: crypto.randomUUID(),
      userId: u.id,
      tournamentId: tid,
      available: 0,
      reserved: 0,
    };
    s.wallets.push(w);
  }
  entry(
    s,
    w,
    100,
    0,
    "grant",
    `grant:${tid}:${u.id}`,
    "Tournament welcome points",
    actorId,
  );
  return w;
}
export function ownMatch(
  s: State,
  u: Account,
  t: StoredTournament,
  matchId: number,
) {
  const m = serialize(t).matches.find((m) => m.id === matchId);
  if (!m) return false;
  const playerIds = new Set([
    ...s.teamMembers
      .filter((x) => x.userId === u.id && x.accepted)
      .map((x) => x.playerId),
    ...s.memberships
      .filter((x) => x.userId === u.id && x.tournamentId === t.id && x.playerId)
      .map((x) => x.playerId!),
  ]);
  return t.entries.some(
    (e) =>
      playerIds.has(e.id) &&
      (e.name === m.home?.name || e.name === m.away?.name),
  );
}
export function canPredict(
  s: State,
  u: Account,
  t: StoredTournament,
  mid: number,
) {
  if (staff(s, u, t.id))
    throw new ApiError(
      403,
      "Tournament staff cannot predict matches they control.",
    );
  if (ownMatch(s, u, t, mid))
    throw new ApiError(403, "You cannot predict your own match.");
  if (
    !s.memberships.some(
      (m) =>
        m.userId === u.id &&
        m.tournamentId === t.id &&
        m.status === "approved" &&
        m.role === "participant",
    )
  )
    throw new ApiError(
      403,
      "Join the prediction pool and wait for approval first.",
    );
  if (t.status === "archived" || !t.predictionsEnabled)
    throw new ApiError(409, "Predictions are not open for this tournament.");
}
export function marketLocked(t: StoredTournament, m: Market) {
  const match = t.engine.match.find((x) => x.id === m.matchId);
  const date = t.metadata[m.matchId]?.scheduledAt;
  return (
    m.state !== "open" ||
    Boolean(m.lockedAt) ||
    (date && Date.parse(date) <= Date.now()) ||
    Boolean(match?.opponent1?.result || match?.opponent2?.result) ||
    match?.status === 3
  );
}
export function synchronize(s: State, t: StoredTournament) {
  if (!t.predictionsEnabled) return;
  for (const market of s.markets.filter((m) => m.tournamentId === t.id)) {
    const match = t.engine.match.find((m) => m.id === market.matchId);
    const changed =
      !match ||
      String(match.opponent1?.id ?? "") !== market.homeId ||
      String(match.opponent2?.id ?? "") !== market.awayId;
    if (changed && market.state === "settled")
      throw new ApiError(
        409,
        "A downstream prediction has settled. Reconcile it before changing this result.",
      );
    if (changed && !["settled", "voided"].includes(market.state))
      refund(
        s,
        t,
        market,
        "Match lineup changed. Original stakes refunded.",
        "system",
      );
  }
  for (const match of t.engine.match) {
    if (match.opponent1?.id == null || match.opponent2?.id == null) continue;
    let m = s.markets.find(
      (x) =>
        x.tournamentId === t.id &&
        x.matchId === match.id &&
        x.stageId === match.stage_id,
    );
    if (!m) {
      m = {
        id: crypto.randomUUID(),
        tournamentId: t.id,
        stageId: match.stage_id,
        matchId: match.id,
        state: "open",
        homeId: String(match.opponent1.id),
        awayId: String(match.opponent2.id),
        lockedAt: null,
        winner: null,
        settledAt: null,
      };
      s.markets.push(m);
    }
    if (
      m.homeId !== String(match.opponent1.id) ||
      m.awayId !== String(match.opponent2.id)
    ) {
      if (m.state === "settled")
        throw new ApiError(
          409,
          "A downstream prediction has settled. Reconcile that market before changing this result.",
        );
      if (
        s.predictions.some(
          (p) => p.marketId === m!.id && p.status === "reserved",
        )
      )
        refund(
          s,
          t,
          m,
          "Lineup changed after an official correction.",
          "system",
        );
      if (m.state !== "voided") {
        m.homeId = String(match.opponent1.id);
        m.awayId = String(match.opponent2.id);
      }
    }
    if (m.state === "settled" || m.state === "voided") continue;
    if (match.opponent1.result || match.opponent2.result) {
      m.state = "pending";
      m.lockedAt ??= now();
      m.winner =
        match.opponent1.result === "win"
          ? "home"
          : match.opponent2.result === "win"
            ? "away"
            : "draw";
    } else if (marketLocked(t, m)) {
      m.state = "locked";
      m.lockedAt ??= now();
    }
  }
}
export function place(
  s: State,
  t: StoredTournament,
  u: Account,
  marketId: string,
  side: string,
  stake: number,
) {
  synchronize(s, t);
  const m = s.markets.find((m) => m.id === marketId && m.tournamentId === t.id);
  if (!m) throw new ApiError(404, "Prediction market not found.");
  canPredict(s, u, t, m.matchId);
  if (marketLocked(t, m))
    throw new ApiError(
      409,
      "This match is locked. Predictions cannot be changed.",
    );
  const canonical = t.engine.match.find((x) => x.id === m.matchId);
  if (
    canonical?.opponent1?.id == null ||
    canonical?.opponent2?.id == null ||
    String(canonical.opponent1.id) !== m.homeId ||
    String(canonical.opponent2.id) !== m.awayId
  )
    throw new ApiError(409, "The match lineup has changed.");
  if (stake < 1 || stake > (t.stakeLimit ?? 25))
    throw new ApiError(
      400,
      `Stake between 1 and ${t.stakeLimit ?? 25} points.`,
    );
  const w = walletFor(s, u.id, t.id);
  let p = s.predictions.find((p) => p.marketId === m.id && p.userId === u.id);
  if (w.available + (p?.status === "reserved" ? p.stake : 0) < stake)
    throw new ApiError(409, "Insufficient available points.");
  const version = crypto.randomUUID();
  if (p?.status === "reserved")
    entry(
      s,
      w,
      p.stake,
      -p.stake,
      "release",
      `release:${version}`,
      "Previous stake released",
      u.id,
    );
  if (!p) {
    p = {
      id: crypto.randomUUID(),
      marketId: m.id,
      userId: u.id,
      side,
      stake,
      payout: 0,
      status: "reserved",
      updatedAt: now(),
    };
    s.predictions.push(p);
  }
  Object.assign(p, {
    side,
    stake,
    payout: 0,
    status: "reserved",
    updatedAt: now(),
  });
  entry(
    s,
    w,
    -stake,
    stake,
    "reserve",
    `reserve:${version}`,
    `Prediction reserved for match ${m.matchId + 1}`,
    u.id,
  );
  return p;
}
export function cancel(
  s: State,
  t: StoredTournament,
  u: Account,
  marketId: string,
) {
  const m = s.markets.find((m) => m.id === marketId && m.tournamentId === t.id);
  if (!m) throw new ApiError(404, "Market not found.");
  if (marketLocked(t, m)) throw new ApiError(409, "This match is locked.");
  const p = s.predictions.find((p) => p.marketId === m.id && p.userId === u.id);
  if (!p || p.status !== "reserved") return;
  entry(
    s,
    walletFor(s, u.id, t.id),
    p.stake,
    -p.stake,
    "release",
    `cancel:${crypto.randomUUID()}`,
    "Prediction cancelled",
    u.id,
  );
  p.status = "cancelled";
  p.stake = 0;
  p.updatedAt = now();
}
export function refund(
  s: State,
  t: StoredTournament,
  m: Market,
  reason: string,
  actorId: string,
) {
  if (m.state === "voided") return;
  if (m.state === "settled")
    throw new ApiError(409, "Use settled-market reconciliation.");
  for (const p of s.predictions.filter(
    (p) => p.marketId === m.id && p.status === "reserved",
  )) {
    entry(
      s,
      walletFor(s, p.userId, t.id),
      p.stake,
      -p.stake,
      "refund",
      `refund:${m.id}:${p.id}`,
      reason,
      actorId,
    );
    p.status = "refunded";
    p.payout = p.stake;
    p.updatedAt = now();
  }
  m.state = "voided";
  m.settledAt = now();
  audit(t, "MARKET_VOIDED", `Match ${m.matchId + 1}: ${reason}`);
}
export function settle(
  s: State,
  t: StoredTournament,
  m: Market,
  actorId: string,
) {
  if (m.state === "settled" || m.state === "voided") return;
  synchronize(s, t);
  if (m.state !== "pending")
    throw new ApiError(
      409,
      "An official result is required before finalization.",
    );
  const match = t.engine.match.find((x) => x.id === m.matchId)!;
  const ps = s.predictions.filter(
    (p) => p.marketId === m.id && p.status === "reserved",
  );
  if (
    m.winner === "draw" ||
    match.opponent1?.forfeit ||
    match.opponent2?.forfeit ||
    new Set(ps.map((p) => p.side)).size < 2
  ) {
    refund(
      s,
      t,
      m,
      "Draw, forfeit, or one-sided pool: stakes refunded.",
      actorId,
    );
    return;
  }
  const total = ps.reduce((n, p) => n + p.stake, 0);
  const winners = ps.filter((p) => p.side === m.winner);
  const denominator = winners.reduce((n, p) => n + p.stake, 0);
  const payouts = winners
    .map((p) => ({
      id: p.id,
      amount: Math.floor((total * p.stake) / denominator),
      remainder: (total * p.stake) % denominator,
    }))
    .sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  let remainder = total - payouts.reduce((n, p) => n + p.amount, 0);
  for (const p of payouts) {
    if (remainder-- > 0) p.amount++;
  }
  for (const p of ps) {
    const payout = payouts.find((x) => x.id === p.id)?.amount ?? 0;
    entry(
      s,
      walletFor(s, p.userId, t.id),
      payout,
      -p.stake,
      "payout",
      `settle:${m.id}:${p.id}`,
      `Finalized match ${m.matchId + 1}`,
      actorId,
    );
    p.payout = payout;
    p.status = "settled";
    p.updatedAt = now();
  }
  m.state = "settled";
  m.settledAt = now();
  audit(
    t,
    "PREDICTIONS_SETTLED",
    `Match ${m.matchId + 1} finalized. ${total} points distributed.`,
  );
}
export function reconcile(
  s: State,
  t: StoredTournament,
  m: Market,
  reason: string,
  actorId: string,
) {
  if (m.state === "voided") return;
  if (m.state !== "settled") return refund(s, t, m, reason, actorId);
  const ps = s.predictions.filter(
    (p) => p.marketId === m.id && p.status === "settled",
  );
  // Refuse to create debt or claw back points reserved in other matches.
  for (const p of ps)
    if (walletFor(s, p.userId, t.id).available + p.stake - p.payout < 0)
      throw new ApiError(
        409,
        "A payout has been spent. Release unlocked stakes or make a reasoned wallet adjustment before reconciliation. No balances changed.",
      );
  for (const p of ps) {
    entry(
      s,
      walletFor(s, p.userId, t.id),
      p.stake - p.payout,
      0,
      "reconciliation",
      `reconcile:${m.id}:${p.id}`,
      reason,
      actorId,
    );
    p.status = "refunded";
    p.payout = p.stake;
    p.updatedAt = now();
  }
  m.state = "voided";
  audit(t, "MARKET_RECONCILED", `Match ${m.matchId + 1}: ${reason}`);
}
