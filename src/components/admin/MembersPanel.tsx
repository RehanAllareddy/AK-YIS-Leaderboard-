"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { AdminMember, PointsChangeResult } from "@/lib/server/members";
import { api, announceLeaderboardChange } from "@/lib/client/api";
import { formatDelta, formatNumber, pluralize } from "@/lib/format";
import { quickActions } from "@/lib/points";
import { rankMembers } from "@/lib/ranking";
import { buttonStyles, inputStyles } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import type { DashboardContext } from "./AdminDashboard";
import { ConfirmDialog } from "./ConfirmDialog";
import { MemberFormDialog } from "./MemberFormDialog";
import { PointsDialog } from "./PointsDialog";

type StatusFilter = "active" | "inactive" | "all";

export function MembersPanel({ ctx }: { ctx: DashboardContext }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [pointsFor, setPointsFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const ranks = useMemo(
    () => new Map(rankMembers(ctx.members.filter((m) => m.status === "active")).map((m) => [m.id, m.rank])),
    [ctx.members],
  );
  const counts = useMemo(
    () => ({
      active: ctx.members.filter((m) => m.status === "active").length,
      inactive: ctx.members.filter((m) => m.status === "inactive").length,
    }),
    [ctx.members],
  );
  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase();
    return rankMembers(ctx.members).filter(
      (m) => (status === "all" || m.status === status) && (!q || m.name.toLocaleLowerCase().includes(q)),
    );
  }, [ctx.members, deferredQuery, status]);

  const quick = quickActions(ctx.pointSettings);
  const byId = (id: string | null) => (id ? ctx.members.find((m) => m.id === id) : undefined);

  async function quickAdjust(member: AdminMember, delta: number) {
    setPending((p) => new Set(p).add(member.id));
    try {
      const res = await api<PointsChangeResult>(`/api/admin/members/${encodeURIComponent(member.id)}/points`, {
        method: "POST",
        body: { mode: "adjust", delta, expectedVersion: member.version },
      });
      ctx.upsertMember(res.member);
      announceLeaderboardChange();
      toast.success(`${formatDelta(delta)} for ${member.name} — now ${formatNumber(res.member.score)}.`);
    } catch (error) {
      ctx.handleError(error);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(member.id);
        return next;
      });
    }
  }

  const statusTarget = byId(statusFor);

  return (
    <section aria-labelledby="members-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="members-heading" className="font-display text-xl font-bold text-navy-900">
            Members
          </h2>
          <p className="text-sm text-navy-500">
            {pluralize(counts.active, "active member")} · {formatNumber(counts.inactive)} inactive
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className={buttonStyles.growth}>
          <span aria-hidden="true" className="text-lg leading-none">
            +
          </span>
          Add member
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="admin-search" className="sr-only">
          Search members
        </label>
        <input
          id="admin-search"
          type="search"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          className={`${inputStyles} sm:max-w-xs`}
        />
        <label htmlFor="status-filter" className="sr-only">
          Status
        </label>
        <select
          id="status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className={`${inputStyles} sm:w-48`}
        >
          <option value="active">Active ({counts.active})</option>
          <option value="inactive">Inactive ({counts.inactive})</option>
          <option value="all">All members ({ctx.members.length})</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-navy-100 bg-card shadow-sm">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <caption className="sr-only">Members and point totals</caption>
          <thead className="bg-navy-50/70 text-xs font-semibold uppercase tracking-wider text-navy-500">
            <tr>
              <th scope="col" className="w-16 px-4 py-3">
                Rank
              </th>
              <th scope="col" className="px-2 py-3">
                Member
              </th>
              <th scope="col" className="px-2 py-3 text-right">
                Points
              </th>
              <th scope="col" className="px-4 py-3">
                Quick adjust
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-navy-500">
                  {query.trim() ? `No members match “${query.trim()}”.` : "No members in this view."}
                </td>
              </tr>
            )}
            {rows.map((m) => {
              const busy = pending.has(m.id);
              const inactive = m.status === "inactive";
              return (
                <tr key={m.id} className={`transition-colors hover:bg-navy-50/50 ${inactive ? "bg-navy-50/40" : ""}`}>
                  <td className="px-4 py-3 font-mono text-sm font-bold tabular-nums text-navy-500">{ranks.get(m.id) ?? "—"}</td>
                  <th scope="row" className="px-2 py-3 font-semibold text-navy-900">
                    <span className="flex items-center gap-2">
                      {m.name}
                      {inactive && (
                        <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-semibold text-navy-600">Inactive</span>
                      )}
                    </span>
                  </th>
                  <td className="px-2 py-3 text-right font-mono text-lg font-bold tabular-nums text-navy-900">
                    {formatNumber(m.score)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5" role="group" aria-label={`Quick adjust ${m.name}`}>
                      {quick.map((d) => (
                        <button
                          key={d}
                          type="button"
                          disabled={busy || inactive || m.score + d < 0}
                          onClick={() => quickAdjust(m, d)}
                          aria-label={`${d > 0 ? "Add" : "Subtract"} ${Math.abs(d)} ${Math.abs(d) === 1 ? "point" : "points"} ${d > 0 ? "to" : "from"} ${m.name}`}
                          className={`h-9 min-w-11 rounded-lg px-2 font-mono text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                            d > 0
                              ? "bg-growth-50 text-growth-700 ring-1 ring-growth-200 hover:bg-growth-100"
                              : "bg-loss-50 text-loss-700 ring-1 ring-loss-600/20 hover:bg-loss-600/10"
                          }`}
                        >
                          {formatDelta(d)}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setPointsFor(m.id)} className={buttonStyles.ghost} disabled={inactive}>
                        Edit points<span className="sr-only"> for {m.name}</span>
                      </button>
                      <button type="button" onClick={() => setRenameFor(m.id)} className={buttonStyles.ghost}>
                        Rename<span className="sr-only"> {m.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFor(m.id)}
                        className={`${buttonStyles.ghost} ${inactive ? "text-growth-700" : "text-loss-700 hover:text-loss-700"}`}
                      >
                        {inactive ? "Reactivate" : "Deactivate"}
                        <span className="sr-only"> {m.name}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PointsDialog
        member={byId(pointsFor)}
        quick={quick}
        onClose={() => setPointsFor(null)}
        onSaved={(res) => {
          ctx.upsertMember(res.member);
          announceLeaderboardChange();
          setPointsFor(null);
          toast.success(
            `${res.member.name}: ${formatNumber(res.adjustment.previousScore)} → ${formatNumber(res.adjustment.newScore)} (${formatDelta(res.adjustment.delta)}).`,
          );
        }}
        onError={ctx.handleError}
      />

      <MemberFormDialog
        mode="add"
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(member) => {
          ctx.upsertMember(member);
          announceLeaderboardChange();
          setAdding(false);
          setStatus("active");
          toast.success(`Added ${member.name}.`);
        }}
        onError={ctx.handleError}
      />

      <MemberFormDialog
        mode="rename"
        member={byId(renameFor)}
        open={Boolean(renameFor)}
        onClose={() => setRenameFor(null)}
        onSaved={(member) => {
          ctx.upsertMember(member);
          announceLeaderboardChange();
          setRenameFor(null);
          toast.success(`Renamed to ${member.name}.`);
        }}
        onError={ctx.handleError}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={statusTarget?.status === "active" ? `Deactivate ${statusTarget?.name}?` : `Reactivate ${statusTarget?.name}?`}
        body={
          statusTarget?.status === "active"
            ? "They'll be hidden from the public leaderboard. Their points and history are kept, and you can reactivate them at any time."
            : "They'll reappear on the public leaderboard with their existing points."
        }
        confirmLabel={statusTarget?.status === "active" ? "Deactivate" : "Reactivate"}
        tone={statusTarget?.status === "active" ? "danger" : "growth"}
        onClose={() => setStatusFor(null)}
        onConfirm={async () => {
          if (!statusTarget) return;
          const next = statusTarget.status === "active" ? "inactive" : "active";
          try {
            const { member } = await api<{ member: AdminMember }>(`/api/admin/members/${encodeURIComponent(statusTarget.id)}`, {
              method: "PATCH",
              body: { status: next, expectedVersion: statusTarget.version },
            });
            ctx.upsertMember(member);
            announceLeaderboardChange();
            toast.success(`${member.name} ${next === "active" ? "reactivated" : "deactivated"}.`);
            setStatusFor(null);
          } catch (error) {
            ctx.handleError(error);
          }
        }}
      />
    </section>
  );
}
