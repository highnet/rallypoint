import Link from "next/link";

import { MobileNav } from "@/components/mobile-nav";
import { SwarmMark } from "@/components/swarm-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

export type SiteLink = { href: string; label: string; featured?: boolean };

export const siteLinks: SiteLink[] = [
  { href: "/swarm", label: "Swarm", featured: true },
  { href: "/#loop", label: "The loop" },
  { href: "/#labels", label: "Labels" },
  { href: "/#roles", label: "Roles" },
  { href: "/#improve", label: "Self-improving" },
  { href: "/#install", label: "Install" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Wordmark />
        <nav aria-label="Primary" className="site-nav">
          {siteLinks.map((link) => (
            <Link
              aria-current={
                current === link.href || (link.featured && current?.startsWith(`${link.href}/`)) ? "page" : undefined
              }
              className={link.featured ? "nav-featured swarm-mark-trigger" : undefined}
              href={link.href}
              key={link.href}
            >
              {link.featured ? <SwarmMark className="nav-featured-mark" /> : null}
              {link.label}
              {link.featured ? <span className="nav-featured-tag">Next tier</span> : null}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          {current === "/swarm/wizard" ? null : (
            <Link className="btn btn-primary header-wizard" href="/swarm/wizard">
              Start a swarm
            </Link>
          )}
          <ThemeToggle />
          <MobileNav links={[{ href: "/swarm/wizard", label: "Start a swarm", featured: true }, ...siteLinks.map((link) => ({ ...link, featured: false }))]} />
        </div>
      </div>
    </header>
  );
}
