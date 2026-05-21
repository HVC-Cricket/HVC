import { Suspense } from "react";

import { RefreshButton } from "@/components/refresh-button";
import { Card, CardContent } from "@/components/ui/card";

import { CareerStats } from "./career-stats";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard — all-time HVC records",
  description:
    "All-time HVC leaderboards across every season — most runs, most wickets, best averages, biggest hits.",
};

export default function StatsPage() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              Career leaderboards across every HVC season. Combines historical
              CricHeroes data (S1–S6) with new tournaments scored in-app.
              Tap a category chip on the leaderboard to filter to Cat 1 /
              Cat 2 / Cat 3 players.
            </p>
          </div>
          <RefreshButton label="Refresh leaderboard" />
        </header>
        <Suspense fallback={<LeaderboardsSkeleton />}>
          <CareerStats />
        </Suspense>
      </div>
    </main>
  );
}

function LeaderboardsSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-4 animate-pulse rounded bg-muted"
            style={{ width: `${100 - i * 6}%` }}
          />
        ))}
      </CardContent>
    </Card>
  );
}
