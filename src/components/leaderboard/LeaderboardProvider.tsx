"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useLeaderboard, type LeaderboardState } from "./useLeaderboard";

const LeaderboardContext = createContext<LeaderboardState | null>(null);

/** One live leaderboard subscription shared by the header stats and the rankings. */
export function LeaderboardProvider({ children }: { children: ReactNode }) {
  return <LeaderboardContext value={useLeaderboard()}>{children}</LeaderboardContext>;
}

export function useLeaderboardData(): LeaderboardState {
  const value = useContext(LeaderboardContext);
  if (!value) throw new Error("useLeaderboardData must be used within LeaderboardProvider");
  return value;
}
