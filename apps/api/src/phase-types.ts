export interface Account {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  verified: boolean;
  role: string;
  disabled: boolean;
  createdAt: string;
  mfaSecret: string | null;
  mfaPendingSecret: string | null;
  mfaEnabled: boolean;
  mfaLastStep: number;
  notifications: boolean;
  recoveryHashes: string;
}
export interface AccountSession {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  label: string;
  revoked: boolean;
}
export interface AccountToken {
  id: string;
  userId: string;
  kind: string;
  expiresAt: string;
  used: boolean;
}
export interface Membership {
  id: string;
  tournamentId: number;
  userId: string;
  playerId: string | null;
  kind: string;
  role: string;
  status: string;
  checkedIn: boolean;
  createdAt: string;
}
export interface TeamMember {
  id: string;
  playerId: string;
  userId: string;
  role: string;
  accepted: boolean;
}
export interface Wallet {
  id: string;
  tournamentId: number;
  userId: string;
  available: number;
  reserved: number;
}
export interface Ledger {
  id: string;
  walletId: string;
  key: string;
  kind: string;
  availableDelta: number;
  reservedDelta: number;
  reason: string;
  actorId: string;
  createdAt: string;
}
export interface Market {
  id: string;
  tournamentId: number;
  stageId: number;
  matchId: number;
  state: string;
  homeId: string;
  awayId: string;
  lockedAt: string | null;
  winner: string | null;
  settledAt: string | null;
}
export interface Prediction {
  id: string;
  marketId: string;
  userId: string;
  side: string;
  stake: number;
  payout: number;
  status: string;
  updatedAt: string;
}
export interface Submission {
  id: string;
  tournamentId: number;
  matchId: number;
  userId: string;
  homeScore: number;
  awayScore: number;
  evidence: string;
  status: string;
  response: string;
  createdAt: string;
}
export interface PhaseState {
  accounts: Account[];
  sessions: AccountSession[];
  tokens: AccountToken[];
  memberships: Membership[];
  teamMembers: TeamMember[];
  wallets: Wallet[];
  ledger: Ledger[];
  markets: Market[];
  predictions: Prediction[];
  submissions: Submission[];
}
export const phaseTables = {
  accounts: "Account",
  sessions: "AccountSession",
  tokens: "AccountToken",
  memberships: "Membership",
  teamMembers: "TeamMember",
  wallets: "Wallet",
  ledger: "LedgerEntry",
  markets: "PredictionMarket",
  predictions: "Prediction",
  submissions: "MatchSubmission",
} as const;
export const emptyPhase = (): PhaseState => ({
  accounts: [],
  sessions: [],
  tokens: [],
  memberships: [],
  teamMembers: [],
  wallets: [],
  ledger: [],
  markets: [],
  predictions: [],
  submissions: [],
});
export const publicUser = (u: Account) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  verified: u.verified,
  mfaEnabled: u.mfaEnabled,
  notifications: u.notifications,
});
