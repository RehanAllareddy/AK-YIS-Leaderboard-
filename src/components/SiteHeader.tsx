import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import logo from "../../public/logo.png";
import logoOnDark from "../../public/logo-on-dark.png";
import { AuthNav } from "./AuthNav";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader({
  children,
  below,
  admin,
}: {
  children?: ReactNode;
  /** Content after the heading (e.g. stat cards); the grid band ends halfway down it. */
  below?: ReactNode;
  /** Pass when the page already knows the session (admin pages); otherwise the nav looks it up. */
  admin?: { username: string; displayName: string | null } | null;
}) {
  return (
    <header className="relative">
      {/* Chart-grid band. With `below` content it stops halfway down it, so
          those cards straddle its edge. */}
      <div aria-hidden="true" className={`chart-grid pointer-events-none absolute inset-x-0 top-0 bg-surface ${below ? "bottom-[76px]" : "bottom-0"}`} />
      <nav aria-label="Main" className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center rounded-lg">
          {/* Blue lettering on light backgrounds, white lettering on dark. */}
          <Image
            src={logo}
            alt="Young Investors Society — home"
            priority
            className="h-11 w-auto sm:h-14 dark:hidden"
            sizes="(min-width: 640px) 140px, 110px"
          />
          <Image
            src={logoOnDark}
            alt="Young Investors Society — home"
            priority
            className="hidden h-11 w-auto sm:h-14 dark:block"
            sizes="(min-width: 640px) 140px, 110px"
          />
        </Link>
        <div className="flex items-center gap-2">
          <AuthNav initialAdmin={admin} />
          <ThemeToggle />
        </div>
      </nav>
      {children && (
        <div className={`relative mx-auto max-w-6xl px-4 pt-2 sm:px-6 ${below ? "pb-6 sm:pb-8" : "pb-8 sm:pb-10"}`}>
          {children}
        </div>
      )}
      {/* pb-5 (20px) + half of a 112px (h-28) stat card = the band's 76px bottom offset. */}
      {below && <div className="relative mx-auto max-w-6xl px-4 pb-5 sm:px-6">{below}</div>}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-navy-100 bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-navy-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} AK Young Investors Society</p>
        <p>Points are updated by club officers.</p>
      </div>
    </footer>
  );
}
