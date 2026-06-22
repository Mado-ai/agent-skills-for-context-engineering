export interface PlayerStat {
  player_id: number;
  team: string;
  distance_m: number;
  top_speed_ms: number;
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
