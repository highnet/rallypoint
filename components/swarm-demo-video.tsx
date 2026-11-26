"use client";

import type MuxPlayerElement from "@mux/mux-player";
import MuxPlayer from "@mux/mux-player-react/lazy";
import { Play, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import demoVideo from "@/lib/swarm-demo-video.json";

export type SwarmDemoCut = { mp4: string; poster: string | null; playbackId?: string | null };

const FULL = (demoVideo as { full: SwarmDemoCut | null }).full;
const SHORT = (demoVideo as { short: SwarmDemoCut | null }).short;

type Length = "short" | "full";

// Each film's running time as the player shows it. Update with a re-cut.
const LENGTHS: readonly (readonly [Length, string, string])[] = [
  ["short", "Quick look", "1:26"],
  ["full", "Whole run", "8:37"],
];

// The whole run's chapters (from the cut's edit list). Update with a re-cut.
const CHAPTERS: readonly (readonly [string, string])[] = [
  ["0:00", "Intro"],
  ["0:21", "The swarm wizard"],
  ["2:31", "A new project"],
  ["3:12", "Memory in Supabase"],
  ["4:07", "The secret and doctor"],
  ["5:07", "Genesis"],
  ["5:46", "Two decisions"],
  ["6:09", "variantly redesigns"],
  ["7:16", "Bugs found"],
  ["7:26", "Austrian law"],
  ["7:49", "Wrap"],
  ["8:01", "How this was made"],
];
const seconds = (time: string) => time.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);

const RATES = [1, 1.25, 1.5, 1.75, 2];

const cutFor = (length: Length) => (length === "short" ? SHORT ?? FULL : FULL ?? SHORT);

// The Mux stream when the cut has one, else the MP4 on Vercel Blob.
const load = (el: MuxPlayerElement, cut: SwarmDemoCut, at: number) => {
  el.startTime = at;
  if (cut.playbackId) el.playbackId = cut.playbackId;
  else el.src = cut.mp4;
};

const setMuted = (el: MuxPlayerElement, muted: boolean) => {
  el.muted = muted;
};
const rewind = (el: MuxPlayerElement) => {
  el.currentTime = 0;
};

// Plays, once more if the call lands before the player applied a new source.
// The first call, made in a click, is what lets the browser play with sound.
const play = (el: MuxPlayerElement) =>
  void el.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") void el.play().catch(() => {});
  });

// The film may start on its own, muted, unless the visitor asks for less
// motion or less data.
const mayPreview = () =>
  !matchMedia("(prefers-reduced-motion: reduce)").matches &&
  !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

/*
 * The narrated end-to-end run: the wizard, a brand-new project, memory in
 * Supabase, genesis, and the product it set up, recorded headless. The same
 * pattern as variantly's homepage film: the 90-second cut first, a switch to
 * the whole run, a muted looping preview while half the frame is on screen,
 * and a click to start over with sound and controls. Captions are burned in.
 * Films stream from Mux when a cut has a playbackId, else play the MP4 on
 * Vercel Blob. Renders nothing until lib/swarm-demo-video.json has a film.
 */
export function SwarmDemoVideo() {
  const [length, setLength] = useState<Length>(SHORT ? "short" : "full");
  const [mode, setMode] = useState<"idle" | "preview" | "watching">("idle");
  const watching = mode === "watching";
  const frame = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<MuxPlayerElement | null>(null);
  const attach = useCallback((el: MuxPlayerElement | null) => {
    if (!el) return setPlayer(null);
    void customElements.whenDefined("mux-player").then(() => setPlayer(el));
  }, []);
  const cut = cutFor(length);
  const source = cut ? cut.playbackId ?? cut.mp4 : null;
  const shown = useRef<{ length: Length; source: string } | null>(null);

  useEffect(() => {
    if (!player || !cut || !source || shown.current?.source === source) return;
    const playing = !player.paused && !player.ended;
    shown.current = { length, source };
    load(player, cut, 0);
    if (playing) play(player);
  }, [player, cut, source, length]);

  useEffect(() => {
    const el = frame.current;
    if (!player || !el || watching || !mayPreview()) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return player.pause();
        setMuted(player, true);
        setMode("preview");
        play(player);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [player, watching]);

  const start = (value: Length) => {
    const chosen = cutFor(value);
    if (!player || !chosen) return;
    const chosenSource = chosen.playbackId ?? chosen.mp4;
    if (shown.current?.source !== chosenSource) {
      shown.current = { length: value, source: chosenSource };
      load(player, chosen, 0);
    } else rewind(player);
    setMuted(player, false);
    setLength(value);
    setMode("watching");
    play(player);
  };

  const addChapters = () => {
    if (!player || shown.current?.length !== "full" || !FULL) return;
    const starts = CHAPTERS.map(([time]) => seconds(time));
    void player.addChapters(
      CHAPTERS.map(([, value], i) => ({ startTime: starts[i], endTime: starts[i + 1] ?? player.duration, value })),
    );
  };

  if (!FULL && !SHORT) return null;
  const choices = LENGTHS.filter(([value]) => (value === "short" ? SHORT : FULL));

  return (
    <div className="swarm-demo">
      {choices.length > 1 && (
        <div role="group" aria-label="Length" className="swarm-demo-lengths">
          {choices.map(([value, label, time]) => (
            <button key={value} type="button" aria-pressed={length === value} onClick={() => setLength(value)}>
              {label} <span>{time}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={frame} className="swarm-demo-frame">
        <MuxPlayer
          ref={attach}
          loading="viewport"
          className={`swarm-demo-player${watching ? "" : " swarm-demo-player-idle"}`}
          poster={cut?.poster ?? undefined}
          placeholder={cut?.poster ?? undefined}
          preload="none"
          playsInline
          loop={mode === "preview"}
          noMutedPref
          playbackRates={RATES}
          streamType="on-demand"
          disableCookies
          disableTracking={!cut?.playbackId}
          title={length === "short" ? "Rallypoint Swarm in 90 seconds" : "Rallypoint Swarm: the whole run"}
          metadataVideoTitle={`Rallypoint Swarm end-to-end test, ${length === "short" ? "quick look" : "whole run"}`}
          onLoadedMetadata={addChapters}
        />
        {mode === "idle" && (
          <div className="swarm-demo-overlay">
            {choices.map(([value, label, time], i) => (
              <button
                key={value}
                type="button"
                className={i === 0 ? "btn btn-primary btn-lg" : "btn btn-secondary"}
                disabled={!player}
                onClick={() => start(value)}
                aria-label={`Play ${label.toLowerCase()}, ${time}`}
              >
                <Play aria-hidden="true" />
                {label} <span className="swarm-demo-time">{time}</span>
              </button>
            ))}
          </div>
        )}
        {mode === "preview" && (
          <div className="swarm-demo-overlay swarm-demo-overlay-preview">
            <button type="button" tabIndex={-1} aria-hidden="true" className="swarm-demo-hit" onClick={() => start(length)} />
            <div className="swarm-demo-actions">
              {choices.map(([value, label, time], i) => (
                <button
                  key={value}
                  type="button"
                  className={i === 0 ? "btn btn-primary" : "btn btn-secondary"}
                  onClick={() => start(value)}
                  aria-label={`Play ${label.toLowerCase()} with sound, ${time}`}
                >
                  <Volume2 aria-hidden="true" />
                  {label} <span className="swarm-demo-time">{time}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
