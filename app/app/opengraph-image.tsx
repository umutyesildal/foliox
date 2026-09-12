import { ImageResponse } from "next/og";

export const alt = "FolioX — Strategy Baskets on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview (NEON FOUNDRY de-Rome pass, 2026-09-12): near-black cool
 * card with the FOUNDRY MARK — hexagon outline + three descending weight
 * bars (spec §7, same 24x24 relative geometry as LogoMark in
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

        {/* FOUNDRY MARK — same 24x24 construction as LogoMark in the header */}
        <svg
          width="220"
          height="220"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FCEE0A"
          strokeLinejoin="miter"
          style={{ marginBottom: 40 }}
        >
          {/* hexagon container, sharp miter joins */}
          <path
            d="M12 2.5 L20.2 7.25 V16.75 L12 21.5 L3.8 16.75 V7.25 Z"
            strokeWidth="1.7"
          />
          {/* three descending weight bars (filled rects, no stroke) */}
          <g fill="#FCEE0A" stroke="none">
            <rect x="8" y="8.1" width="8.6" height="2.1" />
            <rect x="8" y="11.95" width="6.6" height="2.1" />
            <rect x="8" y="15.8" width="4.6" height="2.1" />
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
