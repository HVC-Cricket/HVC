import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon512() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontSize: 240,
          fontWeight: 800,
          letterSpacing: -6,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        HVC
      </div>
    ),
    size,
  );
}
