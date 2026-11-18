export type Format =
  | "single_elimination"
  | "double_elimination"
  | "round_robin";
export type EventStatus = "draft" | "live" | "completed" | "archived";
export interface Entry {
  id: string;
  name: string;
  tag: string;
  seed: number;
  color: string;
}
export interface Side {
  id: number | string | null;
  name: string;
  seed?: number;
  color: string;
  score?: number;
  result?: string;
  forfeit?: boolean;
}
export interface Match {
  id: number;
  number: number;
  roundId: number;
  groupId: number;
  round: number;
  group: number;
  status: number;
  home: Side | null;
  away: Side | null;
  scheduledAt?: string;
  durationMinutes?: number;
  venue?: string;
  streamUrl?: string;
}
export interface Round {
  id: number;
  name: string;
  number: number;
  group: number;
  matches: Match[];
}
export interface Audit {
  id: string;
  action: string;
  detail: string;
  at: string;
  before?: unknown;
  after?: unknown;
  actorId?: string;
  actorName?: string;
}
export interface Tournament {
  id: number;
  name: string;
  game: string;
  format: Format;
  status: EventStatus;
  date: string;
  venue: string;
  prize: string;
  bestOf: number;
  capacity: number;
  description: string;
  entries: Entry[];
  revision: number;
  createdAt: string;
  matches: Match[];
  rounds: Round[];
  audit: Audit[];
  registration?: "open" | "closed" | "checkin";
  predictionsEnabled?: boolean;
  stakeLimit?: number;
}
export interface Player {
  id: string;
  name: string;
  tag: string;
  color: string;
  createdAt: string;
}
export const formatLabel: Record<Format, string> = {
  single_elimination: "Single elimination",
  double_elimination: "Double elimination",
  round_robin: "Round robin",
};
