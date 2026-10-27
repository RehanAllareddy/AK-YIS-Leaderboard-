"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PublicLeaderboard } from "@/lib/server/members";
import { compareNames } from "@/lib/ranking";
import { formatDelta, formatNumber, formatTime, ordinal, pluralize } from "@/lib/format";
import { medalFor, medalStyles } from "./medals";
import { useLeaderboardData } from "./LeaderboardProvider";

type Entry = PublicLeaderboard["members"][number];
type SortKey = "rank" | "name-asc" | "name-desc" | "points-asc";
type Scope = "all" | "top10";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "rank", label: "Rank (highest points)" },
  { value: "points-asc", label: "Points (lowest first)" },
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
];

export function Leaderboard() {
  const { data, error, loading, lastFetched, refresh } = useLeaderboardData();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");
  const [scope, setScope] = useState<Scope>("all");
  const [presentation, setPresentation] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const changes = useScoreChanges(data);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.members;
    if (scope === "top10") list = list.filter((m) => m.rank <= 10);
    const q = deferredQuery.trim().toLocaleLowerCase();
    if (q) list = list.filter((m) => m.name.toLocaleLowerCase().includes(q));
    const sorted = [...list];
    if (sort === "name-asc") sorted.sort((a, b) => compareNames(a.name, b.name));
    if (sort === "name-desc") sorted.sort((a, b) => compareNames(b.name, a.name));
    if (sort === "points-asc") sorted.sort((a, b) => a.score - b.score || compareNames(a.name, b.name));
    return sorted;
  }, [data, deferredQuery, sort, scope]);

  useEffect(() => {
    if (!presentation) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresentation(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation]);

  if (loading && !data) return <LoadingState />;
  if (!data) return <ErrorState message={error ?? "Something went wrong."} onRetry={refresh} />;

  const podium = data.members.filter((m) => m.rank <= 3).slice(0, 3);
  const filtering = deferredQuery.trim() !== "" || scope !== "all";

  return (
    <div className={presentation ? "presentation" : undefined}>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm text-navy-500">
        <LiveIndicator stale={Boolean(error)} lastFetched={lastFetched} />
        {error && (
          <p role="status" className="flex items-center gap-2 rounded-full bg-gold-50 px-3 py-1 text-gold-800 ring-1 ring-gold-200">
            Reconnecting… showing the last update.
            <button type="button" onClick={refresh} className="font-semibold underline underline-offset-2">
              Retry now
            </button>
          </p>
        )}
      </div>

      {data.members.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {!filtering && sort === "rank" && podium.length > 0 && <Podium entries={podium} all={data.members} changes={changes} />}

          <section aria-labelledby="rankings-heading" className="mt-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <h2 id="rankings-heading" className="font-display text-xl font-bold text-navy-900 sm:text-2xl">
                Rankings
              </h2>
              <Toolbar
                query={query}
                onQuery={setQuery}
                sort={sort}
                onSort={setSort}
                scope={scope}
                onScope={setScope}
                presentation={presentation}
                onPresentation={setPresentation}
              />
            </div>

            <p className="mt-3 text-sm text-navy-500" aria-live="polite">
              {filtering
                ? `Showing ${formatNumber(rows.length)} of ${pluralize(data.members.length, "member")}`
                : pluralize(data.members.length, "member")}
            </p>

            {rows.length === 0 ? (
              <NoMatches query={deferredQuery} onClear={() => setQuery("")} />
            ) : (
              <RankingTable rows={rows} changes={changes} presentation={presentation} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Club totals, shown inside the page header. */
export function LeaderboardStats() {
  const { data } = useLeaderboardData();
  const leader = data?.members[0];
  return (
    <section aria-label="Club totals" className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      {data ? (
        <>
          <StatCard label="Active members" value={formatNumber(data.totals.activeMembers)} />
          <StatCard label="Total points earned" value={formatNumber(data.totals.totalPoints)} tone="growth" />
          <StatCard
            label="Leading score"
            value={leader ? formatNumber(leader.score) : "—"}
            hint={leader ? leaderHint(data.members) : undefined}
          />
        </>
      ) : (
        [0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-navy-100/60" aria-hidden="true" />)
      )}
    </section>
  );
}

function leaderHint(members: Entry[]): string {
  const leaders = members.filter((m) => m.rank === 1);
  if (leaders.length === 1) return leaders[0].name;
  return `${leaders.length} members tied for first`;
}

/** Remembers recent score changes so rows can briefly highlight them. */
function useScoreChanges(data: PublicLeaderboard | null): Map<string, number> {
  const previous = useRef<Map<string, number> | null>(null);
  const [changes, setChanges] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!data) return;
    const current = new Map(data.members.map((m) => [m.id, m.score]));
    const prev = previous.current;
    previous.current = current;
    if (!prev) return;
    const diff = new Map<string, number>();
    for (const [id, score] of current) {
      const before = prev.get(id);
      if (before !== undefined && before !== score) diff.set(id, score - before);
    }
    if (diff.size === 0) return;
    // Reacting to an external data update, not deriving render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChanges(diff);
    const t = setTimeout(() => setChanges(new Map()), 6000);
    return () => clearTimeout(t);
  }, [data]);

  return changes;
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "growth" }) {
  return (
    <div className="h-28 overflow-hidden rounded-2xl border border-navy-100 bg-card px-5 py-4 shadow-sm dark:bg-navy-50">
      <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">{label}</p>
      <p
        className={`mt-1 font-mono text-3xl font-bold tabular-nums sm:text-4xl ${tone === "growth" ? "text-growth-600 dark:text-growth-400" : "text-navy-900"}`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-sm text-navy-500">{hint}</p>}
    </div>
  );
}

function LiveIndicator({ stale, lastFetched }: { stale: boolean; lastFetched: Date | null }) {
  return (
    <p className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
        {!stale && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-growth-400 opacity-60" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${stale ? "bg-gold-400" : "bg-growth-500"}`} />
      </span>
      <span>
        <span className="font-semibold text-navy-700">{stale ? "Offline" : "Live"}</span>
        {lastFetched && <> · Updated {formatTime(lastFetched)}</>}
      </span>
    </p>
  );
}

function Podium({ entries, all, changes }: { entries: Entry[]; all: Entry[]; changes: Map<string, number> }) {
  return (
    <section aria-labelledby="podium-heading" className="mt-5">
      <h2 id="podium-heading" className="sr-only">
        Top members
      </h2>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        {entries.map((m, i) => {
          const medal = medalFor(m.rank)!;
          const s = medalStyles[medal];
          const tiedCount = all.filter((e) => e.rank === m.rank).length;
          const isFirst = m.rank === 1;
          return (
            <li
              key={m.id}
              className={`relative flex animate-fade-up items-center gap-3 overflow-hidden rounded-xl border px-4 py-3 shadow-sm transition-shadow hover:shadow-md ${s.card}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className={`absolute inset-x-0 top-0 h-0.5 ${s.accent}`} aria-hidden="true" />
              <RankBadge rank={m.rank} />
              <div className="min-w-0 flex-1">
                <p className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider ${s.label}`}>
                  {isFirst && <CrownIcon />}
                  {tiedCount > 1 ? `Tied for ${ordinal(m.rank)}` : `${ordinal(m.rank)} place`}
                </p>
                <p className="truncate font-display text-base font-bold text-navy-900" title={m.name}>
                  {m.name}
                </p>
              </div>
              <ChangeChip delta={changes.get(m.id)} />
              <p className="flex shrink-0 flex-col items-end">
                <span className="font-mono text-2xl font-bold leading-none tabular-nums text-navy-900">{formatNumber(m.score)}</span>
                <span className="text-[11px] font-medium text-navy-500">{m.score === 1 ? "point" : "points"}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Toolbar(props: {
  query: string;
  onQuery: (q: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  scope: Scope;
  onScope: (s: Scope) => void;
  presentation: boolean;
  onPresentation: (p: boolean) => void;
}) {
  const control =
    "h-11 rounded-xl border border-navy-200 bg-card px-3 text-base text-navy-900 shadow-sm transition-colors hover:border-navy-300 focus:border-growth-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-growth-400/40";
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-64">
        <label htmlFor="member-search" className="sr-only">
          Search members by name
        </label>
        <SearchIcon />
        <input
          id="member-search"
          type="search"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder="Find your name…"
          autoComplete="off"
          className={`${control} w-full pl-10`}
        />
      </div>
      <div className="flex gap-2">
        <label htmlFor="sort" className="sr-only">
          Sort by
        </label>
        <select id="sort" value={props.sort} onChange={(e) => props.onSort(e.target.value as SortKey)} className={`${control} min-w-0 flex-1`}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Members shown" className="flex shrink-0 rounded-xl border border-navy-200 bg-card p-1 shadow-sm">
          {(["all", "top10"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={props.scope === s}
              onClick={() => props.onScope(s)}
              className={`rounded-lg px-3 text-sm font-semibold transition-colors ${
                props.scope === s ? "bg-primary text-on-primary" : "text-navy-600 hover:bg-navy-50"
              }`}
            >
              {s === "all" ? "All" : "Top 10"}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-pressed={props.presentation}
        onClick={() => props.onPresentation(!props.presentation)}
        className={`${control} inline-flex items-center justify-center gap-2 font-semibold ${
          props.presentation ? "border-growth-500 bg-growth-50 text-growth-700" : "text-navy-700"
        }`}
        title="Larger text for classroom displays (Esc to exit)"
      >
        <ScreenIcon />
        {props.presentation ? "Exit large view" : "Large view"}
      </button>
    </div>
  );
}

function RankingTable({ rows, changes, presentation }: { rows: Entry[]; changes: Map<string, number>; presentation: boolean }) {
  const cell = presentation ? "py-4 sm:py-5" : "py-3 sm:py-3.5";
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-navy-100 bg-card shadow-sm shadow-navy-900/5">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Members ranked by total points</caption>
        <thead className="bg-navy-50/70 text-xs font-semibold uppercase tracking-wider text-navy-500">
          <tr>
            <th scope="col" className="w-20 px-4 py-3 sm:w-24 sm:px-6">
              Rank
            </th>
            <th scope="col" className="px-2 py-3">
              Member
            </th>
            <th scope="col" className="px-4 py-3 text-right sm:px-6">
              Points
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {rows.map((m) => {
            const medal = medalFor(m.rank);
            const delta = changes.get(m.id);
            return (
              <tr
                key={m.id}
                className={`transition-colors hover:bg-navy-50/60 ${medal ? medalStyles[medal].row : ""} ${delta ? "animate-flash" : ""}`}
              >
                <td className={`px-4 sm:px-6 ${cell}`}>
                  <RankBadge rank={m.rank} large={presentation} />
                </td>
                <th scope="row" className={`px-2 font-semibold text-navy-900 ${cell} ${presentation ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"}`}>
                  <span className="flex flex-wrap items-center gap-2">
                    {m.name}
                    {m.rank === 1 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-gold-600 ring-1 ring-gold-200">
                        <CrownIcon /> Leader
                      </span>
                    )}
                  </span>
                </th>
                <td className={`px-4 text-right sm:px-6 ${cell}`}>
                  <span className="inline-flex items-center justify-end gap-2">
                    <ChangeChip delta={delta} />
                    <span className={`font-mono font-bold tabular-nums text-navy-900 ${presentation ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}`}>
                      {formatNumber(m.score)}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RankBadge({ rank, large }: { rank: number; large?: boolean }) {
  const medal = medalFor(rank);
  const size = large ? "h-12 w-12 text-lg" : "h-9 w-9 text-sm";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold tabular-nums ${size} ${
        medal ? medalStyles[medal].badge : "bg-navy-50 text-navy-600"
      }`}
    >
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

function ChangeChip({ delta }: { delta?: number }) {
  if (!delta) return null;
  const up = delta > 0;
  return (
    <span
      className={`animate-fade-up rounded-full px-2 py-0.5 font-mono text-xs font-bold ${
        up ? "bg-growth-100 text-growth-700" : "bg-loss-50 text-loss-700"
      }`}
    >
      <span className="sr-only">{up ? "gained " : "lost "}</span>
      {formatDelta(delta)}
    </span>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-live="polite" className="mt-6 sm:mt-8">
      <span className="sr-only">Loading the leaderboard…</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-navy-100/60" />
        ))}
      </div>
      <div className="mt-8 space-y-2 rounded-2xl border border-navy-100 bg-card p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <div className="h-9 w-9 animate-pulse rounded-full bg-navy-100" />
            <div className="h-4 flex-1 animate-pulse rounded bg-navy-100" style={{ maxWidth: `${40 + ((i * 17) % 40)}%` }} />
            <div className="ml-auto h-5 w-10 animate-pulse rounded bg-navy-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-6 rounded-2xl border border-navy-100 bg-card px-6 py-12 text-center shadow-sm sm:mt-8">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold-50 text-gold-600 ring-1 ring-gold-200">
        <svg viewBox="0 0 20 20" className="h-6 w-6" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.5 2.9a1.75 1.75 0 0 1 3 0l6.3 11.1A1.75 1.75 0 0 1 16.3 16.6H3.7a1.75 1.75 0 0 1-1.5-2.6L8.5 2.9ZM10 7a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 7Zm0 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
        </svg>
      </div>
      <h2 className="mt-4 font-display text-xl font-bold text-navy-900">{message}</h2>
      <p className="mt-1 text-navy-500">This is usually temporary. Please try again in a moment.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 rounded-xl bg-primary px-5 py-2.5 font-semibold text-on-primary transition-colors hover:bg-primary-hover"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-navy-200 bg-card px-6 py-14 text-center">
      <p className="font-display text-xl font-bold text-navy-900">No members on the leaderboard yet</p>
      <p className="mt-1 text-navy-500">Check back soon — rankings appear here as soon as members are added.</p>
    </div>
  );
}

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-navy-200 bg-card px-6 py-12 text-center">
      <p className="font-semibold text-navy-900">{query.trim() ? `No members match “${query.trim()}”` : "No members to show"}</p>
      <p className="mt-1 text-sm text-navy-500">Check the spelling, or try just your first or last name.</p>
      {query && (
        <button type="button" onClick={onClear} className="mt-4 font-semibold text-growth-700 underline underline-offset-2 hover:text-growth-800">
          Clear search
        </button>
      )}
    </div>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M2.5 6.5 6.6 9.6 10 3.8l3.4 5.8 4.1-3.1-1.6 8.3H4.1L2.5 6.5ZM4.3 15.8h11.4v1.4H4.3z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z" clipRule="evenodd" />
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.11l.58 1.5h.53a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h.53l.58-1.5H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Zm2.25-.75a.75.75 0 0 0-.75.75v8.5c0 .41.34.75.75.75h11.5a.75.75 0 0 0 .75-.75v-8.5a.75.75 0 0 0-.75-.75H4.25Z" clipRule="evenodd" />
    </svg>
  );
}
