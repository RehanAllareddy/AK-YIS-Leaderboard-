"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MemberEvent, PointAdjustment } from "@/lib/server/members";
import { api } from "@/lib/client/api";
import { formatDateTime, formatDelta, formatNumber } from "@/lib/format";
import { compareNames } from "@/lib/ranking";
import { buttonStyles, inputStyles } from "@/components/ui/Dialog";
import type { DashboardContext } from "./AdminDashboard";

type View = "points" | "members";

const KIND_LABEL: Record<PointAdjustment["kind"], string> = {
  adjust: "Adjustment",
  set: "Set total",
  reset: "Reset",
  import: "Import",
};

const ACTION_LABEL: Record<string, string> = {
  created: "Added",
  renamed: "Renamed",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
  imported: "Imported",
  import_updated: "Updated by import",
};

export function ActivityPanel({ ctx }: { ctx: DashboardContext }) {
  const [view, setView] = useState<View>("points");
  const [memberId, setMemberId] = useState("");
  const sortedMembers = useMemo(() => [...ctx.members].sort((a, b) => compareNames(a.name, b.name)), [ctx.members]);
  const selected = ctx.members.find((m) => m.id === memberId);

  return (
    <section aria-labelledby="activity-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="activity-heading" className="font-display text-xl font-bold text-navy-900">
            Audit history
          </h2>
          <p className="text-sm text-navy-500">Every change is recorded permanently and can&rsquo;t be edited.</p>
        </div>
        <div role="group" aria-label="History type" className="flex rounded-xl border border-navy-200 bg-card p-1 shadow-sm">
          {(["points", "members"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-primary text-on-primary" : "text-navy-600 hover:bg-navy-50"}`}
            >
              {v === "points" ? "Point changes" : "Member changes"}
            </button>
          ))}
        </div>
      </div>

      {view === "points" ? (
        <>
          <div className="mt-4">
            <label htmlFor="history-member" className="sr-only">
              Filter by member
            </label>
            <select id="history-member" value={memberId} onChange={(e) => setMemberId(e.target.value)} className={`${inputStyles} sm:max-w-xs`}>
              <option value="">All members</option>
              {sortedMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.status === "inactive" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>
          <PointHistory key={`${memberId}:${ctx.revision}`} memberId={memberId || undefined} onError={ctx.handleError} />
          {selected && selected.legacyHistory.length > 0 && (
            <div className="mt-4 rounded-2xl border border-navy-100 bg-card p-5 shadow-sm">
              <h3 className="font-semibold text-navy-900">Imported history</h3>
              <p className="text-sm text-navy-500">
                Point changes from the original leaderboard (before this system), oldest first. Sum:{" "}
                {formatDelta(selected.legacyHistory.reduce((a, b) => a + b, 0))}.
              </p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {selected.legacyHistory.map((d, i) => (
                  <li
                    key={i}
                    className={`rounded-md px-2 py-0.5 font-mono text-sm font-bold ${d >= 0 ? "bg-growth-50 text-growth-700" : "bg-loss-50 text-loss-700"}`}
                  >
                    {formatDelta(d)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <MemberHistory key={ctx.revision} onError={ctx.handleError} />
      )}
    </section>
  );
}

function usePaged<T extends { id: number }>(url: string, key: string, onError: (e: unknown) => void) {
  const [items, setItems] = useState<T[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      try {
        const sep = url.includes("?") ? "&" : "?";
        const res = await api<Record<string, T[]>>(`${url}${before ? `${sep}before=${before}` : ""}`);
        const page = res[key];
        setItems((prev) => (before && prev ? [...prev, ...page] : page));
        setHasMore(page.length >= 50);
      } catch (error) {
        onError(error);
        setItems((prev) => prev ?? []);
      } finally {
        setLoading(false);
      }
    },
    [url, key, onError],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { items, hasMore, loading, loadMore: () => items?.length && load(items[items.length - 1].id) };
}

function PointHistory({ memberId, onError }: { memberId?: string; onError: (e: unknown) => void }) {
  const url = memberId ? `/api/admin/history?memberId=${encodeURIComponent(memberId)}` : "/api/admin/history";
  const { items, hasMore, loading, loadMore } = usePaged<PointAdjustment>(url, "adjustments", onError);

  return (
    <HistoryShell items={items} hasMore={hasMore} loading={loading} onMore={loadMore} empty="No point changes recorded yet.">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <caption className="sr-only">Point adjustment history</caption>
        <thead className="bg-navy-50/70 text-xs font-semibold uppercase tracking-wider text-navy-500">
          <tr>
            <th scope="col" className="px-4 py-3">When</th>
            <th scope="col" className="px-2 py-3">Member</th>
            <th scope="col" className="px-2 py-3 text-right">Change</th>
            <th scope="col" className="px-2 py-3 text-right">Previous → New</th>
            <th scope="col" className="px-2 py-3">Type</th>
            <th scope="col" className="px-2 py-3">By</th>
            <th scope="col" className="px-4 py-3">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {items?.map((a) => (
            <tr key={a.id} className="hover:bg-navy-50/50">
              <td className="whitespace-nowrap px-4 py-3 text-navy-500">
                <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
              </td>
              <td className="px-2 py-3 font-semibold text-navy-900">{a.memberName}</td>
              <td className={`px-2 py-3 text-right font-mono font-bold ${a.delta > 0 ? "text-growth-700" : "text-loss-700"}`}>
                {formatDelta(a.delta)}
              </td>
              <td className="whitespace-nowrap px-2 py-3 text-right font-mono tabular-nums text-navy-700">
                {formatNumber(a.previousScore)} → {formatNumber(a.newScore)}
              </td>
              <td className="px-2 py-3 text-navy-600">{KIND_LABEL[a.kind]}</td>
              <td className="px-2 py-3 text-navy-600">{a.adminUsername}</td>
              <td className="px-4 py-3 text-navy-600">{a.reason ?? <span className="text-navy-300">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HistoryShell>
  );
}

function MemberHistory({ onError }: { onError: (e: unknown) => void }) {
  const { items, hasMore, loading, loadMore } = usePaged<MemberEvent>("/api/admin/events", "events", onError);
  return (
    <HistoryShell items={items} hasMore={hasMore} loading={loading} onMore={loadMore} empty="No member changes recorded yet.">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">Member change history</caption>
        <thead className="bg-navy-50/70 text-xs font-semibold uppercase tracking-wider text-navy-500">
          <tr>
            <th scope="col" className="px-4 py-3">When</th>
            <th scope="col" className="px-2 py-3">Member</th>
            <th scope="col" className="px-2 py-3">Action</th>
            <th scope="col" className="px-2 py-3">Details</th>
            <th scope="col" className="px-4 py-3">By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {items?.map((e) => (
            <tr key={e.id} className="hover:bg-navy-50/50">
              <td className="whitespace-nowrap px-4 py-3 text-navy-500">
                <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time>
              </td>
              <td className="px-2 py-3 font-semibold text-navy-900">{e.memberName}</td>
              <td className="px-2 py-3 text-navy-700">{ACTION_LABEL[e.action] ?? e.action}</td>
              <td className="px-2 py-3 text-navy-600">{describeEvent(e)}</td>
              <td className="px-4 py-3 text-navy-600">{e.adminUsername}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HistoryShell>
  );
}

function describeEvent(e: MemberEvent): string {
  const d = e.details as Record<string, unknown>;
  switch (e.action) {
    case "renamed":
      return `“${d.from}” → “${d.to}”`;
    case "created":
      return d.initialScore ? `Starting points: ${d.initialScore}` : "";
    case "imported":
      return `From ${d.source} with ${d.score} points (${d.status})`;
    case "import_updated":
      return `From ${d.source}: ${(d.fields as string[] | undefined)?.join(", ")}`;
    default:
      return "";
  }
}

function HistoryShell({
  items,
  hasMore,
  loading,
  onMore,
  empty,
  children,
}: {
  items: unknown[] | null;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  empty: string;
  children: React.ReactNode;
}) {
  if (items === null) {
    return (
      <div role="status" className="mt-4 space-y-2 rounded-2xl border border-navy-100 bg-card p-4">
        <span className="sr-only">Loading history…</span>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-navy-50" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="mt-4 rounded-2xl border border-dashed border-navy-200 bg-card px-6 py-12 text-center text-navy-500">{empty}</p>;
  }
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-navy-100 bg-card shadow-sm">{children}</div>
      {hasMore && (
        <div className="mt-4 text-center">
          <button type="button" onClick={onMore} disabled={loading} className={buttonStyles.secondary}>
            {loading ? "Loading…" : "Load older entries"}
          </button>
        </div>
      )}
    </>
  );
}
