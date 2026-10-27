"use client";

import { useState, type FormEvent } from "react";
import type { AdminMember } from "@/lib/server/members";
import { api } from "@/lib/client/api";
import { NAME_MAX_LENGTH } from "@/lib/constants";
import { firstIssue, memberNameSchema, scoreSchema } from "@/lib/validation";
import { buttonStyles, Dialog, inputStyles } from "@/components/ui/Dialog";
import { Spinner } from "./LoginForm";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (member: AdminMember) => void;
  onError: (error: unknown) => void;
} & ({ mode: "add"; member?: undefined } | { mode: "rename"; member?: AdminMember });

export function MemberFormDialog(props: Props) {
  const title = props.mode === "add" ? "Add a member" : `Rename ${props.member?.name ?? "member"}`;
  return (
    <Dialog open={props.open} onClose={props.onClose} title={title} size="sm">
      {/* Remount the form each time so fields start fresh. */}
      {props.open && <MemberForm key={props.member?.id ?? "new"} {...props} />}
    </Dialog>
  );
}

function MemberForm({ mode, member, onClose, onSaved, onError }: Props) {
  const [name, setName] = useState(member?.name ?? "");
  const [initial, setInitial] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsedName = memberNameSchema.safeParse(name);
    if (!parsedName.success) return setError(firstIssue(parsedName.error));
    let initialScore = 0;
    if (mode === "add") {
      const parsedScore = scoreSchema.safeParse(initial.trim() === "" ? 0 : Number(initial));
      if (!parsedScore.success) return setError(firstIssue(parsedScore.error));
      initialScore = parsedScore.data;
    }
    if (mode === "rename" && member && parsedName.data === member.name) return onClose();

    setPending(true);
    setError(null);
    try {
      const res =
        mode === "add"
          ? await api<{ member: AdminMember }>("/api/admin/members", { method: "POST", body: { name: parsedName.data, initialScore } })
          : await api<{ member: AdminMember }>(`/api/admin/members/${encodeURIComponent(member!.id)}`, {
              method: "PATCH",
              body: { name: parsedName.data, expectedVersion: member!.version },
            });
      onSaved(res.member);
    } catch (err) {
      onError(err);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="member-name" className="text-sm font-semibold text-navy-800">
          Full name
        </label>
        <input
          id="member-name"
          autoFocus
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "member-form-error" : undefined}
          className={`${inputStyles} mt-1.5`}
        />
      </div>
      {mode === "add" && (
        <div>
          <label htmlFor="member-initial" className="text-sm font-semibold text-navy-800">
            Starting points <span className="font-normal text-navy-400">(optional)</span>
          </label>
          <input
            id="member-initial"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={initial}
            onChange={(e) => {
              setInitial(e.target.value);
              setError(null);
            }}
            className={`${inputStyles} mt-1.5 sm:w-40`}
          />
        </div>
      )}
      {error && (
        <p id="member-form-error" role="alert" className="text-sm font-medium text-loss-700">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={buttonStyles.secondary}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={buttonStyles.primary}>
          {pending && <Spinner />}
          {mode === "add" ? "Add member" : "Save name"}
        </button>
      </div>
    </form>
  );
}
