"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PickXIForm } from "./[teamId]/pick-xi-form";

type Row = {
  player_id: string;
  display_name: string;
  roster_role: string;
  included: boolean;
  batting_order: number | null;
  is_captain: boolean;
  is_keeper: boolean;
  is_substitute: boolean;
};

type TeamPickProps = {
  teamId: string;
  name: string;
  shortName: string;
  rows: Row[];
};

/**
 * Two-tab Pick XI picker — replaces the old per-team flow where the
 * scorer had to navigate Team A → save → back → Team B → save → back
 * (four nav events for one setup task). Now: one page, two tabs with
 * progress badges, "Save & next team" hops to tab B, "Save & done"
 * drops them back wherever they came from.
 *
 * State is independent per tab (each PickXIForm owns its rows), and
 * each tab has its own save action — the user can save in either
 * order or jump between tabs mid-edit without losing the other.
 */
export function PickXITabs({
  matchId,
  playersPerSide,
  teamA,
  teamB,
}: {
  matchId: string;
  playersPerSide: number;
  teamA: TeamPickProps;
  teamB: TeamPickProps;
}) {
  const router = useRouter();
  const [active, setActive] = useState<"A" | "B">("A");
  // Tracks which team has had its XI saved this session — drives the
  // green progress badge on the tab buttons. (Lock-state and saved
  // counts come from `rows.filter(r => r.included && !r.is_substitute)`,
  // but that lives inside the form's state; we just need a coarse
  // "have I clicked save?" signal.)
  const [savedA, setSavedA] = useState(false);
  const [savedB, setSavedB] = useState(false);

  // Initial "playing" count derived from the rows the server passed in.
  // Updates only on save (cheap; the in-form count already shows the
  // live tally for the active tab).
  const playingCountA = teamA.rows.filter(
    (r) => r.included && !r.is_substitute,
  ).length;
  const playingCountB = teamB.rows.filter(
    (r) => r.included && !r.is_substitute,
  ).length;

  // "Other team is done" — either already saved this session OR loaded
  // in already at the full XI count (edit flow where both XIs were
  // picked in a previous session). Drives both the save-button label
  // ("Save & next team" vs "Save & done") and the post-save action
  // (auto-switch to the other tab vs. drop the scorer back).
  const teamAComplete = savedA || playingCountA === playersPerSide;
  const teamBComplete = savedB || playingCountB === playersPerSide;

  const onSaveA = () => {
    setSavedA(true);
    if (teamBComplete) {
      router.back();
    } else {
      setActive("B");
    }
  };
  const onSaveB = () => {
    setSavedB(true);
    if (teamAComplete) {
      router.back();
    } else {
      setActive("A");
    }
  };

  return (
    <div className="space-y-4">
      {/* Underline-style tabs matching MatchTabs — each tab is full
          name on top, progress badge below, with the active one
          carrying a primary-coloured bottom border. Reads more like
          a tab strip than a segmented pill, and gives both team
          names room without truncating to just the short_name. */}
      <nav
        role="tablist"
        className="-mx-4 flex border-b border-foreground/10 sm:mx-0"
      >
        <TabButton
          isActive={active === "A"}
          onClick={() => setActive("A")}
          fullName={teamA.name}
          shortName={teamA.shortName}
          playing={playingCountA}
          target={playersPerSide}
          done={savedA}
        />
        <TabButton
          isActive={active === "B"}
          onClick={() => setActive("B")}
          fullName={teamB.name}
          shortName={teamB.shortName}
          playing={playingCountB}
          target={playersPerSide}
          done={savedB}
        />
      </nav>

      <div role="tabpanel" hidden={active !== "A"}>
        <PickXIForm
          matchId={matchId}
          teamId={teamA.teamId}
          playersPerSide={playersPerSide}
          rows={teamA.rows}
          saveLabel={teamBComplete ? "Save & done" : "Save & next team"}
          onSaveSuccess={onSaveA}
        />
      </div>
      <div role="tabpanel" hidden={active !== "B"}>
        <PickXIForm
          matchId={matchId}
          teamId={teamB.teamId}
          playersPerSide={playersPerSide}
          rows={teamB.rows}
          saveLabel={teamAComplete ? "Save & done" : "Save & next team"}
          onSaveSuccess={onSaveB}
        />
      </div>
    </div>
  );
}

function TabButton({
  isActive,
  onClick,
  fullName,
  shortName,
  playing,
  target,
  done,
}: {
  isActive: boolean;
  onClick: () => void;
  fullName: string;
  shortName: string;
  playing: number;
  target: number;
  done: boolean;
}) {
  const complete = playing === target;
  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      onClick={onClick}
      className={
        "-mb-px flex flex-1 flex-col items-center gap-0.5 border-b-2 px-3 py-3 transition " +
        (isActive
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground")
      }
    >
      <span className="truncate text-sm font-medium capitalize">
        {fullName}
      </span>
      <span
        className={
          "font-mono text-[11px] tabular-nums " +
          (done || complete
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground")
        }
      >
        {shortName} · {playing} / {target}
        {done ? " ✓" : ""}
      </span>
    </button>
  );
}
