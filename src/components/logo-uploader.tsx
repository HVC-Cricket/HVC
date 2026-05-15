"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

type Props = {
  bucket:
    | "tournament-logos"
    | "team-logos"
    | "player-photos"
    | "match-banners"
    | "user-avatars";
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  shape?: "square" | "circle";
  /**
   * Suggested folder prefix inside the bucket. Defaults to the user's id so
   * each user's uploads sit under their own folder. Files are still publicly
   * readable.
   */
  pathPrefix?: string;
};

/**
 * Reusable client-side image uploader. Pushes the file straight to Supabase
 * Storage from the browser using the anon key + RLS (insert policy on
 * storage.objects gates uploads to authenticated users), then calls
 * onChange with the resulting public URL. The caller stores the URL on the
 * entity via its existing form action.
 */
export function LogoUploader({
  bucket,
  value,
  onChange,
  disabled,
  shape = "square",
  pathPrefix,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(
        `Image too large (max ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB)`,
      );
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Sign in to upload images");
        return;
      }
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const folder = pathPrefix ?? user.id;
      const path = `${folder}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploadErr) {
        toast.error(uploadErr.message);
        return;
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
    } finally {
      setUploading(false);
    }
  };

  const previewClass =
    shape === "circle"
      ? "h-14 w-14 rounded-full border border-foreground/10 object-cover"
      : "h-14 w-14 rounded-md border border-foreground/10 object-cover";

  return (
    <div className="flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className={previewClass} />
      ) : (
        <div
          className={
            previewClass +
            " flex items-center justify-center bg-muted text-xs text-muted-foreground"
          }
        >
          —
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={onFile}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading}
        onClick={onPick}
      >
        {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
      </Button>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => onChange(null)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
