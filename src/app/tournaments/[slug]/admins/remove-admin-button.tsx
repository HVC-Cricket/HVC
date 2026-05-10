"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { ConfirmButton } from "@/components/confirm-button";

import { removeAdmin } from "./actions";

export function RemoveAdminButton({
  tournamentSlug,
  adminId,
}: {
  tournamentSlug: string;
  adminId: string;
}) {
  const [pending, startTransition] = useTransition();

  const onRemove = () => {
    startTransition(async () => {
      const result = await removeAdmin({ tournamentSlug, adminId });
      if (result && !result.ok) {
        toast.error(result.error);
      }
    });
  };

  return (
    <ConfirmButton
      title="Remove this admin?"
      description="They will lose tournament-management permissions immediately."
      confirmLabel="Remove"
      destructive
      onConfirm={onRemove}
      triggerProps={{
        type: "button",
        variant: "ghost",
        size: "sm",
        disabled: pending,
      }}
    >
      {pending ? "…" : "Remove"}
    </ConfirmButton>
  );
}
