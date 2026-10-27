"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client/api";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { username, password } });
      setPassword("");
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  const input =
    "mt-1.5 block h-12 w-full rounded-xl border border-navy-200 bg-card px-3.5 text-base text-navy-900 shadow-sm transition-colors placeholder:text-navy-300 hover:border-navy-300 focus:border-growth-500 focus:outline-none focus:ring-2 focus:ring-growth-400/30";

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
      {error && (
        <div role="alert" className="rounded-xl border border-loss-600/20 bg-loss-50 px-4 py-3 text-sm font-medium text-loss-700">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="username" className="text-sm font-semibold text-navy-800">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={input}
          aria-invalid={Boolean(error) || undefined}
        />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-semibold text-navy-800">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${input} pr-20`}
            aria-invalid={Boolean(error) || undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-pressed={showPassword}
            aria-controls="password"
            className="absolute right-2 top-1/2 mt-[3px] -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-navy-500 hover:bg-navy-50 hover:text-navy-800"
          >
            {showPassword ? "Hide" : "Show"}
            <span className="sr-only"> password</span>
          </button>
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80"
      >
        {pending && <Spinner />}
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
