"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (!mounted) {
    return <span className="theme-toggle-placeholder" aria-hidden="true" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      className="theme-toggle"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="icon"
      variant="parchment"
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
