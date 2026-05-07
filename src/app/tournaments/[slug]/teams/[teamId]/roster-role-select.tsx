"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { updateRosterRole } from "../actions";

type Role = "captain" | "vice_captain" | "wicket_keeper" | "player";

export function RosterRoleSelect({
  tournamentSlug,
  teamId,
  rosterId,
  initialRole,
}: {
  tournamentSlug: string;
  teamId: string;
  rosterId: string;
  initialRole: Role;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={initialRole}
      disabled={pending}
      onChange={(e) => {
        const role = e.target.value as Role;
        startTransition(async () => {
          const result = await updateRosterRole({
            tournamentSlug,
            teamId,
            rosterId,
            role,
          });
          if (result && !result.ok) {
            toast.error(result.error);
          }
        });
      }}
      className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
    >
      <option value="player">Player</option>
      <option value="captain">Captain</option>
      <option value="vice_captain">Vice captain</option>
      <option value="wicket_keeper">Wicket-keeper</option>
    </select>
  );
}
