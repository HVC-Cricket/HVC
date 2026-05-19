"use client";

import { Download, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setVersion((v) => v + 1);
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

        <div className="overflow-hidden rounded-lg border bg-muted/40">
          {/* 1200×630 aspect ratio container — the OG route returns
              exactly those dimensions, so we lock the box and let the
              image fill it. */}
          <div
            className="relative w-full"
            style={{ aspectRatio: "1200 / 630" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Match highlight"
              className="absolute inset-0 size-full object-contain"
            />
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
            disabled={downloading}
            className="sm:order-2"
          >
            {downloading ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 size-4" />
            )}
            {downloading ? "Preparing…" : "Download PNG"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
