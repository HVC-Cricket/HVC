"use client";

import {
  Download,
  ExternalLink,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  matchId: string;
  matchNumber: number | null;
  teamAShort: string;
  teamBShort: string;
};

type LoadState = "loading" | "ready" | "error";

// Cycled through the loader overlay so the user has something to read
// while satori is rendering the PNG (typically 1–3s on a cold cache).
const LOADER_MESSAGES = [
  "Picking the top batter…",
  "Counting boundaries…",
  "Tallying wickets…",
  "Polishing the trophy…",
  "Rendering your card…",
];

export function HighlightDialog({
  matchId,
  matchNumber,
  teamAShort,
  teamBShort,
}: Props) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Cache-bust the preview each time the dialog opens so the user
  // always sees the latest render after a fresh score edit.
  const [version, setVersion] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [messageIndex, setMessageIndex] = useState(0);

  const src = `/api/og/match/${matchId}?v=${version}`;
  const filenameParts = [
    "hvc",
    matchNumber ? `match-${matchNumber}` : null,
    teamAShort && teamBShort
      ? `${teamAShort.toLowerCase()}-vs-${teamBShort.toLowerCase()}`
      : null,
    "highlight",
  ].filter(Boolean);
  const filename = `${filenameParts.join("-")}.png`;

  // Rotate the loader copy every 900ms while we're waiting on the PNG.
  // Stops as soon as the image lands or errors out, and resets on each
  // fresh open so the user always sees the messages in order.
  useEffect(() => {
    if (loadState !== "loading") return;
    const id = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADER_MESSAGES.length);
    }, 900);
    return () => clearInterval(id);
  }, [loadState]);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[highlight] download failed", err);
      // Fallback: just open the PNG in a new tab so the user can
      // right-click → save manually.
      window.open(src, "_blank", "noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  const canDownload = loadState === "ready" && !downloading;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setVersion((v) => v + 1);
          setLoadState("loading");
          setMessageIndex(0);
        }
      }}
    >
      <DialogTrigger
        render={(props) => (
          <Button {...props} type="button" variant="ghost" size="sm">
            <Sparkles className="mr-1.5 size-4" />
            Highlight
          </Button>
        )}
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Match highlight</DialogTitle>
          <DialogDescription>
            Share this card on socials, or save it to your device.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border bg-[#0b1730]">
          {/* 1200×630 aspect ratio container — the OG route returns
              exactly those dimensions, so we lock the box and let the
              image fill it. */}
          <div
            className="relative w-full"
            style={{ aspectRatio: "1200 / 630" }}
          >
            {/* The img lives in the DOM from the start so the browser
                kicks off the request immediately; we just fade it in
                once `onLoad` fires. The overlay sits above it until
                then. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Match highlight"
              onLoad={() => setLoadState("ready")}
              onError={() => setLoadState("error")}
              className={
                "absolute inset-0 size-full object-contain transition-opacity duration-300 " +
                (loadState === "ready" ? "opacity-100" : "opacity-0")
              }
            />

            {loadState === "loading" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b1730] text-slate-200">
                {/* Animated sparkles + spinner pair — matches the
                    highlight card's blue/gold accent palette so the
                    loader doesn't feel disconnected from the artwork
                    that's about to appear. */}
                <div className="relative flex size-12 items-center justify-center">
                  <span className="absolute size-12 animate-ping rounded-full bg-blue-500/30" />
                  <Sparkles className="relative size-6 text-blue-300" />
                </div>
                <div className="flex flex-col items-center gap-1 px-6 text-center">
                  <p className="text-sm font-semibold tracking-wide">
                    Generating highlight…
                  </p>
                  <p className="text-xs text-slate-400">
                    {LOADER_MESSAGES[messageIndex]}
                  </p>
                </div>
              </div>
            )}

            {loadState === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b1730] px-6 text-center text-slate-200">
                <TriangleAlert className="size-6 text-amber-400" />
                <p className="text-sm font-semibold">Couldn&apos;t render the highlight</p>
                <p className="text-xs text-slate-400">
                  Close the dialog and try again, or open the raw URL in a new tab.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="sm:order-1"
          >
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              <ExternalLink className="mr-1.5 size-4" />
              Open in new tab
            </Button>
          </a>
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={!canDownload}
            className="sm:order-2"
          >
            {downloading ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 size-4" />
            )}
            {downloading
              ? "Preparing…"
              : loadState === "loading"
                ? "Generating…"
                : "Download PNG"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
