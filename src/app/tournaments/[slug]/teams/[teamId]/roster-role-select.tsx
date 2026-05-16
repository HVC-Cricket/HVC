"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { updateRosterRole } from "../actions";

type Role = "captain" | "vice_captain" | "wicket_keeper" | "player";

export function RosterRoleSelect({
  tournamentSlug,
  teamId,
  rosterId,
  initialRole,
  canChangeCaptaincy,
}: {
  tournamentSlug: string;
  teamId: string;
  rosterId: string;
  initialRole: Role;
  /** When false (the caller is a team admin, not organizer), the
   *  select is read-only on captain/vc rows and the captain/vc options
   *  are hidden so non-captaincy rows can't be promoted into them. */
  canChangeCaptaincy: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<Role>(initialRole);
  const isCaptaincyRow =
    initialRole === "captain" || initialRole === "vice_captain";
  const locked = !canChangeCaptaincy && isCaptaincyRow;
  // Captaincy options must render whenever the CURRENT row is
  // captain/vc — otherwise <Select> has nothing to render for the
  // value and the trigger shows blank. We still hide them when the
  // row is a regular player and the viewer can't change captaincy
  // (so a team admin can't promote anyone into captaincy).
  const showCaptaincyOptions = canChangeCaptaincy || isCaptaincyRow;

  return (
    <Select
      value={value}
      disabled={pending || locked}
      onValueChange={(v) => {
        const role = v as Role;
        setValue(role);
        startTransition(async () => {
          const result = await updateRosterRole({
            tournamentSlug,
            teamId,
            rosterId,
            role,
          });
          if (result && !result.ok) {
            toast.error(result.error);
            setValue(initialRole);
          }
        });
      }}
    >
      <SelectTrigger className="h-7 px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="player">Player</SelectItem>
        {showCaptaincyOptions && (
          <SelectItem value="captain">Captain</SelectItem>
        )}
        {showCaptaincyOptions && (
          <SelectItem value="vice_captain">Vice captain</SelectItem>
        )}
        <SelectItem value="wicket_keeper">Wicket-keeper</SelectItem>
      </SelectContent>
    </Select>
  );
}
