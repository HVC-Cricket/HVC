"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";

import { PhotoLightbox } from "@/components/photo-lightbox";

type Props = {
  /** Team / tournament logo URL. */
  imageUrl: string | null;
  /** Caption + a11y label. Used as the alt text on the image too. */
  name: string;
  /**
   * What to render when imageUrl is null. Team short_name (e.g. "WK"),
   * a Trophy / Users icon, a "—" dash — caller knows the context.
   * Wrapped in a centred flex container with the supplied className.
   */
  fallback: ReactNode;
  /**
   * Wrapper sizing + colour classes (e.g. "size-11 shrink-0 bg-muted
   * text-muted-foreground border border-foreground/10"). Applied to
   * both branches so layout stays identical regardless of which one
   * renders. Corner radius defaults to `rounded-lg`; pass `rounded-md`
   * or another override if needed.
   */
  className?: string;
};

/**
 * Square-ish logo element with a tap-to-zoom lightbox. Mirrors
 * <PlayerPhoto>'s behaviour but for team + tournament logos: square
 * with rounded corners (not full circles), and the fallback content
 * is whatever the caller passes — short-name text for teams, a
 * Trophy icon for tournaments, etc. The lightbox is the same one
 * <PlayerPhoto> uses, so spectators get a consistent zoom experience.
 *
 * Stop-propagation + preventDefault on the button lets the trigger
 * sit inside <Link>-wrapped cards without hijacking the row click.
 */
export function LogoPhoto({
  imageUrl,
  name,
  fallback,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);

  if (!imageUrl) {
    return (
      <div
        className={
          "flex items-center justify-center overflow-hidden rounded-lg " +
          className
        }
        aria-label={name}
      >
        {fallback}
      </div>
    );
  }

  // <span role="button"> instead of <button> — see the matching
  // explanation in <PlayerPhoto>. Logos almost always sit inside a
  // <Link>-wrapped card (Teams tab grid, tournament list cards,
  // past-tournaments grid), and <button> inside <a> is invalid
  // HTML5: in React 19 / Next 16 the anchor's default navigation
  // fires alongside the inner click handler, so opening the
  // lightbox also navigated to the link target in the background.
  // The triple stop (preventDefault + stopPropagation +
  // nativeEvent.stopImmediatePropagation) on a span suppresses
  // navigation reliably across browsers.
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
          "inline-flex cursor-pointer overflow-hidden rounded-lg transition hover:ring-2 hover:ring-primary " +
          className
        }
        aria-label={`View ${name}'s logo`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={name}
          className="size-full object-cover"
        />
      </span>
      {open && (
        <PhotoLightbox
          src={imageUrl}
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
