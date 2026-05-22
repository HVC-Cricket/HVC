"use client";

import { useState } from "react";

import { PhotoLightbox } from "@/components/photo-lightbox";
import { getInitials } from "@/lib/utils";

type Props = {
  /** Resolved photo URL (player_photo OR linked user's profile.avatar_url). */
  photoUrl: string | null;
  /** Used for initials fallback and the lightbox caption + a11y. */
  name: string;
  /**
   * Sizing + border classes for the wrapper (e.g. "size-9 shrink-0
   * border border-foreground/10"). Applied to both the photo
   * variant's button + the initials fallback span so the layout
   * stays identical regardless of which branch renders.
   */
  className?: string;
  /**
   * Extra classes for the initials text (e.g. "text-xs",
   * "text-[10px]"). The default colour is primary-on-tinted, which
   * matches every site that adopted the helper.
   */
  initialsClassName?: string;
};

/**
 * Shared player-avatar element. Renders the photo when present, an
 * initials chip otherwise — and when there IS a photo, tapping it
 * opens a full-screen lightbox so spectators can see the face
 * clearly. The lightbox needs no auth gate; Supabase Storage
 * buckets are public.
 *
 * Designed to slot directly into Link wrappers (leaderboard rows,
 * players list) without triggering the underlying navigation: the
 * button stops propagation + prevents default, so clicking the
 * photo zooms but clicking around it still routes through.
 */
export function PlayerPhoto({
  photoUrl,
  name,
  className = "",
  initialsClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);

  if (!photoUrl) {
    return (
      <span
        className={
          "flex items-center justify-center rounded-full bg-primary/10 font-semibold text-primary " +
          className +
          " " +
          initialsClassName
        }
        aria-label={name}
      >
        {getInitials(name)}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          "overflow-hidden rounded-full transition hover:ring-2 hover:ring-primary " +
          className
        }
        aria-label={`View ${name}'s photo`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={name}
          className="size-full object-cover"
        />
      </button>
      {open && (
        <PhotoLightbox
          src={photoUrl}
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
