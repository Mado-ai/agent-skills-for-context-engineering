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
  accelerations?: number;
  decelerations?: number;
  hsr_m?: number;
  sprint_dist_m?: number;
  xa?: number;
  line_breaking_passes?: number;
  packing?: number;
  runs_in_behind?: number;
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
  final_third_entries?: number;
  final_third_time_s?: number;
  final_third_channels?: { left: number; center: number; right: number };
  xa?: number;
  line_breaking_passes?: number;
  packing?: number;
  runs_in_behind?: number;
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

export interface Shot {
  team: string;
  /** Normalised attacking-direction coords (0 = own goal, 1 = target goal). */
  xn: number;
  yn: number;
  xg: number;
  t: number;
}

export interface PassNode {
  jersey: number;
  x: number;
  y: number;
  passes: number;
}

export interface PassEdge {
  a: number;
  b: number;
  count: number;
}

export interface PassNetwork {
  nodes: PassNode[];
  edges: PassEdge[];
}

export interface JobSummary {
  possession: Record<string, number>;
  possession_timeline: PossessionPoint[];
  players: PlayerStat[];
  team_stats?: Record<string, TeamStat>;
  heatmaps: Record<string, string>;
  highlights: Highlight[];
  meta: Record<string, string | number>;
  /** Tactical visuals. */
  shots?: Shot[];
  pass_network?: Record<string, PassNetwork>;
  /** Per-team 18-cell (3 width x 6 length) normalised territory grid. */
  zones?: Record<string, number[]>;
  /** False for tracking-data sources that have no broadcast video. */
  broadcast?: boolean;
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
  avatar?: boolean;
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
  leaderboard: { player_id: string; name: string; matches: number; distance_m: number; top_speed_ms: number; sprints: number; passes: number; passes_completed?: number; pass_accuracy?: number | null; shots?: number; shots_on_target?: number; fouls?: number; goals: number; assists?: number; avatar?: boolean }[];
}

export interface PlayerProfile {
  player: { id: string; name: string; position: string | null; jersey: number | null; avatar?: boolean };
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
    passes_completed?: number;
    pass_accuracy?: number | null;
    shots?: number;
    shots_on_target?: number;
    fouls?: number;
    goals: number;
    assists: number;
    minutes: number;
    key_passes?: number;
    crosses?: number;
    dribbles?: number;
    tackles?: number;
    interceptions?: number;
    clearances?: number;
    blocks?: number;
    duels_won?: number;
    recoveries?: number;
    offsides?: number;
    yellow_cards?: number;
    red_cards?: number;
    saves?: number;
  };
  recent: { match_id: string; field_type: number; opponent: string | null; played_on: string | null; distance_m: number; top_speed_ms: number; sprints?: number; passes?: number; passes_completed?: number; shots?: number; shots_on_target?: number; fouls?: number; goals: number; assists: number }[];
  trends?: TrendPoint[];
  benchmarks?: Benchmark[];
}

export interface TrendPoint {
  match_id: string | null;
  played_on: string | null;
  opponent: string | null;
  distance_m: number;
  top_speed_ms: number;
  sprints: number;
  passes: number;
  pass_accuracy: number | null;
  goals: number;
  assists: number;
}

export interface Benchmark {
  key: string;
  label: string;
  value: number;
  percentile: number;
  team_avg: number;
  team_best: number;
}

// --- coach tools ---

export interface ClipTag {
  id: string;
  job_id?: string;
  t: number;
  label: string;
  note?: string | null;
  player_id?: string | null;
  player_name?: string | null;
}

export type Shape =
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: "ellipse"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: "rect"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: "free"; points: number[]; color: string };

export interface Telestration {
  id: string;
  job_id?: string;
  name: string;
  t: number;
  shapes: Shape[];
  created_at?: number;
}

export interface PlaybookToken {
  id: string;
  x: number;
  y: number;
  label: string;
  team: "home" | "away" | "ball";
}

export interface PlaybookArrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
}

export interface PlaybookData {
  tokens: PlaybookToken[];
  arrows: PlaybookArrow[];
  notes?: string;
}

export interface Playbook {
  id: string;
  team_id: string;
  name: string;
  field_type: number;
  data: PlaybookData;
  created_at?: number;
}

export interface ScoutingReport {
  team: { id: string; name: string; public_token?: string | null };
  record: { played: number; wins: number; draws: number; losses: number; goals_for: number; goals_against: number };
  matches: number;
  danger_men: { player_id: string; name: string; goals: number; assists?: number; shots?: number; matches: number; avatar?: boolean }[];
  totals: { goals: number; assists: number; shots: number; shots_on_target: number; fouls: number; yellow_cards: number; red_cards: number };
  attacking: {
    channels: { left: number; center: number; right: number };
    channel_pct: { left: number; center: number; right: number };
    favoured_channel: "left" | "center" | "right" | null;
    final_third_entries: number;
    possession_avg: number | null;
  };
  snapshot: { opponent: string | null; played_on: string | null; shots: Shot[]; zones: number[] } | null;
}
