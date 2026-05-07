"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { removeAdmin } from "./actions";

export function RemoveAdminButton({
  tournamentSlug,
  adminId,
}: {
  tournamentSlug: string;
  adminId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Remove this admin?")) return;
        startTransition(async () => {
          const result = await removeAdmin({ tournamentSlug, adminId });
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
