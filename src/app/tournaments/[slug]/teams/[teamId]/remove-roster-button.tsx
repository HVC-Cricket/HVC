"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { removePlayerFromTeam } from "../actions";

type Props = {
  tournamentSlug: string;
  teamId: string;
  rosterId: string;
};

export function RemoveRosterButton({ tournamentSlug, teamId, rosterId }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
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
