import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { CustomCursor } from "@/components/CustomCursor";
import { Intro } from "@/components/Intro";
import { ScrollProgress } from "@/components/ScrollProgress";
import { siteConfig, organizationSchema, websiteSchema } from "@/lib/seo";

// Brand typeface — Poppins across the whole site.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [
    "creative management agency",
    "brand identity design",
    "website development",
    "app development",
    "Meta ads agency",
    "Facebook ads",
    "TikTok ads",
    "social media marketing",
    "public relations",
    "marketing automation",
    "CRM & client database design",
    "analytics and reporting",
  ],
  authors: [{ name: siteConfig.name, url: siteConfig.url }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  category: "business",
  formatDetection: { email: false, telephone: false, address: false },
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description:
      "A creative management agency — brand, web & apps, paid ads, PR, automation, and analytics that turn ambitious ideas into growth.",
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description:
      "A creative management agency — brand, web & apps, paid ads, PR, automation, and analytics that turn ambitious ideas into growth.",
    creator: "@gooverseas",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA" className={poppins.variable}>
      <body className="min-h-screen">
        <Intro />
        <ScrollProgress />
        <JsonLd data={[organizationSchema(), websiteSchema()]} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-blue focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <CustomCursor />
      </body>
    </html>
  );
}
