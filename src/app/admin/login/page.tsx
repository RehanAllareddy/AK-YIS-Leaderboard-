import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { getCurrentAdmin } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Admin Login" };

export default async function LoginPage() {
  if (await getCurrentAdmin()) redirect("/admin");
  return (
    <>
      <SiteHeader admin={null} />
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-navy-100 bg-card p-6 shadow-lg shadow-navy-900/5 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-growth-600 dark:text-growth-400">Officers only</p>
            <h1 className="mt-2 font-display text-2xl font-bold text-navy-900">Admin sign in</h1>
            <p className="mt-1 text-sm text-navy-500">Sign in to manage members and points.</p>
            <LoginForm />
          </div>
          <p className="mt-4 text-center text-sm text-navy-500">
            Looking for the rankings?{" "}
            <Link href="/" className="font-semibold text-growth-700 underline underline-offset-2 hover:text-growth-800">
              View the leaderboard
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
