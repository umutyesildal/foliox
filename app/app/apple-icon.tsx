import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (roman-empire): Next ignores apple-icon.svg (raster-only
 * convention), so this renders the column mark via ImageResponse instead.
 * Full-bleed square — iOS applies its own corner mask.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
        }}
      >
        <div style={{ width: 120, height: 7, backgroundColor: "#fafafa", borderRadius: 3.5 }} />
        <div style={{ width: 92, height: 6, backgroundColor: "#fafafa", borderRadius: 3, marginTop: 8 }} />
        <div style={{ display: "flex", gap: 19, marginTop: 7 }}>
          <div style={{ width: 6, height: 82, backgroundColor: "#fafafa", borderRadius: 3 }} />
          <div style={{ width: 6, height: 82, backgroundColor: "#fafafa", borderRadius: 3 }} />
          <div style={{ width: 6, height: 82, backgroundColor: "#fafafa", borderRadius: 3 }} />
        </div>
        <div style={{ width: 102, height: 7, backgroundColor: "#fafafa", borderRadius: 3.5, marginTop: 7 }} />
      </div>
    ),
    { ...size },
  );
}
