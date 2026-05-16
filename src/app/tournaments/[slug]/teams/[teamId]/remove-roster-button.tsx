"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { removePlayerFromTeam } from "../actions";

type Props = {
  tournamentSlug: string;
  teamId: string;
  rosterId: string;
  /** Caller is a team admin (not organizer) trying to remove a
   *  captain/vc row — disabled, since that'd strip the other person's
   *  team-admin grant via the trigger. */
  disabled?: boolean;
  disabledTitle?: string;
};

export function RemoveRosterButton({
  tournamentSlug,
  teamId,
  rosterId,
  disabled,
  disabledTitle,
}: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending || !!disabled}
      title={disabled ? disabledTitle : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await removePlayerFromTeam({
            tournamentSlug,
            teamId,
            rosterId,
          });
          if (result && !result.ok) {
            toast.error(result.error);
          }
        });
      }}
    >
      {pending ? "…" : "Remove"}
    </Button>
  );
}
