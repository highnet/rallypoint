"use client";

import { create } from "zustand";

export type LoopStage = "read" | "claim" | "build" | "review" | "merge";
export type InstallMode = "shadcn" | "github" | "manual";

type RallypointState = {
  activeStage: LoopStage;
  copied: string | null;
  installMode: InstallMode;
  setActiveStage: (stage: LoopStage) => void;
  setCopied: (value: string | null) => void;
  setInstallMode: (mode: InstallMode) => void;
};

export const useRallypointStore = create<RallypointState>((set) => ({
  activeStage: "read",
  copied: null,
  installMode: "shadcn",
  setActiveStage: (activeStage) => set({ activeStage }),
  setCopied: (copied) => set({ copied }),
  setInstallMode: (installMode) => set({ installMode }),
}));
