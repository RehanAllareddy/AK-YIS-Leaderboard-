"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LEADERBOARD_CHANNEL, LEADERBOARD_POLL_MS } from "@/lib/constants";
import type { PublicLeaderboard } from "@/lib/server/members";

export interface LeaderboardState {
  data: PublicLeaderboard | null;
  error: string | null;
  loading: boolean;
  lastFetched: Date | null;
  refresh: () => void;
}

/**
 * Loads the public leaderboard and keeps it fresh: polls while the tab is
 * visible, refetches when the tab regains focus, and refreshes instantly when
 * an admin in the same browser makes a change.
 */
export function useLeaderboard(): LeaderboardState {
  const [data, setData] = useState<PublicLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      // "no-cache" revalidates with the ETag, so unchanged polls are a cheap 304.
      const res = await fetch("/api/leaderboard", { cache: "no-cache", signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as PublicLeaderboard;
      setData((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setError(null);
      setLastFetched(new Date());
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError("We couldn't load the latest rankings.");
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Initial load; subsequent loads are driven by the timer and events below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(load, LEADERBOARD_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        clearInterval(timer);
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", load);

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(LEADERBOARD_CHANNEL);
      channel.onmessage = () => load();
    } catch {
      // not supported — polling covers it
    }

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", load);
      channel?.close();
      inFlight.current?.abort();
    };
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  return { data, error, loading, lastFetched, refresh };
}
