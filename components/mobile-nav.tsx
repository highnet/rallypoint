"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/#loop", label: "The loop" },
  { href: "/#party", label: "Agent roles" },
  { href: "/#install", label: "Install" },
  { href: "/docs", label: "Docs" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;

      const sheet = closeRef.current?.closest("nav");
      const focusable = sheet?.querySelectorAll<HTMLElement>("button, a[href]");
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
      previousFocus?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-hidden={open}
        aria-label={open ? "Close navigation" : "Open navigation"}
        className="mobile-nav-trigger"
        onClick={() => setOpen((value) => !value)}
        tabIndex={open ? -1 : 0}
        type="button"
      >
        {open ? <X /> : <Menu />}
      </button>
      {open && (
        <div className="mobile-nav-layer">
          <button
            aria-hidden="true"
            aria-label="Close navigation"
            className="mobile-nav-backdrop"
            onClick={() => setOpen(false)}
            tabIndex={-1}
            type="button"
          />
          <nav aria-label="Mobile navigation" className="mobile-nav-sheet">
            <div aria-hidden="true" className="mobile-nav-roller" />
            <button
              aria-label="Close navigation"
              className="mobile-nav-close"
              onClick={() => setOpen(false)}
              ref={closeRef}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
            <p>Choose the next waypoint</p>
            {links.map((link, index) => (
              <Link href={link.href} key={link.href} onClick={() => setOpen(false)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
