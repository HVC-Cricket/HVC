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

  const onSaveA = () => {
    setSavedA(true);
    if (!savedB) {
      setActive("B");
    } else {
      router.back();
    }
  };
  const onSaveB = () => {
    setSavedB(true);
    if (!savedA) {
      setActive("A");
    } else {
      router.back();
    }
  };

  return (
    <div className="space-y-4">
      <nav
        role="tablist"
        className="flex overflow-x-auto rounded-lg border border-foreground/10 bg-muted/30 p-1"
      >
        <TabButton
          isActive={active === "A"}
          onClick={() => setActive("A")}
          label={teamA.shortName || teamA.name}
          subtitle={`${playingCountA} / ${playersPerSide}`}
          done={savedA}
        />
        <TabButton
          isActive={active === "B"}
          onClick={() => setActive("B")}
          label={teamB.shortName || teamB.name}
          subtitle={`${playingCountB} / ${playersPerSide}`}
          done={savedB}
        />
      </nav>

      <div role="tabpanel" hidden={active !== "A"}>
        <PickXIForm
          matchId={matchId}
          teamId={teamA.teamId}
          playersPerSide={playersPerSide}
          rows={teamA.rows}
          saveLabel={savedB ? "Save & done" : "Save & next team"}
          onSaveSuccess={onSaveA}
        />
      </div>
      <div role="tabpanel" hidden={active !== "B"}>
        <PickXIForm
          matchId={matchId}
          teamId={teamB.teamId}
          playersPerSide={playersPerSide}
          rows={teamB.rows}
          saveLabel={savedA ? "Save & done" : "Save & next team"}
          onSaveSuccess={onSaveB}
        />
      </div>
    </div>
  );
}

function TabButton({
  isActive,
  onClick,
  label,
  subtitle,
  done,
}: {
  isActive: boolean;
  onClick: () => void;
  label: string;
  subtitle: string;
  done: boolean;
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      onClick={onClick}
      className={
        "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition " +
        (isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      <span className="capitalize">{label}</span>
      <span
        className={
          "font-mono text-xs tabular-nums " +
          (done
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground")
        }
      >
        {subtitle}
        {done && " ✓"}
      </span>
    </button>
  );
}
