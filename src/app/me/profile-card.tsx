"use client";

import { useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatEnumLabel } from "@/lib/format";
import { getInitials } from "@/lib/utils";

import { EditProfileForm, type PlayerFieldsInitial } from "./edit-profile-form";

type Props = {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string;
  /** Tailwind class set for the role pill — varies by role tier so a
   *  super admin badge looks different from a player badge. */
  roleClasses: string;
  joinedAt: string | null;
  /** When the user is linked to a player, these surface inline with the
   *  role badge / below the name so /me visually matches
   *  /players/[id]. */
  playerCategory?: number | null;
  playerBattingStyle?: string | null;
  playerBowlingStyle?: string | null;
  /** When provided, the edit form renders the player block. Phone
   *  is always editable inside that block; category/batting/bowling
   *  gate on `canEditAdminPlayerFields`. Server action re-verifies. */
  editablePlayerFields?: PlayerFieldsInitial | null;
  /** True when the viewer is a super-admin — exposes the admin-only
   *  player fields (category, batting, bowling) inside the player
   *  block. Phone shows up regardless. */
  canEditAdminPlayerFields?: boolean;
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
  playerCategory,
  playerBattingStyle,
  playerBowlingStyle,
  editablePlayerFields,
  canEditAdminPlayerFields = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const initials = getInitials(displayName);

  const styleParts = [playerBattingStyle, playerBowlingStyle]
    .filter((s): s is string => Boolean(s))
    .map(formatEnumLabel);
  const styleLine = styleParts.length > 0 ? styleParts.join(" · ") : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
        <div className="flex items-start gap-4">
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
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="break-words text-xl font-semibold capitalize leading-tight">
              {displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={
                  "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                  roleClasses
                }
              >
                {roleLabel}
              </span>
              {playerCategory && (
                <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-mono">
                  C{playerCategory}
                </span>
              )}
            </div>
            {styleLine && (
              <div className="text-xs capitalize text-muted-foreground">
                {styleLine}
              </div>
            )}
            <div className="truncate text-sm text-muted-foreground">
              {email}
            </div>
            {joinedAt && (
              <div className="text-[11px] text-muted-foreground">
                Joined {joinedAt}
              </div>
            )}
          </div>
          {!editing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-2 shrink-0"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      {editing && (
        <CardContent className="pt-4">
          <EditProfileForm
            initial={{
              display_name: displayName,
              avatar_url: avatarUrl ?? "",
            }}
            player={editablePlayerFields ?? null}
            canEditAdminFields={canEditAdminPlayerFields}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      )}
    </Card>
  );
}
