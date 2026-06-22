// Mock data for the client-portal demo (no backend; illustrative only).

export const clients = [
  { name: "Bloom Café", plan: "Growth" as const },
  { name: "NorthPeak Dental", plan: "Performance" as const },
  { name: "Skyline Realty", plan: "Essential" as const },
];

export type Accent = "blue" | "purple" | "green";

export const kpis: {
  label: string;
  value: string;
  delta: string;
  up: boolean;
  accent: Accent;
  spark: number[];
}[] = [
  { label: "Visitors", value: "3,482", delta: "+12%", up: true, accent: "blue", spark: [12, 18, 14, 22, 19, 26, 24, 30, 28, 34] },
  { label: "Leads", value: "47", delta: "+8%", up: true, accent: "purple", spark: [3, 4, 3, 5, 6, 5, 7, 6, 8, 9] },
  { label: "Avg. position", value: "6.3", delta: "+1.4", up: true, accent: "green", spark: [14, 13, 12, 11, 10, 9, 8, 7, 7, 6] },
  { label: "Revenue", value: "$18.2k", delta: "+21%", up: true, accent: "blue", spark: [8, 9, 11, 10, 13, 14, 16, 15, 18, 18] },
];

// 30-day traffic series
export const traffic = [
  64, 72, 68, 80, 76, 90, 88, 102, 96, 110, 104, 118, 130, 122, 140, 134, 150,
  146, 162, 158, 176, 168, 184, 192, 188, 204, 210, 224, 232, 248,
];

export const sources = [
  { label: "Organic search", pct: 58, accent: "blue" as Accent },
  { label: "Direct", pct: 22, accent: "purple" as Accent },
  { label: "Social", pct: 12, accent: "green" as Accent },
  { label: "Referral", pct: 8, accent: "blue" as Accent },
];

export const leads = [
  { name: "Sarah M.", detail: "Catering enquiry — 40 guests", time: "2h ago", status: "New" },
  { name: "James T.", detail: "Booking request, Friday", time: "5h ago", status: "New" },
  { name: "Priya K.", detail: "Wholesale pricing question", time: "Yesterday", status: "Replied" },
  { name: "Marcus L.", detail: "Event space availability", time: "Yesterday", status: "Replied" },
  { name: "Dana W.", detail: "Gift card bulk order", time: "2 days ago", status: "Won" },
];

export const keywords = [
  { kw: "café near me", pos: 3, change: 2 },
  { kw: "best brunch downtown", pos: 5, change: 4 },
  { kw: "specialty coffee mississauga", pos: 6, change: 1 },
  { kw: "event catering toronto", pos: 9, change: 3 },
  { kw: "vegan pastries", pos: 12, change: -1 },
];

// 12-month CorePay revenue ($k)
export const revenue = [9.1, 9.8, 10.4, 11.2, 11.9, 12.6, 13.4, 14.1, 15.0, 16.2, 17.1, 18.2];
