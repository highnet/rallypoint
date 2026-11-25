"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import type { SwarmNavItem } from "../_lib/config-types";

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/swarm") return pathname === "/swarm";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The swarm's navigation, grouped by section. Wide screens get a sticky
 * sidebar; narrow screens a disclosure menu that closes on navigation.
 */
export function SwarmNav({ items, title }: { items: SwarmNavItem[]; title: string }) {
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
  const current = items.find((item) => isCurrent(pathname, item.href));

  const list = (
    <div className="rp-nav-sections">
      {sections.map((section) => (
        <div className="rp-nav-section" key={section.name}>
          <h2 className="rp-nav-heading">{section.name}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link aria-current={isCurrent(pathname, item.href) ? "page" : undefined} href={item.href}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
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
