"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type MobileNavProps = {
  links: { href: string; label: string }[];
};

export function MobileNav({ links }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
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
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="Open navigation"
        className="btn btn-icon btn-quiet mobile-nav-trigger"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Menu aria-hidden="true" />
      </button>
      {open && (
        <div className="mobile-nav-layer">
          <button
            aria-hidden="true"
            className="mobile-nav-backdrop"
            onClick={() => setOpen(false)}
            tabIndex={-1}
            type="button"
          />
          <nav aria-label="Mobile" className="mobile-nav-sheet">
            <button
              aria-label="Close navigation"
              className="btn btn-icon btn-quiet mobile-nav-close"
              onClick={() => setOpen(false)}
              ref={closeRef}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} onClick={() => setOpen(false)}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
