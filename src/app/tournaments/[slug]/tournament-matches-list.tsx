"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MATCH_STATUS_CLASSES,
  MATCH_STATUS_LABEL,
  type MatchStage,
  type MatchStatus,
} from "@/lib/constants/match";
import { type TournamentFormat } from "@/lib/constants/tournament";
import { formatEnumLabel, formatMatchTime } from "@/lib/format";
import { cn, getTeamInitials } from "@/lib/utils";

export type TeamLite = {
  id: string;
  name: string;
  short_name: string;
  logo_url: string | null;
};

export type MatchRow = {
  id: string;
  match_number: number;
  stage: string;
  status: string;
  scheduled_at: string | null;
  team_a_id: string;
  team_b_id: string;
  winner_id: string | null;
  win_margin: string | null;
  result_type: string | null;
  umpire_1: string | null;
  umpire_2: string | null;
  scorer: string | null;
};

/** Three coarse status buckets the spectator cares about, plus "all". */
type StatusBucket = "all" | "live" | "upcoming" | "completed";

/** Coarse bucket each `matches.status` value rolls up into. `innings_break`
 *  reads as "Live" to a spectator (the match is in progress); `abandoned`
 *  is a terminal state alongside `completed`. */
function bucketFor(status: string): Exclude<StatusBucket, "all"> | null {
  switch (status as MatchStatus) {
    case "live":
    case "innings_break":
      return "live";
    case "scheduled":
      return "upcoming";
    case "completed":
    case "abandoned":
      return "completed";
    default:
      return null;
  }
}

type Props = {
  tournamentSlug: string;
  tournamentFormat: TournamentFormat;
  matches: MatchRow[];
  teams: TeamLite[];
  canManage: boolean;
  /** IDs of the signed-in user's teams *in this tournament*. The team
   *  dropdown defaults to this team when there's exactly one (saves the
   *  player a tap on the most common landing). Empty array or 2+ entries
   *  → dropdown defaults to "All teams". */
  myTeamIds: string[];
};

export function TournamentMatchesList({
  tournamentSlug,
  tournamentFormat,
  matches,
  teams,
  canManage,
  myTeamIds,
}: Props) {
  const teamLookup = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );

  // Default team filter = "all". Earlier this defaulted to the user's
  // own team when they had exactly one in this tournament; flipped to
  // "all" so first-time visitors see the full slate (and the user's
  // team is still tagged "(my team)" in the dropdown for a one-tap
  // self-filter).
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusBucket>("all");

  // Counts per status bucket, scoped to the *currently selected team*,
  // so the chip labels reflect what'll actually appear when you tap
  // them. Re-clicking the active chip clears (back to "all").
  const counts = useMemo(() => {
    const c = { all: 0, live: 0, upcoming: 0, completed: 0 };
    for (const m of matches) {
      if (teamFilter !== "all") {
        if (m.team_a_id !== teamFilter && m.team_b_id !== teamFilter)
          continue;
      }
      c.all += 1;
      const b = bucketFor(m.status);
      if (b) c[b] += 1;
    }
    return c;
  }, [matches, teamFilter]);

  const visibleMatches = useMemo(() => {
    return matches.filter((m) => {
      if (teamFilter !== "all") {
        if (m.team_a_id !== teamFilter && m.team_b_id !== teamFilter)
          return false;
      }
      if (statusFilter !== "all" && bucketFor(m.status) !== statusFilter)
        return false;
      return true;
    });
  }, [matches, teamFilter, statusFilter]);

  const anyFilterActive = teamFilter !== "all" || statusFilter !== "all";
  const selectedTeam =
    teamFilter !== "all" ? teamLookup.get(teamFilter) : null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Matches</h2>
        {canManage && (
          <Link
            href={`/tournaments/${tournamentSlug}/matches/new`}
            prefetch
          >
            <Button size="sm">New match</Button>
          </Link>
        )}
      </div>

      {matches.length > 0 && teams.length > 0 && (
        <div className="space-y-2">
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            {/* Radix's <SelectValue/> derives its display text by
                walking up to the matching <SelectItem/>, but the
                <SelectContent/> is portaled and lazy-mounted — until
                the user opens the dropdown for the first time, the
                item children aren't in the DOM and the trigger
                intermittently shows the placeholder instead of the
                selected label ("Filter by team…" with nothing
                selected-looking). Pass explicit children to
                <SelectValue/> derived from state so the displayed
                label is correct from first render. */}
            <SelectTrigger className="capitalize">
              <SelectValue placeholder="Filter by team…">
                {teamFilter === "all"
                  ? "All teams"
                  : (() => {
                      const t = teamLookup.get(teamFilter);
                      if (!t) return "Filter by team…";
                      return `${displayTeamName(t.name)}${
                        myTeamIds.includes(t.id) ? " (my team)" : ""
                      }`;
                    })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id} className="capitalize">
                  {displayTeamName(t.name)}
                  {myTeamIds.includes(t.id) ? " (my team)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex flex-wrap gap-1.5">
            <StatusChip
              label="All"
              count={counts.all}
              active={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            />
            <StatusChip
              label="Live"
              count={counts.live}
              active={statusFilter === "live"}
              tone="live"
              onClick={() =>
                setStatusFilter(statusFilter === "live" ? "all" : "live")
              }
            />
            <StatusChip
              label="Upcoming"
              count={counts.upcoming}
              active={statusFilter === "upcoming"}
              onClick={() =>
                setStatusFilter(
                  statusFilter === "upcoming" ? "all" : "upcoming",
                )
              }
            />
            <StatusChip
              label="Completed"
              count={counts.completed}
              active={statusFilter === "completed"}
              tone="completed"
              onClick={() =>
                setStatusFilter(
                  statusFilter === "completed" ? "all" : "completed",
                )
              }
            />
          </div>
        </div>
      )}

      {matches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No matches scheduled yet
            {canManage
              ? ". Add the first one with the button above."
              : "."}
          </CardContent>
        </Card>
      ) : visibleMatches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {selectedTeam ? (
              <>
                No {statusFilter === "all" ? "" : `${statusFilter} `}
                matches for{" "}
                <span className="font-medium text-foreground">
                  {displayTeamName(selectedTeam.name)}
                </span>
                .
              </>
            ) : (
              <>No {statusFilter} matches in this tournament.</>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleMatches.map((m) => {
            const a = teamLookup.get(m.team_a_id);
            const b = teamLookup.get(m.team_b_id);
            const ms = m.status as MatchStatus;
            const winner = m.winner_id ? teamLookup.get(m.winner_id) : null;
            const resultLine =
              ms === "completed"
                ? winner && m.win_margin
                  ? `${displayTeamName(winner.name)} ${m.win_margin}`
                  : m.result_type === "tie"
                    ? "Match tied"
                    : m.result_type === "no_result"
                      ? "No result"
                      : null
                : null;
            return (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                prefetch
                className="group block rounded-lg border border-foreground/10 bg-background p-3 transition hover:border-foreground/25 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-xs font-medium text-foreground/80">
                    {m.scheduled_at
                      ? formatMatchTime(m.scheduled_at)
                      : "Time TBD"}
                  </div>
                  <span
                    className={
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                      MATCH_STATUS_CLASSES[ms]
                    }
                  >
                    {ms === "live" && (
                      <span className="relative flex size-1.5">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                      </span>
                    )}
                    {MATCH_STATUS_LABEL[ms]}
                  </span>
                </div>
                <div className="mt-1 truncate text-[11px] capitalize text-muted-foreground">
                  #{m.match_number}
                  <span className="px-1 text-foreground/20">·</span>
                  {formatEnumLabel(m.stage)}
                </div>
                <div className="mt-2 space-y-1.5">
                  <TeamRow team={a} />
                  <TeamRow team={b} />
                </div>
                {(m.umpire_1 || m.umpire_2) && (
                  <div className="mt-2 truncate text-[11px] capitalize text-muted-foreground">
                    Umpires:{" "}
                    {[m.umpire_1, m.umpire_2].filter(Boolean).join(", ")}
                  </div>
                )}
                {m.scorer && (
                  <div className="mt-0.5 truncate text-[11px] capitalize text-muted-foreground">
                    Scorer: {m.scorer}
                  </div>
                )}
                {resultLine && (
                  <div className="mt-2 truncate text-xs font-medium capitalize text-primary">
                    {resultLine}
                  </div>
                )}
              </Link>
            );
          })}
          {/* Playoff TBC placeholders only make sense for the full
              unfiltered bracket — once the user has scoped to a team or
              a status the TBC rows are noise (no team identity, no real
              status). */}
          {!anyFilterActive && (
            <PlayoffPlaceholders
              format={tournamentFormat}
              matches={matches}
            />
          )}
        </div>
      )}
    </section>
  );
}

function displayTeamName(name: string): string {
  return name.replace(/^team\s+/i, "");
}

function TeamRow({ team }: { team?: TeamLite }) {
  if (!team)
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        ?
      </div>
    );
  const label = displayTeamName(team.name);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-6 shrink-0 rounded-full border border-foreground/10 object-cover"
        />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
          {getTeamInitials(team.short_name)}
        </span>
      )}
      <span
        className="truncate text-sm font-medium capitalize"
        title={team.name}
      >
        {label}
      </span>
    </div>
  );
}

function PlayoffPlaceholders({
  format,
  matches,
}: {
  format: TournamentFormat;
  matches: { match_number: number; stage: string; status: string }[];
}) {
  if (format !== "round_robin_playoff_final") return null;
  const groupMatches = matches.filter((m) => m.stage === "group");
  if (groupMatches.length === 0) return null;
  const allGroupDone = groupMatches.every((m) => m.status === "completed");
  if (allGroupDone) return null;

  const lastNumber = matches.reduce(
    (max, m) => (m.match_number > max ? m.match_number : max),
    0,
  );
  const stages: { stage: MatchStage; label: string }[] = [
    { stage: "qualifier_1", label: "Qualifier 1" },
    { stage: "eliminator", label: "Eliminator" },
    { stage: "qualifier_2", label: "Qualifier 2" },
    { stage: "final", label: "Final" },
  ];

  return (
    <>
      {stages.map((s, i) => {
        const num = lastNumber + i + 1;
        return (
          <div
            key={s.stage}
            className="block rounded-lg border border-dashed border-foreground/15 bg-muted/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-xs font-medium text-foreground/80">
                Time TBD
              </div>
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground">
              #{num}
              <span className="px-1 text-foreground/20">·</span>
              {s.label}
            </div>
            <div className="mt-2 space-y-1.5">
              <TbcRow />
              <TbcRow />
            </div>
          </div>
        );
      })}
    </>
  );
}

function TbcRow() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-semibold uppercase text-muted-foreground">
        TBC
      </span>
      <span className="truncate text-sm font-medium text-muted-foreground">
        TBC
      </span>
    </div>
  );
}

function StatusChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** Colour accent when active — keeps the chip tonally matched to the
   *  per-row status pill (emerald for Live, blue for Completed). */
  tone?: "live" | "completed";
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      className={cn(
        "h-8 gap-1.5 px-2.5 text-xs",
        active && tone === "live" &&
          "bg-emerald-500 text-white hover:bg-emerald-500/90",
        active && tone === "completed" &&
          "bg-blue-500 text-white hover:bg-blue-500/90",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded font-mono text-[10px] tabular-nums",
          active ? "text-white/80" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </Button>
  );
}
