"use client";

import { useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";

import { EditProfileForm } from "./edit-profile-form";

type Props = {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string;
  /** Tailwind class set for the role pill — varies by role tier so a
   *  super admin badge looks different from a player badge. */
  roleClasses: string;
  joinedAt: string | null;
};

/**
 * Profile hero card with built-in edit mode. Renders the avatar +
 * name + email + role badge by default; tapping "Edit profile"
 * swaps the body for the EditProfileForm. Server action revalidates
 * /me on save so the new values flow back into this card on the next
 * server render.
 */
export function ProfileCard({
  displayName,
  email,
  avatarUrl,
  roleLabel,
  roleClasses,
  joinedAt,
}: Props) {
  const [editing, setEditing] = useState(false);
  const initials = getInitials(displayName);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="size-16 shrink-0 rounded-full border border-foreground/10 object-cover"
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold capitalize">
                {displayName}
              </h1>
              <span
                className={
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                  roleClasses
                }
              >
                {roleLabel}
              </span>
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {email}
            </div>
            {joinedAt && (
              <div className="text-[11px] text-muted-foreground">
                Joined {joinedAt}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {editing ? (
          <EditProfileForm
            initial={{
              display_name: displayName,
              avatar_url: avatarUrl ?? "",
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            Edit profile
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
