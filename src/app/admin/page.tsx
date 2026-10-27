import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentAdmin } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  const display = { username: admin.username, displayName: admin.displayName };
  return (
    <>
      <SiteHeader admin={display}>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-growth-600 dark:text-growth-300">Admin dashboard</p>
        <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
          Manage members &amp; points
        </h1>
        <p className="mt-1 text-navy-600">
          Signed in as <span className="font-semibold text-navy-900">{admin.displayName ?? admin.username}</span>
        </p>
      </SiteHeader>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-16 sm:px-6 sm:py-8">
        <AdminDashboard />
      </main>
    </>
  );
}
