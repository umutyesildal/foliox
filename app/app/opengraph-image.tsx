import { ImageResponse } from "next/og";

export const alt = "Basalt — Strategy Baskets on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview (design-basalt-v1 §3): near-black cool card with the
 * BASALT MARK — three hexagonal columns of descending height on a shared
 * baseline (same 24x24 relative geometry as LogoMark in
 * components/shell/site-header.tsx), filled in the electric-yellow accent
 * with the cap-facet seams. The wordmark is set heavy in the OG renderer's
 * built-in system font (this file loads no fonts, so it stays on the
 * default sans — mono flavor comes from uppercase + wide tracking).
 * Terminal details: a yellow eyebrow badge with near-black text, yellow
 * corner ticks, and faint white hairlines as an engineering grid. Flat and
 * sharp-cornered throughout.
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

        {/* BASALT MARK — same 24x24 construction as LogoMark in the header,
            filled, with the cap-facet seams visible at this size */}
        <svg
          width="220"
          height="220"
          viewBox="0 0 24 24"
          style={{ marginBottom: 40 }}
        >
          {/* three basalt columns, descending heights, shared flat baseline */}
          <g fill="#FCEE0A">
            <path d="M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z" />
            <path d="M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z" />
            <path d="M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z" />
          </g>
          {/* hexagonal cap-facet seams — near-black lines at each bevel base */}
          <g stroke="#0A0A0B" strokeWidth="0.55">
            <line x1="4.3" y1="3.7" x2="8.7" y2="3.7" />
            <line x1="9.8" y1="10.7" x2="14.2" y2="10.7" />
            <line x1="15.3" y1="15.7" x2="19.7" y2="15.7" />
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
          BASALT
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
