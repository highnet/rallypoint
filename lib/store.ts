"use client";

import { create } from "zustand";

export type LoopStage = "read" | "claim" | "build" | "review" | "merge";
export type InstallMode = "npm" | "pnpm" | "inspect";
export type Audience = "human" | "agent";

type RallypointState = {
  activeStage: LoopStage;
  audience: Audience;
  copied: string | null;
  installMode: InstallMode;
  setActiveStage: (stage: LoopStage) => void;
  setAudience: (audience: Audience) => void;
  setCopied: (value: string | null) => void;
  setInstallMode: (mode: InstallMode) => void;
};

export const useRallypointStore = create<RallypointState>((set) => ({
  activeStage: "read",
  audience: "human",
  copied: null,
  installMode: "npm",
  setActiveStage: (activeStage) => set({ activeStage }),
  setAudience: (audience) => set({ audience }),
  setCopied: (copied) => set({ copied }),
  setInstallMode: (installMode) => set({ installMode }),
}));
