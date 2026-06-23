export type Banner = {
  /** Unique id (used as React key). */
  id: string;
  /** Optional small pill label, e.g. "Limited offer", "New", "Event". */
  tag?: string;
  /** Accent colour for the tag/highlight. */
  accent?: "blue" | "purple" | "green" | "pink";
  /** Small uppercase label above the title. */
  eyebrow: string;
  /** Main headline. */
  title: string;
  /** Optional trailing words rendered in the brand gradient. */
  highlight?: string;
  /** Supporting paragraph. */
  body: string;
  /** Optional meta line (dates, terms, etc.). */
  meta?: string;
  /** Primary call-to-action (rendered as the liquid-glass button). */
  primary: { label: string; href: string };
  /** Optional secondary CTA (ghost button). */
  secondary?: { label: string; href: string };
};

/**
 * Hero banners. Up to FOUR are shown in the rotating hero carousel.
 *
 * The first banner is the default brand message. The rest are EDITABLE
 * SAMPLES — change them, delete them, or add your own for a promotion, a new
 * listing, or an event. To run a single static hero, keep just one entry.
 */
export const banners: Banner[] = [
  {
    id: "brand",
    accent: "blue",
    eyebrow: "Creative Management & Growth",
    title: "We build brands and the systems that",
    highlight: "grow them.",
    body: "go overseas is a creative management agency. From brand identity and websites to ads, PR, and automation, we handle the strategy, the creative, and the execution that turn ambitious ideas into real traction.",
    primary: { label: "Start a conversation", href: "/contact" },
    secondary: { label: "Explore services", href: "/services" },
  },

  // ——— SAMPLE: PROMOTION ———————————————————————————————————————
  {
    id: "promo",
    tag: "Limited offer",
    accent: "pink",
    eyebrow: "Promotion",
    title: "Launch your website this month from",
    highlight: "$999.",
    body: "A complete, SEO-ready site with a lead form and legal pages — plus your first month of care on us. Only a few build slots open each month.",
    meta: "Care plan from $49/mo · Offer ends soon",
    primary: { label: "Claim the offer", href: "/pricing" },
    secondary: { label: "See plans", href: "/pricing" },
  },

  // ——— SAMPLE: EVENT ——————————————————————————————————————————
  {
    id: "event",
    tag: "Event",
    accent: "purple",
    eyebrow: "Free workshop",
    title: "Get found on Google with local",
    highlight: "SEO.",
    body: "A practical 45-minute session for small-business owners — what actually moves rankings, and the quick wins you can do this week.",
    meta: "Online · Pick a date when you register",
    primary: { label: "Save your spot", href: "/contact" },
    secondary: { label: "Read our insights", href: "/insights" },
  },

  // ——— ADD A 4th BANNER HERE (e.g. a new listing) ———————————————
];
