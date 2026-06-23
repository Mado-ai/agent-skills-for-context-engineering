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
  /**
   * Optional background image for this banner. When set, the photo replaces
   * the animated shader for that slide (a dark overlay keeps text readable).
   */
  image?: { src: string; alt?: string };
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
    image: {
      src: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=80",
      alt: "Team collaborating around a laptop in a workshop",
    },
    primary: { label: "Save your spot", href: "/contact" },
    secondary: { label: "Read our insights", href: "/insights" },
  },

  // ——— SAMPLE: NEW LISTING ———————————————————————————————————
  {
    id: "listing",
    tag: "New",
    accent: "green",
    eyebrow: "Just launched",
    title: "See your traffic, leads & revenue in one",
    highlight: "client portal.",
    body: "Every Growth and Performance care plan now includes a private dashboard — your website performance and CorePay revenue, together in real time.",
    meta: "Included with Growth & Performance care",
    image: {
      src: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1600&q=80",
      alt: "Analytics dashboard with charts on a screen",
    },
    primary: { label: "Explore the portal", href: "/portal" },
    secondary: { label: "See pricing", href: "/pricing" },
  },
];
