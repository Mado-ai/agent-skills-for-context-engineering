export interface PlayerStat {
  player_id: string | number;
  team: string;
  jersey?: number | null;
  distance_m: number;
  top_speed_ms: number;
  avg_speed_ms?: number;
  sprints?: number;
  touches?: number;
  passes?: number;
  pass_accuracy?: number | null;
  turnovers?: number;
  possession_s?: number;
  zones_m?: Record<"walk" | "jog" | "run" | "sprint", number>;
  xt_added?: number;
  progressive_passes?: number;
  final_third_passes?: number;
  shots?: number;
  xg?: number;
}

export interface TeamStat {
  distance_km: number;
  sprints: number;
  passes: number;
  pass_accuracy: number | null;
  turnovers: number;
  top_speed_ms: number;
  xt_added: number;
  progressive_passes: number;
  final_third_passes: number;
  shots: number;
  xg: number;
}

export interface Highlight {
  start_s: number;
  end_s: number;
  peak_speed: number;
  clip: string | null;
}

export interface PossessionPoint {
  t: number;
  home: number;
  away: number;
}

export interface JobSummary {
  possession: Record<string, number>;
  possession_timeline: PossessionPoint[];
  players: PlayerStat[];
  team_stats?: Record<string, TeamStat>;
  heatmaps: Record<string, string>;
  highlights: Highlight[];
  meta: Record<string, string | number>;
}

export interface Job {
  id: string;
  input_name: string;
  detector: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string;
  created_at: number;
  summary?: JobSummary;
}

export interface User {
  email: string;
  is_admin: boolean;
}

// --- organizations / RBAC ---

export interface Org {
  id: string;
  name: string;
  role?: string;
  player_id?: string | null;
}

export interface Member {
  id: string;
  user_id: number;
  role: string;
  player_id: string | null;
  email: string;
}

// --- capture sites / devices ---

export interface Site {
  id: string;
  name: string;
  package: string;
  device_count?: number;
}

export interface Device {
  id: string;
  kind: string;
  name: string;
  last_seen: number | null;
}

export interface SiteJob {
  id: string;
  input_name: string;
  status: string;
  source: string;
  created_at: number;
}

// --- profiles ---

export type FieldBreakdown = Record<"5" | "7" | "11", number>;

export interface TeamSummary {
  id: string;
  name: string;
  player_count: number;
  match_count: number;
  public_token: string | null;
}

export interface Player {
  id: string;
  name: string;
  position: string | null;
  jersey: number | null;
}

export interface Match {
  id: string;
  field_type: number;
  opponent: string | null;
  played_on: string | null;
  home_score: number | null;
  away_score: number | null;
  job_id?: string | null;
}

export interface TeamProfile {
  team: { id: string; name: string; public_token: string | null };
  players: Player[];
  player_count: number;
  matches_by_field: FieldBreakdown;
  record: {
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goals_for: number;
    goals_against: number;
  };
  recent_matches: Match[];
  leaderboard: { player_id: string; name: string; matches: number; distance_m: number; top_speed_ms: number; sprints: number; passes: number; goals: number }[];
}

export interface PlayerProfile {
  player: { id: string; name: string; position: string | null; jersey: number | null };
  team_id: string;
  public_token?: string | null;
  is_minor?: boolean;
  guardian_consent?: boolean;
  matches_by_field: FieldBreakdown;
  totals: {
    matches: number;
    distance_m: number;
    avg_distance_m: number;
    top_speed_ms: number;
    sprints: number;
    passes: number;
    goals: number;
    assists: number;
    minutes: number;
  };
  recent: { match_id: string; field_type: number; opponent: string | null; played_on: string | null; distance_m: number; top_speed_ms: number; sprints?: number; passes?: number; goals: number; assists: number }[];
}
