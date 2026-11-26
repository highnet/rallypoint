"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "selected" | "failed";

const RESET_MS = 2000;

/** Copies through a detached textarea, for browsers without the async clipboard API. */
function copyWithTextarea(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Selects the shown text, so the reader can copy it with their own shortcut. */
function selectTarget(targetId: string | undefined): boolean {
  const target = targetId ? document.getElementById(targetId) : null;
  const selection = window.getSelection();
  if (!target || !selection) return false;
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * Copies `text` exactly as given. The page stays server-rendered; only this
 * button runs on the client. `label` is the accessible name, so say what it
 * copies ("Copy the 'Run one swarm agent' prompt"). `targetId` names the
 * element showing the text: when no clipboard is available, it is selected
 * instead so the reader can copy it by hand.
 */
export function CopyButton({ text, label, targetId }: { text: string; label: string; targetId?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = (next: CopyState) => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), RESET_MS);
  };

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        show("copied");
        return;
      }
    } catch {
      // Permission denied or no focus: fall through to the older paths.
    }
    if (copyWithTextarea(text)) show("copied");
    else if (selectTarget(targetId)) show("selected");
    else show("failed");
  };

  const visible = state === "copied" ? "Copied" : state === "selected" ? "Selected" : state === "failed" ? "Copy failed" : "Copy";
  const announcement =
    state === "copied"
      ? "Copied to the clipboard."
      : state === "selected"
        ? "The clipboard is unavailable. The text is selected; press Ctrl+C or Command+C to copy it."
        : state === "failed"
          ? "Could not copy. Select the text and copy it by hand."
          : "";

  return (
    <span className="rp-copy">
      <button aria-label={label} className="rp-copy-button" data-state={state} onClick={copy} type="button">
        <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" viewBox="0 0 24 24" width="16">
          {state === "copied" ? (
            <path d="m5 12 5 5 9-10" />
          ) : (
            <>
              <rect height="12" rx="2" width="12" x="8" y="8" />
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
            </>
          )}
        </svg>
        <span aria-hidden="true">{visible}</span>
      </button>
      <span aria-live="polite" className="rp-visually-hidden" role="status">
        {announcement}
      </span>
    </span>
  );
}
