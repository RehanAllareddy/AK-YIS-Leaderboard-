"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AdminMember } from "@/lib/server/members";
import type { PointSettings } from "@/lib/validation";
import { DEFAULT_POINT_SETTINGS } from "@/lib/constants";
import { api, ApiError } from "@/lib/client/api";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { MembersPanel } from "./MembersPanel";
import { ActivityPanel } from "./ActivityPanel";
import { SettingsPanel } from "./SettingsPanel";

const TABS = [
  { id: "members", label: "Members & points" },
  { id: "activity", label: "Audit history" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export interface DashboardContext {
  members: AdminMember[];
  pointSettings: PointSettings;
  upsertMember: (m: AdminMember) => void;
  handleError: (error: unknown) => void;
  /** Bumped after every successful change so history views refetch. */
  revision: number;
}

export function AdminDashboard() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}

function Dashboard() {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("members");
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pointSettings, setPointSettings] = useState<PointSettings>({ ...DEFAULT_POINT_SETTINGS });
  const [revision, setRevision] = useState(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        toast.error("Your session has ended. Please sign in again.");
        router.replace("/admin/login");
        return;
      }
      if (error instanceof ApiError && error.code === "STALE" && error.data?.member) {
        const fresh = error.data.member as AdminMember;
        setMembers((list) => list?.map((m) => (m.id === fresh.id ? fresh : m)) ?? list);
      }
      toast.error(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    },
    [router, toast],
  );

  const loadMembers = useCallback(async () => {
    try {
      const { members } = await api<{ members: AdminMember[] }>("/api/admin/members");
      setMembers(members);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return handleError(error);
      setLoadError(error instanceof ApiError ? error.message : "Couldn't load members.");
    }
  }, [handleError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMembers();
    api<{ pointSettings: PointSettings }>("/api/admin/settings")
      .then((s) => setPointSettings(s.pointSettings))
      .catch(() => {});
  }, [loadMembers]);

  const upsertMember = useCallback((member: AdminMember) => {
    setMembers((list) => {
      if (!list) return [member];
      const exists = list.some((m) => m.id === member.id);
      return exists ? list.map((m) => (m.id === member.id ? member : m)) : [...list, member];
    });
    setRevision((r) => r + 1);
  }, []);

  function onTabKey(e: KeyboardEvent, index: number) {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = TABS[(index + dir + TABS.length) % TABS.length];
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  const ctx: DashboardContext | null = members
    ? { members, pointSettings, upsertMember, handleError, revision }
    : null;

  return (
    <div>
      <div role="tablist" aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto rounded-2xl border border-navy-100 bg-card p-1.5 shadow-sm">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.id ? "bg-primary text-on-primary shadow-sm" : "text-navy-600 hover:bg-navy-50 hover:text-navy-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-6" tabIndex={-1}>
        {!ctx ? (
          loadError ? (
            <div role="alert" className="rounded-2xl border border-navy-100 bg-card p-8 text-center">
              <p className="font-semibold text-navy-900">{loadError}</p>
              <button type="button" onClick={loadMembers} className="mt-4 font-semibold text-growth-700 underline underline-offset-2">
                Try again
              </button>
            </div>
          ) : (
            <div role="status" className="space-y-2 rounded-2xl border border-navy-100 bg-card p-4">
              <span className="sr-only">Loading members…</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-navy-50" />
              ))}
            </div>
          )
        ) : tab === "members" ? (
          <MembersPanel ctx={ctx} />
        ) : tab === "activity" ? (
          <ActivityPanel ctx={ctx} />
        ) : (
          <SettingsPanel
            ctx={ctx}
            onSaved={(s) => {
              setPointSettings(s);
              toast.success("Quick-action buttons updated.");
            }}
          />
        )}
      </div>
    </div>
  );
}
