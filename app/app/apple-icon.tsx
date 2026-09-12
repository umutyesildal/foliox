import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (design-basalt-v1 §3): Next ignores apple-icon.svg
 * (raster-only convention), so this renders the BASALT MARK via
 * ImageResponse instead — three hexagonal columns of descending height on a
 * shared baseline, filled in the electric-yellow accent. At this size the
 * hexagonal cap facets are separated from the column bodies with a
 * near-black seam (0.55-unit line at each bevel base) — the "cut stone"
 * detail that reads at 180px but is omitted from the 32px favicon.
 * Full-bleed square, iOS applies its own corner mask. Exact 24x24 relative
 * geometry of LogoMark in components/shell/site-header.tsx, rendered at
 * 128px so the columns fill most of the frame.
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
          backgroundColor: "#0A0A0B",
        }}
      >
        <svg width="128" height="128" viewBox="0 0 24 24">
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
      </div>
    ),
    { ...size },
  );
}
