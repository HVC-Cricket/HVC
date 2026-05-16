"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { removeTeamAdmin } from "../actions";

type Props = {
  tournamentSlug: string;
  teamId: string;
  teamAdminId: string;
};

export function RemoveTeamAdminButton({
  tournamentSlug,
  teamId,
  teamAdminId,
}: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await removeTeamAdmin({
            tournamentSlug,
            teamId,
            teamAdminId,
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
