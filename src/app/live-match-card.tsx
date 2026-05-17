import Link from "next/link";

import { getTeamInitials } from "@/lib/utils";

import type { InningsScore, LiveMatchView, TeamView } from "./home-types";

export function LiveMatchCard({ match }: { match: LiveMatchView }) {
  // Active innings is the one whose batting team is currently batting.
  // Innings break: innings 2 hasn't started yet but we have a target.
  const currentInnings =
    match.innings2 ?? match.innings1 ?? null;
  const battingTeamId = currentInnings?.batting_team_id ?? null;

  const target =
    match.innings1 && !match.innings2
      ? match.innings1.runs + 1
      : (match.innings2?.target ?? null);

  // Chase context — only when innings 2 is in progress.
  let chaseLine: string | null = null;
  if (match.innings2 && target !== null) {
    const runsNeeded = target - match.innings2.runs;
    const ballsLeft = match.oversPerInnings * 6 - match.innings2.legal_balls;
    if (runsNeeded > 0 && ballsLeft > 0) {
      chaseLine = `Need ${runsNeeded} off ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"}`;
    }
  } else if (match.status === "innings_break" && target !== null) {
    chaseLine = `Chase: ${target} to win in ${match.oversPerInnings} overs`;
  }

  return (
    <Link
      href={`/matches/${match.id}`}
      prefetch
      className="group flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm transition hover:border-primary/40 hover:shadow-md"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 border-b border-foreground/5 bg-emerald-500/5 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            {match.status === "live" ? "Live" : "Innings break"}
          </span>
        </div>
        <span className="truncate text-[11px] capitalize text-muted-foreground">
          {match.tournament.name} · #{match.matchNumber}
        </span>
      </div>

      {/* Team rows */}
      <div className="space-y-2 px-3 py-3">
        <TeamLine
          team={match.teamA}
          innings={
            match.innings1?.batting_team_id === match.teamA.id
              ? match.innings1
              : match.innings2?.batting_team_id === match.teamA.id
                ? match.innings2
                : null
          }
          isCurrentBatting={battingTeamId === match.teamA.id}
        />
        <TeamLine
          team={match.teamB}
          innings={
            match.innings1?.batting_team_id === match.teamB.id
              ? match.innings1
              : match.innings2?.batting_team_id === match.teamB.id
                ? match.innings2
                : null
          }
          isCurrentBatting={battingTeamId === match.teamB.id}
        />
      </div>

      {/* Chase context */}
      {chaseLine && (
        <div className="border-t border-foreground/5 bg-muted/30 px-3 py-1.5 text-center text-[11px] font-medium text-foreground">
          {chaseLine}
        </div>
      )}

      {/* CTA — primary brand colour, matches every other primary button. */}
      <div className="bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground transition group-hover:bg-primary/90">
        Watch live →
      </div>
    </Link>
  );
}

function TeamLine({
  team,
  innings,
  isCurrentBatting,
}: {
  team: TeamView;
  innings: InningsScore | null;
  isCurrentBatting: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 " +
        (isCurrentBatting ? "" : "opacity-70")
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={team.logo_url}
            alt=""
            width={32}
            height={32}
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
            {getTeamInitials(team.short_name)}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium capitalize leading-tight">
            {team.name}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {team.short_name}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        {innings ? (
          <>
            <div className="font-mono text-xl font-semibold leading-none">
              {innings.runs}
              <span className="text-foreground/40">/</span>
              {innings.wickets}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {innings.overs} ov
            </div>
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            yet to bat
          </div>
        )}
      </div>
    </div>
  );
}
