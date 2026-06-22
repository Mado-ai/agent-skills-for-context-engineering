/**
 * Central SEO configuration and structured-data helpers.
 *
 * Set NEXT_PUBLIC_SITE_URL in your environment (e.g. https://www.gooverseas.com)
 * for production so canonicals, sitemap, and Open Graph URLs are absolute.
 */
export const siteConfig = {
  name: "go overseas",
  legalName: "go overseas",
  tagline: "Strategy. Creativity. Growth.",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gooverseas.com").replace(/\/$/, ""),
  description:
    "go overseas is a creative management agency — brand identity, website & app development, paid advertising, PR, automation, and analytics that turn ambitious ideas into growth.",
  locale: "en_CA",
  email: "hello@gooverseas.com",
  country: "Canada",
  countryCode: "CA",
  region: "ON",
  city: "Toronto",
  sameAs: [
    "https://www.linkedin.com/company/gooverseas",
    "https://twitter.com/gooverseas",
  ],
  hubs: ["Toronto", "Vancouver", "Montréal"],
} as const;

/** Build an absolute URL from a site-relative path. */
export function absoluteUrl(path = "/"): string {
  return `${siteConfig.url}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Organization schema — describes the business itself. */
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.legalName,
    url: siteConfig.url,
    logo: absoluteUrl("/icon.svg"),
    description: siteConfig.description,
    email: siteConfig.email,
    slogan: siteConfig.tagline,
    sameAs: siteConfig.sameAs,
    address: {
      "@type": "PostalAddress",
      addressLocality: siteConfig.city,
      addressRegion: siteConfig.region,
      addressCountry: siteConfig.countryCode,
    },
    areaServed: { "@type": "Country", name: siteConfig.country },
    employee: [
      { "@type": "Person", name: "Yazan Alshibi", jobTitle: "Head of Growth & Brand Development" },
      { "@type": "Person", name: "Wafeeq Alshibi", jobTitle: "Organization Quality Manager" },
      { "@type": "Person", name: "Yousef Alhelo", jobTitle: "Operations Manager" },
    ],
  };
}

/** WebSite schema — enables sitelinks search box eligibility. */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en-CA",
    publisher: { "@type": "Organization", name: siteConfig.legalName },
  };
}

/** ProfessionalService schema — for the services/business offering. */
export function professionalServiceSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: siteConfig.legalName,
    url: siteConfig.url,
    description: siteConfig.description,
    email: siteConfig.email,
    address: {
      "@type": "PostalAddress",
      addressLocality: siteConfig.city,
      addressRegion: siteConfig.region,
      addressCountry: siteConfig.countryCode,
    },
    areaServed: { "@type": "Country", name: siteConfig.country },
    serviceType: [
      "Brand Identity & Design",
      "Website & App Development",
      "Paid Advertising & Social Media Marketing",
      "Public Relations & Community",
      "Automation & Operations",
      "Analytics & Reporting",
    ],
  };
}

/** FAQPage schema — eligible for FAQ rich results. */
export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** BlogPosting schema for an individual insight. */
export function articleSchema(opts: {
  title: string;
  description: string;
  slug: string;
  date: string;
  author: string;
}) {
  const url = absoluteUrl(`/insights/${opts.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: opts.title,
    description: opts.description,
    datePublished: opts.date,
    dateModified: opts.date,
    author: { "@type": "Organization", name: opts.author },
    publisher: {
      "@type": "Organization",
      name: siteConfig.legalName,
      logo: { "@type": "ImageObject", url: absoluteUrl("/icon.svg") },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    image: absoluteUrl(`/insights/${opts.slug}/opengraph-image`),
  };
}

/** BreadcrumbList schema. */
export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
