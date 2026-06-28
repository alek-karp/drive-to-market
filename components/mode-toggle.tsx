"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const [mounted, setMounted] = React.useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
