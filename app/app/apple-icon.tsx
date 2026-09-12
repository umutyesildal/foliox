import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (NEON FOUNDRY de-Rome pass, 2026-09-12): Next ignores
 * apple-icon.svg (raster-only convention), so this renders the FOUNDRY MARK
 * via ImageResponse instead — hexagon outline + three descending weight bars
 * (spec §7). Full-bleed square, iOS applies its own corner mask. Near-black
 * cool canvas with the mark in the electric-yellow accent. Exact 24x24
 * relative geometry of LogoMark in components/shell/site-header.tsx
 * (stroke-width 1.7), rendered at 128px so the mark fills most of the frame;
 * the yellow-on-near-black contrast keeps the 1.7-unit stroke legible after
 * the rasterizer.
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
        <svg
          width="128"
          height="128"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FCEE0A"
          strokeLinejoin="miter"
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
      </div>
    ),
    { ...size },
  );
}
