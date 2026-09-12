import { ImageResponse } from "next/og";

export const alt = "FolioX — Strategy Baskets on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview (NEON FOUNDRY, 2026-09-12): near-black cool card with the
 * plain laurel wreath (no F monogram — same stroke geometry as LogoMark in
 * components/shell/site-header.tsx) recolored to the electric-yellow accent.
 * The wordmark is set heavy in the OG renderer's built-in system font (this
 * file loads no fonts, so it stays on the default sans — mono flavor comes
 * from uppercase + wide tracking). Terminal details: a yellow eyebrow badge
 * with near-black text, yellow corner ticks, and faint white hairlines as an
 * engineering grid. Flat and sharp-cornered throughout.
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
          position: "relative",
          backgroundColor: "#0A0A0B",
          color: "#F6F6F4",
        }}
      >
        {/* faint engineering grid — three hairlines */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 132,
            width: "100%",
            height: 1,
            backgroundColor: "#FFFFFF",
            opacity: 0.06,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 498,
            width: "100%",
            height: 1,
            backgroundColor: "#FFFFFF",
            opacity: 0.06,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 600,
            top: 0,
            width: 1,
            height: "100%",
            backgroundColor: "#FFFFFF",
            opacity: 0.06,
          }}
        />

        {/* yellow corner ticks (top/left offsets only for renderer safety) */}
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 32,
            width: 40,
            height: 40,
            borderTop: "2px solid #FCEE0A",
            borderLeft: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 1128,
            top: 32,
            width: 40,
            height: 40,
            borderTop: "2px solid #FCEE0A",
            borderRight: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 558,
            width: 40,
            height: 40,
            borderBottom: "2px solid #FCEE0A",
            borderLeft: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 1128,
            top: 558,
            width: 40,
            height: 40,
            borderBottom: "2px solid #FCEE0A",
            borderRight: "2px solid #FCEE0A",
          }}
        />

        {/* Plain laurel wreath — same construction as LogoMark in the header */}
        <svg
          width="160"
          height="160"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FCEE0A"
          strokeLinecap="round"
          style={{ marginBottom: 44 }}
        >
          {/* wreath: two mirrored branches + binding arc, open at the top */}
          <g strokeWidth="1.5">
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
            fontSize: 132,
            fontWeight: 700,
            letterSpacing: 28,
            textIndent: 28, // recenter: trailing tracking would skew the wordmark
          }}
        >
          FOLIOX
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 48,
            backgroundColor: "#FCEE0A",
            color: "#111110",
            fontSize: 23,
            fontWeight: 700,
            letterSpacing: 7,
            textIndent: 7, // recenter trailing tracking inside the badge
            padding: "12px 26px",
          }}
        >
          XSTOCKS STRATEGY BASKETS · SOLANA
        </div>
      </div>
    ),
    { ...size },
  );
}
