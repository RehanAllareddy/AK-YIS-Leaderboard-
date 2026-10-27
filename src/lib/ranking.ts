export interface Scored {
  id: string;
  name: string;
  score: number;
}

export type Ranked<T extends Scored> = T & { rank: number };

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * Sorts by score (high → low), then name, and assigns competition ranks:
 * tied members share a rank and the next rank is skipped (1, 1, 3, …).
 */
export function rankMembers<T extends Scored>(members: readonly T[]): Ranked<T>[] {
  const sorted = [...members].sort(
    (a, b) => b.score - a.score || collator.compare(a.name, b.name) || a.id.localeCompare(b.id),
  );
  let rank = 0;
  return sorted.map((m, i) => {
    if (i === 0 || m.score !== sorted[i - 1].score) rank = i + 1;
    return { ...m, rank };
  });
}

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}
