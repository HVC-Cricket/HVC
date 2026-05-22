"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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

function PhotoLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  // Lock body scroll + handle ESC while the lightbox is open. Same
  // pattern as SiteNavDrawer so behaviour stays consistent across
  // the app's modal surfaces. setMounted gates the portal render so
  // SSR doesn't see a portal target (document.body is browser-only).
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Render into document.body via a portal so the lightbox isn't
  // constrained by any local stacking context. Without this, the
  // overlay gets trapped inside the parent of <PlayerPhoto> (e.g.
  // a sticky <td> in the leaderboard table that itself creates a
  // z-index context), and surrounding sticky cells render OVER it.
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name} photo`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
      >
        <X className="size-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="pointer-events-none absolute bottom-6 left-0 right-0 px-4 text-center text-sm font-medium text-white/90">
        {name}
      </div>
    </div>,
    document.body,
  );
}
