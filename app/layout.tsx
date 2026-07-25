import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import {
  Cinzel,
  Cinzel_Decorative,
  IM_Fell_English,
} from "next/font/google";

import { HeraldrySprite } from "@/components/heraldry-sprite";
import { Providers } from "@/components/providers";

import "./globals.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  weight: ["600", "700", "900"],
});

const cinzelDecorative = Cinzel_Decorative({
  subsets: ["latin"],
  variable: "--font-cinzel-decorative",
  weight: ["700", "900"],
});

const imFellEnglish = IM_Fell_English({
  subsets: ["latin"],
  variable: "--font-im-fell-english",
  style: ["normal", "italic"],
  weight: "400",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rallypoint.tools";
const title = "Rallypoint — A disciplined agent loop";
const description =
  "Install planners, workers, reviewers, testers, fixers, and a GitHub-native coordination protocol into any repository.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · Rallypoint",
  },
  description,
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Rallypoint",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${GeistSans.variable} ${GeistMono.variable} ${cinzel.variable} ${cinzelDecorative.variable} ${imFellEnglish.variable}`}
      data-scroll-behavior="smooth"
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <HeraldrySprite />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
