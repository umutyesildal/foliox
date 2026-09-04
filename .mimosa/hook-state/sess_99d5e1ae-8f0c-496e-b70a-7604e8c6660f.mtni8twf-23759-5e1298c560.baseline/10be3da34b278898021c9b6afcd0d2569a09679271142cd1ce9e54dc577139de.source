import { ImageResponse } from "next/og";

export const alt = "FolioX — Strategy Baskets on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview (roman-empire, owner feedback 2026-09-03): dark monochrome
 * card with the plain laurel wreath (no F monogram — same stroke geometry as
 * LogoMark in components/shell/site-header.tsx) and the wordmark set in a
 * system serif — Trajan-esque small-caps fallback, since ImageResponse can't
 * load the local Cinzel files.
 */
export default function OpengraphImage() {
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
          color: "#fafafa",
          border: "2px solid #27272a",
        }}
      >
        {/* Plain laurel wreath — same construction as LogoMark in the header */}
        <svg
          width="168"
          height="168"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fafafa"
          strokeLinecap="round"
          style={{ marginBottom: 44 }}
        >
          {/* wreath: two mirrored branches + binding arc, open at the top */}
          <g strokeWidth="1.4">
            <path d="M8.6 20.7C5.7 19.2 3.9 16.1 3.9 12.7c0-2.7.6-5.3 1.7-7.5" />
            <path d="M15.4 20.7c2.9-1.5 4.7-4.6 4.7-8 0-2.7-.6-5.3-1.7-7.5" />
            <path d="M8.6 20.7c1.1.9 2.3 1.4 3.4 1.4s2.3-.5 3.4-1.4" />
            {/* leaf ticks, outboard of each branch */}
            <path d="M4.6 7.9 3.1 7.5M3.9 11.3 2.3 11.7M4.4 14.9 2.9 15.7M5.8 18 4.4 19.1" />
            <path d="m19.4 7.9 1.5-.4M20.1 11.3l1.6.4M19.6 14.9l1.5.8M18.2 18l1.4 1.1" />
          </g>
        </svg>

        <div
          style={{
            display: "flex",
            fontSize: 128,
            fontFamily: "Georgia, 'Times New Roman', serif",
            letterSpacing: 28,
            textIndent: 28, // recenter: trailing tracking would skew the wordmark
            fontWeight: 600,
          }}
        >
          FOLIOX
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 36,
            color: "#a1a1aa",
            fontFamily: "Georgia, 'Times New Roman', serif",
            letterSpacing: 4,
          }}
        >
          Strategy baskets of tokenized xStocks on Solana
        </div>
      </div>
    ),
    { ...size },
  );
}
