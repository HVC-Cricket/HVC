import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon192() {
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
          fontSize: 88,
          fontWeight: 800,
          letterSpacing: -2,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        HVC
      </div>
    ),
    size,
  );
}
