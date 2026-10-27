"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { formatDateTime } from "@/lib/format";
import { firstIssue, pointSettingsSchema, type PointSettings } from "@/lib/validation";
import { buttonStyles, inputStyles } from "@/components/ui/Dialog";
import type { DashboardContext } from "./AdminDashboard";
import { Spinner } from "./LoginForm";

const KEYS = ["btn1", "btn2", "btn3", "btn4"] as const;

interface LastImport {
  source: string;
  at: string;
  summary: { imported: number; updated: number; skipped: number; rejected: number; totalRecords: number };
}

export function SettingsPanel({ ctx, onSaved }: { ctx: DashboardContext; onSaved: (s: PointSettings) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(KEYS.map((k) => [k, String(ctx.pointSettings[k])])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastImport, setLastImport] = useState<LastImport | null | undefined>(undefined);

  useEffect(() => {
    api<{ lastImport: LastImport | null }>("/api/admin/settings")
      .then((s) => setLastImport(s.lastImport))
      .catch(() => setLastImport(null));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = pointSettingsSchema.safeParse(Object.fromEntries(KEYS.map((k) => [k, Number(values[k])])));
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setPending(true);
    setError(null);
    try {
      const res = await api<{ pointSettings: PointSettings }>("/api/admin/settings", {
        method: "PUT",
        body: { pointSettings: parsed.data },
      });
      onSaved(res.pointSettings);
    } catch (err) {
      ctx.handleError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="quick-heading" className="rounded-2xl border border-navy-100 bg-card p-6 shadow-sm">
        <h2 id="quick-heading" className="font-display text-lg font-bold text-navy-900">
          Quick-action buttons
        </h2>
        <p className="mt-1 text-sm text-navy-500">
          The one-click point values shown next to each member. Use negative numbers to subtract; 0 hides a button.
        </p>
        <form onSubmit={onSubmit} noValidate className="mt-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {KEYS.map((k, i) => (
              <div key={k}>
                <label htmlFor={`setting-${k}`} className="text-xs font-semibold uppercase tracking-wider text-navy-500">
                  Button {i + 1}
                </label>
                <input
                  id={`setting-${k}`}
                  inputMode="numeric"
                  value={values[k]}
                  onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value.replace(/[−–]/g, "-") }))}
                  className={`${inputStyles} mt-1 font-mono`}
                />
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-loss-700">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className={`${buttonStyles.primary} mt-5`}>
            {pending && <Spinner />}
            Save buttons
          </button>
        </form>
      </section>

      <section aria-labelledby="import-heading" className="rounded-2xl border border-navy-100 bg-card p-6 shadow-sm">
        <h2 id="import-heading" className="font-display text-lg font-bold text-navy-900">
          Data import
        </h2>
        {lastImport === undefined ? (
          <div className="mt-4 h-20 animate-pulse rounded-xl bg-navy-50" />
        ) : lastImport === null ? (
          <p className="mt-2 text-sm text-navy-500">No import has been run yet. See the README for `npm run db:import`.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-navy-500">
              Most recent import: <strong className="text-navy-800">{lastImport.source}</strong> on {formatDateTime(lastImport.at)}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["imported", "updated", "skipped", "rejected"] as const).map((k) => (
                <div key={k} className="rounded-xl bg-navy-50/70 px-3 py-2">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-navy-400">{k}</dt>
                  <dd className="font-mono text-xl font-bold text-navy-900">{lastImport.summary[k]}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <p className="mt-4 text-sm text-navy-500">
          Re-running the import is safe: existing members are never overwritten unless you pass <code>--overwrite</code>.
        </p>
      </section>
    </div>
  );
}
