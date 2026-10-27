export const APP_TITLE = "AK Young Investors Society Leaderboard";
export const APP_SUBTITLE = "Track your progress. Compete. Invest in your future.";

export const MIN_SCORE = 0;
export const MAX_SCORE = 1_000_000;
export const MAX_ADJUSTMENT = 10_000;
/** Adjustments at or beyond this size (either direction) need explicit confirmation. */
export const LARGE_ADJUSTMENT = 10;

export const NAME_MAX_LENGTH = 100;
export const REASON_MAX_LENGTH = 500;
export const USERNAME_MIN_LENGTH = 3;
export const PASSWORD_MIN_LENGTH = 12;

/** How often the public leaderboard polls for changes. */
export const LEADERBOARD_POLL_MS = 5_000;
/** Same-browser channel used to refresh open leaderboard tabs instantly. */
export const LEADERBOARD_CHANNEL = "akyis-leaderboard";

export const DEFAULT_POINT_SETTINGS = { btn1: 5, btn2: 1, btn3: 0, btn4: -1 } as const;
