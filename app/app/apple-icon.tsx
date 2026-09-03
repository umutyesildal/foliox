import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (roman-empire): Next ignores apple-icon.svg (raster-only
 * convention), so this renders the laurel-wreath "F" mark via ImageResponse
 * instead. Full-bleed square — iOS applies its own corner mask. Same stroke
 * geometry as LogoMark in components/shell/site-header.tsx and app/icon.svg
 * (F drawn as paths, not text — satori can't load the Cinzel webfont).
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
          width="118"
          height="118"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fafafa"
          strokeLinecap="round"
        >
          {/* wreath: two mirrored branches + binding arc + leaf ticks */}
          <g strokeWidth="1.4">
            <path d="M8.6 20.7C5.7 19.2 3.9 16.1 3.9 12.7c0-2.7.6-5.3 1.7-7.5" />
            <path d="M15.4 20.7c2.9-1.5 4.7-4.6 4.7-8 0-2.7-.6-5.3-1.7-7.5" />
            <path d="M8.6 20.7c1.1.9 2.3 1.4 3.4 1.4s2.3-.5 3.4-1.4" />
            <path d="M4.6 7.9 3.1 7.5M3.9 11.3 2.3 11.7M4.4 14.9 2.9 15.7M5.8 18 4.4 19.1" />
            <path d="m19.4 7.9 1.5-.4M20.1 11.3l1.6.4M19.6 14.9l1.5.8M18.2 18l1.4 1.1" />
          </g>
          {/* serif "F" monogram */}
          <g strokeWidth="1.6">
            <path d="M10.6 6.7v10.8" />
            <path d="M9.3 6.7h5.6M14.9 6.7v1.3" />
            <path d="M10.6 11.7h3.8M14.4 11.7v1.1" />
            <path d="M9.4 17.5h2.4" />
          </g>
        </svg>
      </div>
    ),
    { ...size },
  );
}
