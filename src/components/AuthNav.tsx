"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type SessionInfo = { admin: { username: string; displayName: string | null } | null };

const pill =
  "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-growth-300";

export function AuthNav({ initialAdmin }: { initialAdmin?: SessionInfo["admin"] }) {
  const [admin, setAdmin] = useState<SessionInfo["admin"] | undefined>(initialAdmin);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (initialAdmin !== undefined) return;
    api<SessionInfo>("/api/auth/session")
      .then((s) => setAdmin(s.admin))
      .catch(() => setAdmin(null));
  }, [initialAdmin]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      setAdmin(null);
      setSigningOut(false);
      router.push("/");
      router.refresh();
    }
  }

  if (admin === undefined) return <span className="h-8 w-28" aria-hidden="true" />;

  if (!admin) {
    if (pathname === "/admin/login") return null;
    return (
      <Link href="/admin/login" className={`${pill} border-navy-200 text-navy-700 hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900`}>
        <LockIcon />
        Admin Login
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {pathname.startsWith("/admin") ? (
        <Link href="/" className={`${pill} border-navy-200 text-navy-700 hover:bg-navy-50 hover:text-navy-900`}>
          View leaderboard
        </Link>
      ) : (
        <Link href="/admin" className={`${pill} border-growth-400/50 bg-growth-500/15 text-growth-700 hover:bg-growth-500/25`}>
          Dashboard
        </Link>
      )}
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className={`${pill} border-navy-200 text-navy-700 hover:bg-navy-50 hover:text-navy-900 disabled:opacity-60`}
      >
        {signingOut ? "Signing out…" : "Log out"}
      </button>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
