import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://gooverseas.example"),
  title: {
    default: "go overseas — Strategy. Creativity. Growth.",
    template: "%s · go overseas",
  },
  description:
    "go overseas is a business-development and creative-growth firm helping ambitious companies expand into international markets.",
  keywords: [
    "international business development",
    "market entry",
    "global expansion",
    "go-to-market strategy",
    "brand growth",
  ],
  openGraph: {
    title: "go overseas — Strategy. Creativity. Growth.",
    description:
      "We help ambitious companies cross borders — turning international ambition into market presence.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen">
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
