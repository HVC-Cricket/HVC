import { ImageResponse } from "next/og";

import {
  ICON_DEV,
  ICON_PROD,
  PROD_ARTWORK_DATA_URL,
  isDevIcon,
} from "./icon-theme";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon512() {
  const dev = isDevIcon();
  const t = dev ? ICON_DEV : ICON_PROD;
  if (!dev && PROD_ARTWORK_DATA_URL) {
    return new ImageResponse(
      (
        <img
          src={PROD_ARTWORK_DATA_URL}
          width="100%"
          height="100%"
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
          fontSize: 180,
          fontWeight: 800,
          letterSpacing: -6,
          fontFamily: "system-ui, sans-serif",
          borderRadius: "50%",
        }}
      >
        {t.longLabel}
      </div>
    ),
    size,
  );
}
