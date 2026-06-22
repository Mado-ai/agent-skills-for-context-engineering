export const services = [
  {
    id: "brand-identity",
    title: "Brand Identity & Design",
    summary:
      "We build and sharpen brands — the strategy, identity, and visual systems that make you unmistakable and consistent everywhere you show up.",
    points: [
      "Brand identity creation & rebrands",
      "Visual systems & brand guidelines",
      "Brand strategy & positioning",
      "Identity enhancement & refresh",
    ],
  },
  {
    id: "web-apps",
    title: "Website & App Development",
    summary:
      "Fast, modern websites and apps that look the part and convert — from landing pages to full product builds.",
    points: [
      "Marketing websites & landing pages",
      "Web & mobile app development",
      "E-commerce & CMS builds",
      "Performance, SEO & maintenance",
    ],
  },
  {
    id: "paid-media",
    title: "Paid Ads & Targeted Marketing",
    summary:
      "Full-funnel campaigns on Meta, Facebook & TikTok — the creative, targeting, and optimization that actually move the numbers.",
    points: [
      "Meta, Facebook & TikTok ads",
      "Audience targeting & retargeting",
      "Ad creative & A/B testing",
      "Budget & ROAS optimization",
    ],
  },
  {
    id: "pr-community",
    title: "PR & Community",
    summary:
      "Reputation and presence — public relations, community events, and partnerships that build trust and word of mouth.",
    points: [
      "Public relations & media outreach",
      "Community events & activations",
      "Partnerships & sponsorships",
      "Reputation management",
    ],
  },
  {
    id: "automation-ops",
    title: "Automation & Operations",
    summary:
      "Systems that scale with you — SOPs, automation, and client databases that turn day-to-day chaos into a repeatable machine.",
    points: [
      "SOP creation & documentation",
      "Workflow automation solutions",
      "Client database & CRM design",
      "Internal tools & integrations",
    ],
  },
  {
    id: "analytics",
    title: "Analytics & Reporting",
    summary:
      "Clear, honest measurement — dashboards and reporting that show what's working and where to invest next.",
    points: [
      "Performance analysis & dashboards",
      "Campaign & channel reporting",
      "Marketing & customer insights",
      "Data-driven recommendations",
    ],
  },
] as const;

// NOTE: placeholder figures — replace with real numbers once confirmed.
export const stats = [
  { value: "150+", label: "Projects delivered" },
  { value: "60+", label: "Brands built & grown" },
  { value: "95%", label: "Client retention" },
  { value: "12+", label: "Specialists on the team" },
] as const;

export const process = [
  {
    step: "01",
    title: "Discover",
    body: "We learn your business, audience, and goals — and pinpoint where attention and budget will actually move the needle.",
  },
  {
    step: "02",
    title: "Design",
    body: "Strategy and creative come together: brand, campaigns, the build plan, and the systems to run it all.",
  },
  {
    step: "03",
    title: "Deliver",
    body: "We execute alongside you — designs shipped, sites built, campaigns live, automations running.",
  },
  {
    step: "04",
    title: "Optimize",
    body: "We measure, report, and refine — compounding what works into sustainable, lasting growth.",
  },
] as const;

export const sectors = [
  "Retail & E-commerce",
  "Hospitality & Food",
  "Health & Wellness",
  "Real Estate",
  "Professional Services",
  "Tech & Startups",
] as const;
