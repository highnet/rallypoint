"use client";

import { create } from "zustand";

export type InstallMode = "npm" | "pnpm" | "inspect";
export type Audience = "human" | "agent";

type RallypointState = {
  audience: Audience;
  copied: string | null;
  installMode: InstallMode;
  setAudience: (audience: Audience) => void;
  setCopied: (value: string | null) => void;
  setInstallMode: (mode: InstallMode) => void;
};

export const useRallypointStore = create<RallypointState>((set) => ({
  audience: "human",
  copied: null,
  installMode: "npm",
  setAudience: (audience) => set({ audience }),
  setCopied: (copied) => set({ copied }),
  setInstallMode: (installMode) => set({ installMode }),
}));
