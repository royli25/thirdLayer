"use client";
import { useEffect, useState } from "react";
import { detectMode } from "@/lib/api";

export function useMode() {
  const [mode, setMode] = useState<"live" | "mock" | null>(null);
  useEffect(() => { detectMode().then(setMode); }, []);
  return mode;
}
