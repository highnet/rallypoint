import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Cinzel, Cinzel_Decorative, Fraunces } from "next/font/google";

import { HeraldrySprite } from "@/components/heraldry-sprite";
import { Providers } from "@/components/providers";

import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT", "WONK"],
});

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

export const metadata: Metadata = {
  title: {
    default: "Rallypoint — A disciplined agent loop",
    template: "%s · Rallypoint",
  },
  description:
    "Install planners, workers, reviewers, testers, fixers, and a GitHub-native coordination protocol into any repository.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable} ${cinzel.variable} ${cinzelDecorative.variable}`}
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
