export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** JSON fetch helper for the app's own API. Errors carry the server's friendly message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.", "NETWORK");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.message ?? "Something went wrong. Please try again.", err.code, err);
  }
  return data as T;
}

/** Tell any open leaderboard tabs in this browser to refresh now. */
export function announceLeaderboardChange() {
  try {
    const channel = new BroadcastChannel("akyis-leaderboard");
    channel.postMessage("changed");
    channel.close();
  } catch {
    // BroadcastChannel unsupported; other tabs will catch up on their next poll.
  }
}
