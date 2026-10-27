import { LARGE_ADJUSTMENT } from "./constants";

/** Large swings and resets of a non-zero total need an explicit confirmation. */
export function requiresConfirmation(previousScore: number, newScore: number): boolean {
  return Math.abs(newScore - previousScore) >= LARGE_ADJUSTMENT || (newScore === 0 && previousScore > 0);
}

/** Non-zero quick-action values from the point settings, in button order. */
export function quickActions(settings: Record<string, number>): number[] {
  return ["btn1", "btn2", "btn3", "btn4"].map((k) => settings[k]).filter((v): v is number => Number.isInteger(v) && v !== 0);
}
