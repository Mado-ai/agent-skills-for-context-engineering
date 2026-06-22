export type Plan = {
  name: string;
  careName: string;
  description: string;
  build: number;
  care: number;
  popular?: boolean;
  accent: "blue" | "purple" | "green";
  buttonText: string;
  buildIncludes: string[];
  careIncludes: string[];
};

/** The real productized website offer: one-time Build tiers + monthly Care plans. */
export const plans: Plan[] = [
  {
    name: "Starter",
    careName: "Essential",
    description: "A complete multi-page site, built to get found and generate leads.",
    build: 999,
    care: 49,
    accent: "blue",
    buttonText: "Start your site",
    buildIncludes: [
      "Up to 5 pages",
      "Lead-generation form",
      "SEO-optimized to rank on Google",
      "Terms & Conditions + Privacy pages",
      "Google Business setup",
    ],
    careIncludes: [
      "Managed hosting, SSL & backups",
      "Security & uptime monitoring",
      "Software updates",
      "Monthly content edits",
      "Local SEO maintenance",
    ],
  },
  {
    name: "Growth",
    careName: "Growth",
    description: "Everything in Starter, plus an Insights blog and deeper SEO.",
    build: 1499,
    care: 99,
    popular: true,
    accent: "purple",
    buttonText: "Get Growth",
    buildIncludes: [
      "Everything in Starter, plus:",
      "6+ pages + Insights blog",
      "Advanced on-page SEO + content",
      "Lead capture built in",
      "Google Business management",
    ],
    careIncludes: [
      "Everything in Essential, plus:",
      "Monthly content & SEO work",
      "Performance reporting",
      "Client dashboard access",
    ],
  },
  {
    name: "Performance",
    careName: "Performance",
    description: "Everything in Growth, plus one custom app feature for your business.",
    build: 2499,
    care: 149,
    accent: "green",
    buttonText: "Go Performance",
    buildIncludes: [
      "Everything in Growth, plus:",
      "One custom app feature",
      "Booking, calculator or AI chat",
      "Priority build",
      "CorePay revenue view",
    ],
    careIncludes: [
      "Everything in Growth, plus:",
      "Priority support",
      "Conversion optimization",
      "CorePay revenue dashboard",
    ],
  },
];

/** Included on every build — including the $999 Starter. */
export const everySite = [
  "Lead-generation form",
  "Terms & Conditions page",
  "Privacy Policy page",
  "Full on-page SEO setup",
  "Managed hosting on a care plan",
  "Mobile-first, fast-loading build",
];
