import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (roman-empire, owner feedback 2026-09-03): Next ignores
 * apple-icon.svg (raster-only convention), so this renders the plain laurel
 * wreath via ImageResponse instead — no F monogram. Full-bleed square, iOS
 * applies its own corner mask. Same stroke geometry as LogoMark in
 * components/shell/site-header.tsx, drawn a touch heavier so the wreath
 * survives the rasterizer.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
        }}
      >
        <svg
          width="128"
          height="128"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fafafa"
          strokeLinecap="round"
        >
          {/* wreath: two mirrored branches + binding arc, open at the top */}
          <g strokeWidth="1.7">
            <path d="M8.6 20.7C5.7 19.2 3.9 16.1 3.9 12.7c0-2.7.6-5.3 1.7-7.5" />
            <path d="M15.4 20.7c2.9-1.5 4.7-4.6 4.7-8 0-2.7-.6-5.3-1.7-7.5" />
            <path d="M8.6 20.7c1.1.9 2.3 1.4 3.4 1.4s2.3-.5 3.4-1.4" />
            {/* leaf ticks, outboard of each branch */}
            <path d="M4.6 7.9 3.1 7.5M3.9 11.3 2.3 11.7M4.4 14.9 2.9 15.7M5.8 18 4.4 19.1" />
            <path d="m19.4 7.9 1.5-.4M20.1 11.3l1.6.4M19.6 14.9l1.5.8M18.2 18l1.4 1.1" />
          </g>
        </svg>
      </div>
    ),
    { ...size },
  );
}
