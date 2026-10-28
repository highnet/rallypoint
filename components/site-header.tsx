import Link from "next/link";

import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

export const siteLinks = [
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
              aria-current={current === link.href ? "page" : undefined}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <MobileNav links={siteLinks} />
        </div>
      </div>
    </header>
  );
}
