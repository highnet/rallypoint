import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Swarm",
  description: "The public record of this repository's agent swarm.",
};

// Matches --rp-paper-sunk in app/swarm/swarm.css (the top bar).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1012" },
  ],
};

/*
 * Geist ships inside the `geist` package as local font files, so the
 * dashboard builds and runs offline. swarm.css reads --font-geist-sans and
 * --font-geist-mono; set --rp-font-sans / --rp-font-code to use other fonts.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${GeistSans.variable} ${GeistMono.variable}`} lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
