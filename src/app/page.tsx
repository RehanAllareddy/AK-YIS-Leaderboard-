import { Leaderboard, LeaderboardStats } from "@/components/leaderboard/Leaderboard";
import { LeaderboardProvider } from "@/components/leaderboard/LeaderboardProvider";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { APP_SUBTITLE, APP_TITLE } from "@/lib/constants";

export default function HomePage() {
  return (
    <LeaderboardProvider>
      <SiteHeader below={<LeaderboardStats />}>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-growth-600 dark:text-growth-300 sm:text-sm">Official club standings</p>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-navy-900 sm:text-5xl">
            {APP_TITLE}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-navy-600 sm:text-lg">{APP_SUBTITLE}</p>
        </div>
      </SiteHeader>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
        <Leaderboard />
      </main>
      <SiteFooter />
    </LeaderboardProvider>
  );
}
