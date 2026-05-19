/**
 * Theme tokens shared by the four icon route handlers (`icon.tsx`,
 * `icon1.tsx`, `icon2.tsx`, `apple-icon.tsx`). Driven by the
 * `NEXT_PUBLIC_APP_ENV` env var so the home-screen icon is visually
 * distinct between environments — useful when both the dev and prod
 * builds are installed as PWAs on the same phone.
 *
 * Set in your env file:
 *   NEXT_PUBLIC_APP_ENV=dev      # `.env.dev` (or local development)
 *   NEXT_PUBLIC_APP_ENV=prod     # `.env.prod`
 *
 * Default behaviour: anything other than `"dev"` renders the prod
 * theme, so the live deployment doesn't accidentally show a DEV
 * badge if the env var is missing.
 *
 * Prod also embeds a custom artwork (HVC batter logo) from
 * `public/app-icon.png` and clips it to a circle. Dev keeps the
 * dynamic text-on-amber treatment so a `dev` install is unmistakable
 * on a home screen.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type IconTheme = {
  /** Used for icon.tsx (32×32) — keep this very short. */
  shortLabel: string;
  /** Used for icon1/icon2/apple-icon (≥180×180) — has room for "DEV". */
  longLabel: string;
  background: string;
  foreground: string;
};

export const ICON_PROD: IconTheme = {
  shortLabel: "HVC",
  longLabel: "HVC",
  background: "#0a0a0a",
  foreground: "#fafafa",
};

export const ICON_DEV: IconTheme = {
  // Amber palette so the dev icon is unmistakable on a home screen
  // full of dark app tiles.
  shortLabel: "DEV",
  longLabel: "HVC DEV",
  background: "#7c2d12",
  foreground: "#fef3c7",
};

export function isDevIcon(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV === "dev";
}

/**
 * Inline the prod artwork as a base64 data URL once at module load so
 * each icon route handler can hand it straight to `<img src=...>`
 * inside the `ImageResponse` JSX. Reading from disk avoids the
 * fragility of hard-coding a deployment URL.
 *
 * `null` if the file is missing — handlers fall back to the text
 * treatment so the build doesn't crash if the artwork is removed.
 */
function loadProdArtwork(): string | null {
  try {
    const buf = readFileSync(join(process.cwd(), "public", "app-icon.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export const PROD_ARTWORK_DATA_URL: string | null = loadProdArtwork();
