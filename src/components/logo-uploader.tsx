"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Client-side compression using Canvas. Resizes to max 1200px and 80%
 * quality JPEG to keep storage lean while preserving visibility.
 */
async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        const MAX_DIM = 1200;
        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas compression failed"));
          },
          "image/jpeg",
          0.8,
        );
      };
      img.onerror = (e) => reject(e);
    };
    reader.onerror = (e) => reject(e);
  });
}

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

    setUploading(true);
    try {
      let fileToUpload: File | Blob = file;
      let ext = (file.name.split(".").pop() || "bin").toLowerCase();

      if (file.size > MAX_BYTES) {
        toast.info("Compressing large image...");
        try {
          fileToUpload = await compressImage(file);
          ext = "jpg"; // compressImage outputs image/jpeg
        } catch (err) {
          console.error("Compression failed:", err);
          toast.error("Failed to compress large image");
          return;
        }
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Sign in to upload images");
        return;
      }

      const folder = pathPrefix ?? user.id;
      const path = `${folder}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(path, fileToUpload, { cacheControl: "3600", upsert: false });
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
