import { ImageResponse } from "next/og";

export const alt = "FolioX — Strategy Baskets on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview (roman-empire): dark monochrome card with the column mark
 * drawn as plain divs and the wordmark set in a system serif — Trajan-esque
 * small-caps fallback, since ImageResponse can't load the local Cinzel files.
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
        {/* Column mark — same construction as the site-header glyph */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: 56,
          }}
        >
          <div style={{ width: 220, height: 12, backgroundColor: "#fafafa", borderRadius: 6 }} />
          <div style={{ width: 170, height: 10, backgroundColor: "#fafafa", borderRadius: 5, marginTop: 14 }} />
          <div style={{ display: "flex", gap: 34, marginTop: 12 }}>
            <div style={{ width: 11, height: 150, backgroundColor: "#fafafa", borderRadius: 5 }} />
            <div style={{ width: 11, height: 150, backgroundColor: "#fafafa", borderRadius: 5 }} />
            <div style={{ width: 11, height: 150, backgroundColor: "#fafafa", borderRadius: 5 }} />
          </div>
          <div style={{ width: 190, height: 12, backgroundColor: "#fafafa", borderRadius: 6, marginTop: 12 }} />
        </div>

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
