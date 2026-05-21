"use client";

import { HardDrive, Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRouter } from "next/navigation";

import { RefreshButton } from "@/components/refresh-button";

import { deleteOrphanStorageObjects } from "./actions";
import type { BucketReport } from "./storage-loader";

type Props = {
  reports: BucketReport[];
};

export function StorageSection({ reports }: Props) {
  const totals = reports.reduce(
    (acc, r) => ({
      objects: acc.objects + r.totalObjects,
      bytes: acc.bytes + r.totalBytes,
      orphans: acc.orphans + r.orphans.length,
    }),
    { objects: 0, bytes: 0, orphans: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="size-4 text-muted-foreground" />
          Storage
          <span className="ml-auto text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
            {totals.objects} obj · {formatBytes(totals.bytes)} ·{" "}
            {totals.orphans} orphan
            {totals.orphans === 1 ? "" : "s"}
          </span>
          <RefreshButton label="Refresh storage" />
        </CardTitle>
        <CardDescription>
          One section per Supabase Storage bucket the app uploads to.
          &quot;Orphan&quot; = an object the corresponding DB column
          (e.g. <code>players.photo_url</code>) doesn&apos;t reference
          — usually a leftover from a replaced photo. Deletion is
          re-verified server-side so a stale list can&apos;t nuke a live
          file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-0 sm:px-6">
        {reports.map((r) => (
          <BucketCard key={r.bucket} report={r} />
        ))}
      </CardContent>
    </Card>
  );
}

function BucketCard({ report }: { report: BucketReport }) {
  return (
    <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{report.label}</div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {report.bucket}
          </div>
        </div>
        <div className="text-right font-mono text-[11px] text-muted-foreground">
          <div>
            {report.totalObjects} object
            {report.totalObjects === 1 ? "" : "s"} ·{" "}
            {formatBytes(report.totalBytes)}
          </div>
          {report.orphans.length > 0 && (
            <div className="text-amber-700 dark:text-amber-300">
              {report.orphans.length} orphan
              {report.orphans.length === 1 ? "" : "s"} ·{" "}
              {formatBytes(
                report.orphans.reduce((a, o) => a + o.size, 0),
              )}
            </div>
          )}
        </div>
      </div>
      {report.orphans.length > 0 && (
        <OrphanList report={report} />
      )}
    </div>
  );
}

function OrphanList({ report }: { report: BucketReport }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    setOpen(false);
    startTransition(async () => {
      const res = await deleteOrphanStorageObjects({
        bucket: report.bucket,
        paths: report.orphans.map((o) => o.path),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Deleted ${res.data.deleted} orphan${res.data.deleted === 1 ? "" : "s"} from ${report.label}`,
      );
      router.refresh();
    });
  };

  return (
    <>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Show orphan paths ({report.orphans.length})
        </summary>
        <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-md border border-foreground/10 bg-background p-2 font-mono text-[10px]">
          {report.orphans.map((o) => (
            <li key={o.path} className="flex items-center gap-2">
              <a
                href={publicUrl(report.bucket, o.path)}
                target="_blank"
                rel="noreferrer"
                className="block size-8 shrink-0 overflow-hidden rounded border border-foreground/10 bg-muted/40"
                title="Open file in new tab"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicUrl(report.bucket, o.path)}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </a>
              <span className="truncate">{o.path}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {formatBytes(o.size)}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {pending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 size-3.5" />
            )}
            {pending ? "Deleting…" : `Delete all ${report.orphans.length} orphans`}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {report.orphans.length} orphan
              {report.orphans.length === 1 ? "" : "s"} from {report.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The files will be removed from the bucket permanently.
              The server re-verifies each path is still orphan before
              deleting, so files that were re-attached just now are
              safe. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete orphans
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function publicUrl(bucket: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
