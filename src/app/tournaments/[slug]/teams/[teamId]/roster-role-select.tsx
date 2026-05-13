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
}: {
  tournamentSlug: string;
  teamId: string;
  rosterId: string;
  initialRole: Role;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<Role>(initialRole);

  return (
    <Select
      value={value}
      disabled={pending}
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
        <SelectItem value="captain">Captain</SelectItem>
        <SelectItem value="vice_captain">Vice captain</SelectItem>
        <SelectItem value="wicket_keeper">Wicket-keeper</SelectItem>
      </SelectContent>
    </Select>
  );
}
