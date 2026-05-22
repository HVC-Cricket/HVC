"use client";

import { useState, type SyntheticEvent } from "react";

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

  // Rendered as <span role="button"> rather than a real <button>
  // because PlayerPhoto frequently sits inside a <Link> wrapper
  // (leaderboard rows, players list, etc.). <button> inside <a> is
  // invalid HTML5, and the resulting browser/React-19 behaviour
  // sometimes lets the anchor's default navigation fire alongside
  // the photo's own onClick — so opening the lightbox also pushed
  // the user to the player profile in the background. A <span> is
  // valid inside <a>, and the triple stop (preventDefault +
  // stopPropagation + nativeEvent.stopImmediatePropagation) is
  // enough to suppress the navigation reliably.
  const handleOpen = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.nativeEvent.stopImmediatePropagation === "function") {
      e.nativeEvent.stopImmediatePropagation();
    }
    setOpen(true);
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleOpen(e);
        }}
        className={
          "inline-flex cursor-pointer overflow-hidden rounded-full transition hover:ring-2 hover:ring-primary " +
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
      </span>
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
