"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type CSSProperties } from "react";

import type { SwarmNavItem, SwarmTarget } from "../_lib/config-types";
import { NavIcon } from "./icons";

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/swarm") return pathname === "/swarm";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavTarget = Pick<SwarmTarget, "id" | "name" | "color">;

/**
 * The swarm's navigation, grouped by section, with the configured targets
 * listed last. Wide screens get a sticky sidebar; narrow screens a
 * disclosure menu that closes on navigation.
 */
export function SwarmNav({
  items,
  title,
  targets,
  targetsLabel,
}: {
  items: SwarmNavItem[];
  title: string;
  targets: NavTarget[];
  targetsLabel: string;
}) {
  const pathname = usePathname() ?? "/swarm";
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  const sections: { name: string; items: SwarmNavItem[] }[] = [];
  for (const item of items) {
    const section = sections.find((entry) => entry.name === item.section);
    if (section) section.items.push(item);
    else sections.push({ name: item.section, items: [item] });
  }
  const currentTarget = targets.find((target) => isCurrent(pathname, `/swarm/targets/${target.id}`));
  const current = currentTarget
    ? { label: currentTarget.name }
    : items.filter((item) => isCurrent(pathname, item.href)).sort((a, b) => b.href.length - a.href.length)[0];

  const list = (
    <div className="rp-nav-sections">
      {sections.map((section) => (
        <div className="rp-nav-section" key={section.name}>
          <h2 className="rp-nav-heading">{section.name}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  aria-current={!currentTarget && current === item ? "page" : undefined}
                  href={item.href}
                >
                  <NavIcon href={item.href} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {targets.length > 0 ? (
        <div className="rp-nav-section">
          <h2 className="rp-nav-heading">{targetsLabel}</h2>
          <ul>
            {targets.map((target) => (
              <li key={target.id}>
                <Link
                  aria-current={currentTarget?.id === target.id ? "page" : undefined}
                  href={`/swarm/targets/${encodeURIComponent(target.id)}`}
                >
                  <span
                    aria-hidden="true"
                    className="rp-mark rp-mark-s"
                    style={{ "--rp-target": target.color } as CSSProperties}
                  >
                    {Array.from(target.name.trim())[0]?.toUpperCase() ?? "·"}
                  </span>
                  <span>{target.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <nav aria-label={`${title} sections`} className="rp-nav-wide">
        {list}
      </nav>
      <details className="rp-nav-narrow" ref={menu}>
        <summary>
          <span className="rp-nav-burger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>{current ? current.label : "Menu"}</span>
          <span className="rp-visually-hidden"> — open the section menu</span>
        </summary>
        <nav aria-label={`${title} sections`}>{list}</nav>
      </details>
    </>
  );
}
