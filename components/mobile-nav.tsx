"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const links = [
  { href: "/#loop", label: "The loop" },
  { href: "/#party", label: "Agent roles" },
  { href: "/#install", label: "Install" },
  { href: "/docs", label: "Playbook" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-label={open ? "Close navigation" : "Open navigation"}
        className="mobile-nav-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? <X /> : <Menu />}
      </button>
      {open && (
        <div className="mobile-nav-layer">
          <button
            aria-label="Close navigation"
            className="mobile-nav-backdrop"
            onClick={() => setOpen(false)}
            type="button"
          />
          <nav aria-label="Mobile navigation" className="mobile-nav-sheet">
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
