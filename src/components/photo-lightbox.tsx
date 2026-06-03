"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  src: string;
  /** Used as the caption beneath the image + alt + a11y label. */
  name: string;
  onClose: () => void;
};

/**
 * Full-screen image viewer used by `<PlayerPhoto>` + `<LogoPhoto>`.
 * Renders via createPortal into document.body so the overlay sits
 * above every page surface regardless of where the trigger lives
 * (sticky table cells, scrollable rows, transformed containers all
 * create stacking contexts that otherwise trap a fixed-positioned
 * div beneath siblings).
 *
 * Closes on ESC, click on the backdrop, and the X button.
 */
export function PhotoLightbox({ src, name, onClose }: Props) {
  const [mounted, setMounted] = useState(false);

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
