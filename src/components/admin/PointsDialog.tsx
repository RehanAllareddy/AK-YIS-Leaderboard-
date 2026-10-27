"use client";

import { useState, type FormEvent } from "react";
import type { AdminMember, PointsChangeResult } from "@/lib/server/members";
import { api, ApiError } from "@/lib/client/api";
import { REASON_MAX_LENGTH } from "@/lib/constants";
import { formatDelta, formatNumber } from "@/lib/format";
import { requiresConfirmation } from "@/lib/points";
import { deltaSchema, firstIssue, scoreSchema } from "@/lib/validation";
import { buttonStyles, Dialog, inputStyles } from "@/components/ui/Dialog";
import { Spinner } from "./LoginForm";

type Mode = "adjust" | "set";

export function PointsDialog({
  member,
  quick,
  onClose,
  onSaved,
  onError,
}: {
  member: AdminMember | undefined;
  quick: number[];
  onClose: () => void;
  onSaved: (result: PointsChangeResult) => void;
  onError: (error: unknown) => void;
}) {
  return (
    <Dialog
      open={Boolean(member)}
      onClose={onClose}
      title={member ? `Edit points — ${member.name}` : "Edit points"}
      description={member ? <>Current total: <strong className="text-navy-800">{formatNumber(member.score)}</strong></> : undefined}
    >
      {member && <PointsForm key={member.id} member={member} quick={quick} onClose={onClose} onSaved={onSaved} onError={onError} />}
    </Dialog>
  );
}

function PointsForm({
  member,
  quick,
  onClose,
  onSaved,
  onError,
}: {
  member: AdminMember;
  quick: number[];
  onClose: () => void;
  onSaved: (result: PointsChangeResult) => void;
  onError: (error: unknown) => void;
}) {
  const [mode, setMode] = useState<Mode>("adjust");
  const [deltaText, setDeltaText] = useState("");
  const [totalText, setTotalText] = useState(String(member.score));
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  // Derive the outcome and any validation problem from the current inputs.
  const preview = (() => {
    const text = mode === "adjust" ? deltaText : totalText;
    if (text.trim() === "" || text.trim() === "-" || text.trim() === "+") return { error: null, newScore: null };
    const value = Number(text);
    if (mode === "adjust") {
      const parsed = deltaSchema.safeParse(value);
      if (!parsed.success) return { error: firstIssue(parsed.error), newScore: null };
      const newScore = member.score + parsed.data;
      if (newScore < 0) return { error: `That would take ${member.name} below 0 points.`, newScore: null };
      return { error: null, newScore };
    }
    const parsed = scoreSchema.safeParse(value);
    if (!parsed.success) return { error: firstIssue(parsed.error), newScore: null };
    if (parsed.data === member.score) return { error: "That's already the current total.", newScore: null };
    return { error: null, newScore: parsed.data };
  })();

  const delta = preview.newScore === null ? null : preview.newScore - member.score;
  const isReset = mode === "set" && preview.newScore === 0;

  async function submit(confirmed: boolean) {
    if (preview.newScore === null) return;
    setPending(true);
    try {
      const body =
        mode === "adjust"
          ? { mode, delta: delta!, reason: reason || undefined, expectedVersion: member.version, confirmed }
          : { mode, score: preview.newScore, reason: reason || undefined, expectedVersion: member.version, confirmed };
      const res = await api<PointsChangeResult>(`/api/admin/members/${encodeURIComponent(member.id)}/points`, {
        method: "POST",
        body,
      });
      onSaved(res);
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.code === "CONFIRMATION_REQUIRED") {
        setConfirming(true);
        return;
      }
      setConfirming(false);
      onError(error);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (preview.newScore === null) return;
    if (!confirming && requiresConfirmation(member.score, preview.newScore)) {
      setConfirming(true);
      return;
    }
    submit(confirming);
  }

  if (confirming && preview.newScore !== null && delta !== null) {
    return (
      <div>
        <div role="alert" className="rounded-xl border border-gold-200 bg-gold-50 p-4 text-gold-800">
          <p className="font-semibold">{isReset ? "Reset points to zero?" : "Confirm a large change"}</p>
          <p className="mt-1 text-sm">
            {member.name} will go from <strong>{formatNumber(member.score)}</strong> to{" "}
            <strong>{formatNumber(preview.newScore)}</strong> points ({formatDelta(delta)}).
          </p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={buttonStyles.secondary}>
            Go back
          </button>
          <button type="button" onClick={() => submit(true)} disabled={pending} className={isReset ? buttonStyles.danger : buttonStyles.primary}>
            {pending && <Spinner />}
            {isReset ? "Yes, reset to 0" : "Yes, save change"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div role="radiogroup" aria-label="Change type" className="grid grid-cols-2 gap-1 rounded-xl bg-navy-50 p-1">
        {(["adjust", "set"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              mode === m ? "bg-card text-navy-900 shadow-sm" : "text-navy-500 hover:text-navy-800"
            }`}
          >
            {m === "adjust" ? "Add / subtract" : "Set total"}
          </button>
        ))}
      </div>

      {mode === "adjust" ? (
        <div>
          <label htmlFor="points-delta" className="text-sm font-semibold text-navy-800">
            Adjustment
          </label>
          <p id="points-delta-hint" className="text-xs text-navy-500">
            Use a negative number to subtract (e.g. −2).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {quick.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDeltaText(String(d))}
                aria-pressed={deltaText === String(d)}
                className={`h-10 min-w-14 rounded-lg px-3 font-mono font-bold ring-1 transition-colors ${
                  deltaText === String(d)
                    ? "bg-primary text-on-primary ring-primary"
                    : d > 0
                      ? "bg-growth-50 text-growth-700 ring-growth-200 hover:bg-growth-100"
                      : "bg-loss-50 text-loss-700 ring-loss-600/20 hover:bg-loss-600/10"
                }`}
              >
                {formatDelta(d)}
              </button>
            ))}
          </div>
          <input
            id="points-delta"
            autoFocus
            inputMode="numeric"
            placeholder="Custom, e.g. 3 or -2"
            value={deltaText}
            onChange={(e) => setDeltaText(e.target.value.replace(/[−–]/g, "-"))}
            aria-invalid={Boolean(preview.error) || undefined}
            aria-describedby="points-delta-hint points-error"
            className={`${inputStyles} mt-2 font-mono sm:w-56`}
          />
        </div>
      ) : (
        <div>
          <label htmlFor="points-total" className="text-sm font-semibold text-navy-800">
            New total
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id="points-total"
              autoFocus
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={totalText}
              onChange={(e) => setTotalText(e.target.value)}
              aria-invalid={Boolean(preview.error) || undefined}
              aria-describedby="points-error"
              className={`${inputStyles} font-mono sm:w-40`}
            />
            {member.score > 0 && (
              <button type="button" onClick={() => setTotalText("0")} className={buttonStyles.secondary}>
                Reset to 0
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="points-reason" className="text-sm font-semibold text-navy-800">
          Reason <span className="font-normal text-navy-400">(optional)</span>
        </label>
        <input
          id="points-reason"
          maxLength={REASON_MAX_LENGTH}
          placeholder="e.g. Stock pitch presentation"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${inputStyles} mt-1.5`}
        />
      </div>

      <div
        aria-live="polite"
        className={`rounded-xl border p-4 ${preview.error ? "border-loss-600/20 bg-loss-50" : "border-navy-100 bg-navy-50/60"}`}
      >
        {preview.error ? (
          <p id="points-error" className="text-sm font-medium text-loss-700">
            {preview.error}
          </p>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">Current</p>
              <p className="font-mono text-2xl font-bold tabular-nums text-navy-700">{formatNumber(member.score)}</p>
            </div>
            <div className="text-center">
              <span
                className={`rounded-full px-2.5 py-1 font-mono text-sm font-bold ${
                  delta === null ? "bg-navy-100 text-navy-400" : delta > 0 ? "bg-growth-100 text-growth-700" : "bg-loss-50 text-loss-700"
                }`}
              >
                {delta === null ? "±0" : formatDelta(delta)}
              </span>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">New total</p>
              <p className="font-mono text-2xl font-bold tabular-nums text-navy-900">
                {preview.newScore === null ? "—" : formatNumber(preview.newScore)}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={buttonStyles.secondary}>
          Cancel
        </button>
        <button type="submit" disabled={pending || preview.newScore === null} className={buttonStyles.primary}>
          {pending && <Spinner />}
          Save change
        </button>
      </div>
    </form>
  );
}
