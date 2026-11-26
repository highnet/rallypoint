"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import type { SwarmNavItem, SwarmTarget } from "../_lib/config-types";
import { NavIcon, TargetMark } from "./icons";

function isCurrent(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  if (href === "/swarm") return pathname === "/swarm";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavProps = {
  items: SwarmNavItem[];
  title: string;
  targets: SwarmTarget[];
  targetsLabel: string;
};

/**
 * The swarm's navigation, grouped by section. Wide screens get a sticky
 * sidebar; narrow screens a disclosure menu that closes on navigation.
 *
 * The current page comes from the URL, which a prerender of an `[id]` route
 * does not know. So the links render without a current page in the static
 * shell, and the marked version streams in (Cache Components requires the
 * Suspense boundary around `usePathname()`; without it, it changes nothing).
 */
export function SwarmNav(props: NavProps) {
  return (
    <Suspense fallback={<NavLinks {...props} pathname={null} />}>
      <NavAtPath {...props} />
    </Suspense>
  );
}

function NavAtPath(props: NavProps) {
  return <NavLinks {...props} pathname={usePathname() ?? "/swarm"} />;
}

function NavLinks({ items, title, targets, targetsLabel, pathname }: NavProps & { pathname: string | null }) {
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
  // The most specific match wins, so /swarm/targets/x names its target.
  const current =
    targets
      .map((target) => ({ href: `/swarm/targets/${encodeURIComponent(target.id)}`, label: target.name }))
      .find((entry) => isCurrent(pathname, entry.href)) ?? items.find((item) => isCurrent(pathname, item.href));

  const list = (
    <div className="rp-nav-sections">
      {sections.map((section) => (
        <div className="rp-nav-section" key={section.name}>
          <h2 className="rp-nav-heading">{section.name}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link aria-current={isCurrent(pathname, item.href) ? "page" : undefined} href={item.href}>
                  <NavIcon item={item} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {targets.length > 0 ? (
        <div className="rp-nav-section rp-nav-targets">
          <h2 className="rp-nav-heading">{targetsLabel}</h2>
          <ul>
            {targets.map((target) => {
              const href = `/swarm/targets/${encodeURIComponent(target.id)}`;
              return (
                <li key={target.id}>
                  <Link aria-current={isCurrent(pathname, href) ? "page" : undefined} href={href}>
                    <TargetMark size="s" target={target} />
                    <span>{target.name}</span>
                  </Link>
                </li>
              );
            })}
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
