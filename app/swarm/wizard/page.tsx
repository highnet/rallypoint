import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SwarmWizard } from "@/components/swarm-wizard";

const title = "Swarm wizard";
const description =
  "Describe your Rallypoint Swarm in a sentence or two. The wizard writes the genesis prompt, .rallypoint/swarm.json, the exact setup commands and the conductor prompt, in your browser.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/swarm/wizard" },
  openGraph: {
    title: `${title} · Rallypoint`,
    description,
    url: "/swarm/wizard",
    siteName: "Rallypoint",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} · Rallypoint`,
    description,
  },
};

export default function SwarmWizardPage() {
  return (
    <>
      <SiteHeader current="/swarm" />
      <main className="wizard-page" id="main">
        <div className="wizard-intro">
          <Link className="text-link back-link" href="/swarm">
            <ArrowLeft aria-hidden="true" /> Rallypoint Swarm
          </Link>
          <h1>Describe your swarm. Get its starting point.</h1>
          <p className="lede">
            One sentence or two is enough. Everything after the pitch is optional: a genesis session on
            your repository decides what you leave open, and delivers it as one pull request you review.
          </p>
        </div>
        <SwarmWizard />
      </main>
      <SiteFooter />
    </>
  );
}
