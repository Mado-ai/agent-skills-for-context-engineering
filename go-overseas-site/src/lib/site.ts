export const services = [
  {
    id: "market-entry",
    title: "Market Entry Strategy",
    summary:
      "Validated, data-led plans for taking your Canadian business into new countries — sizing the opportunity, mapping regulation, and sequencing your first moves.",
    points: [
      "Opportunity sizing & demand validation",
      "Regulatory, tax & entity guidance",
      "Localization & pricing strategy",
      "Phased rollout roadmap",
    ],
  },
  {
    id: "partnerships",
    title: "Partnerships & Distribution",
    summary:
      "We open doors. Identify, vet, and negotiate the distributors, resellers, and strategic partners who carry you into a market.",
    points: [
      "Partner sourcing & due diligence",
      "Channel & distributor strategy",
      "Deal structuring & negotiation",
      "Relationship management playbooks",
    ],
  },
  {
    id: "brand-growth",
    title: "Brand & Creative Growth",
    summary:
      "Strategy meets creativity. Positioning, identity, and campaigns that resonate across cultures without losing your edge.",
    points: [
      "Cross-cultural positioning",
      "Brand identity & messaging",
      "Localized campaigns & content",
      "Creative direction",
    ],
  },
  {
    id: "go-to-market",
    title: "Go-to-Market Execution",
    summary:
      "From plan to traction. We build and run the demand engine — so your first overseas customers arrive on schedule.",
    points: [
      "GTM operating model",
      "Demand generation & sales enablement",
      "Local team build & onboarding",
      "Performance tracking & iteration",
    ],
  },
] as const;

export const stats = [
  { value: "24+", label: "Markets entered" },
  { value: "CA$180M+", label: "Cross-border revenue unlocked" },
  { value: "92%", label: "Client retention" },
  { value: "11", label: "Years going overseas" },
] as const;

export const process = [
  {
    step: "01",
    title: "Diagnose",
    body: "We pressure-test your ambition against the data — where to play, where to wait, and what it really takes to win.",
  },
  {
    step: "02",
    title: "Design",
    body: "A sharp, sequenced strategy: market priorities, partner map, brand positioning, and the GTM model to deliver it.",
  },
  {
    step: "03",
    title: "Deploy",
    body: "We embed alongside your team to execute — partnerships signed, campaigns live, pipeline building.",
  },
  {
    step: "04",
    title: "Scale",
    body: "Once traction is proven, we systematize growth and hand over a market that runs without us.",
  },
] as const;

export const sectors = [
  "SaaS & Technology",
  "Consumer & Retail",
  "Fintech",
  "Healthcare & Life Sciences",
  "Industrial & Manufacturing",
  "Climate & Energy",
] as const;
