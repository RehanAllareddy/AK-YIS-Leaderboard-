export type Medal = "gold" | "silver" | "bronze";

export function medalFor(rank: number): Medal | null {
  return rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;
}

// Badges are solid metal discs in both themes, so they get explicit dark-mode colours.
export const medalStyles: Record<Medal, { row: string; badge: string; card: string; label: string; accent: string }> = {
  gold: {
    row: "bg-gold-50/70",
    badge: "bg-gradient-to-b from-gold-200 to-gold-400 text-gold-800 ring-1 ring-gold-400/60 dark:from-[#ecc95a] dark:to-[#b8901c] dark:text-[#2b2006]",
    card: "border-gold-200 bg-gradient-to-b from-gold-50 to-card",
    label: "text-gold-600",
    accent: "bg-gold-400",
  },
  silver: {
    row: "bg-silver-50",
    badge: "bg-gradient-to-b from-silver-50 to-silver-200 text-silver-800 ring-1 ring-silver-400/60 dark:from-[#e3e8ef] dark:to-[#9aa6b6] dark:text-[#1e2633]",
    card: "border-silver-200 bg-gradient-to-b from-silver-50 to-card",
    label: "text-silver-600",
    accent: "bg-silver-400",
  },
  bronze: {
    row: "bg-bronze-50/70",
    badge: "bg-gradient-to-b from-bronze-50 to-bronze-200 text-bronze-800 ring-1 ring-bronze-400/60 dark:from-[#ebb48c] dark:to-[#b0703f] dark:text-[#2e1708]",
    card: "border-bronze-200 bg-gradient-to-b from-bronze-50 to-card",
    label: "text-bronze-600",
    accent: "bg-bronze-400",
  },
};
