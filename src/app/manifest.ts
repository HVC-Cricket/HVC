import type { MetadataRoute } from "next";

/**
 * Icon cache-busting version. Bump whenever the rendered output of
 * `app-icon.png` (or any of the icon route handlers) changes — the
 * `?v=N` suffix forces Android Chrome's WebAPK refresh to treat the
 * URLs as new and re-fetch on its next manifest poll (typically
 * within a day). iOS Safari ignores manifest changes for already-
 * installed PWAs entirely; iOS users need to remove + re-add the
 * app to the home screen to pick up the new artwork. New installs
 * on either platform always get the latest version regardless.
 */
const ICON_VERSION = 2;

export default function manifest(): MetadataRoute.Manifest {
  const v = `?v=${ICON_VERSION}`;
  return {
    name: "HVC Heroes",
    short_name: "HVC Heroes",
    description: "Live scoring + spectator view for HVC box-cricket tournaments",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["sports"],
    icons: [
      {
        src: `/icon${v}`,
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: `/apple-icon${v}`,
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: `/icon1${v}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: `/icon2${v}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
