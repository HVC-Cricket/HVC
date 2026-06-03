import { ImageResponse } from "next/og";

import {
  ICON_DEV,
  ICON_PROD,
  PROD_ARTWORK_DATA_URL,
  isDevIcon,
} from "./icon-theme";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const dev = isDevIcon();
  const t = dev ? ICON_DEV : ICON_PROD;
  // Prod uses the HVC batter artwork clipped to a circle; dev keeps
  // the text treatment so it's unmistakable on the home screen.
  if (!dev && PROD_ARTWORK_DATA_URL) {
    return new ImageResponse(
      (
        <img
          src={PROD_ARTWORK_DATA_URL}
          width="100%"
          height="100%"
          alt=""
          style={{
            objectFit: "cover",
            borderRadius: "50%",
          }}
        />
      ),
      size,
    );
  }
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: t.background,
          color: t.foreground,
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: -0.5,
          fontFamily: "system-ui, sans-serif",
          borderRadius: "50%",
        }}
      >
        {t.shortLabel}
      </div>
    ),
    size,
  );
}
