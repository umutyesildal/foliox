import { cn } from "@/lib/utils";

/**
 * BasketAvatar — the basket identity mark, in FOUNDRY MARK language: a
 * hexagon container outline holding three descending weight bars, line art
 * only (stroke currentColor), tinted per basket. The hue is derived
 * deterministically from the basket pubkey bytes — the same basket always
 * renders the same tint — drawn from the saturated neon families (cyan /
 * magenta / green / violet, mirroring SocialAvatar's identicon palette;
 * yellow is reserved for primary actions and never appears here). The glyph
 * sits on a deep tinted wash so the mark reads as a logo chip, not bare
 * line art.
 *
 * When `imageUrl` is provided the remote image renders on top of the glyph;
 * if it fails to load it renders as an empty transparent element (empty
 * alt), revealing the glyph underneath — the same graceful fallback
 * SocialAvatar achieves with onError, but without state or an event
 * handler, so this component stays server-safe (no "use client", no hooks)
 * and can be used from both server and client components.
 */

/** Hue families mirrored from SocialAvatar's identicon palette — neon only. */
const HUE_FAMILIES = [
  { base: 187, spread: 16 }, // neon cyan
  { base: 325, spread: 14 }, // neon magenta
  { base: 152, spread: 16 }, // neon green
  { base: 262, spread: 18 }, // neon violet
] as const;

/** Deterministic hue from the basket string bytes (stable across renders). */
function basketHue(basket: string): number {
  let hash = 0;
  for (let i = 0; i < basket.length; i += 1) {
    hash = (hash * 31 + basket.charCodeAt(i)) >>> 0;
  }
  const family = HUE_FAMILIES[hash % HUE_FAMILIES.length];
  const jitter = (((hash >>> 2) % (family.spread * 2 + 1)) - family.spread) | 0;
  return (family.base + jitter + 360) % 360;
}

/** Hexagon container + descending bars — the FOUNDRY MARK, 24-unit grid. */
function FoundryMarkGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
    >
      {/* hexagon — the FOUNDRY MARK container (spec §7 shape, scaled) */}
      <path d="M12 4.16 18.75 8.08v7.84L12 19.84 5.25 15.92V8.08Z" />
      {/* three descending weight bars — the composed basket inside */}
      <path d="M8.5 9.75h7" />
      <path d="M9.75 12.25h4.5" />
      <path d="M11 14.75h2" />
    </svg>
  );
}

export function BasketAvatar({
  basket,
  imageUrl,
  size = 28,
  className,
}: {
  /** Basket pubkey — seeds the deterministic tint. */
  basket: string;
  /** Remote basket logo; on load failure the glyph shows through. */
  imageUrl?: string | null;
  /** Square side in px — 28 for feed/leaderboard rows. */
  size?: number;
  className?: string;
}) {
  const hue = basketHue(basket);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-sm",
        className,
      )}
      style={{
        width: size,
        height: size,
        // Deep tinted wash + saturated stroke of the same hue family.
        background: `hsl(${hue} 60% 12%)`,
        color: `hsl(${hue} 85% 64%)`,
      }}
    >
      <FoundryMarkGlyph />
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote basket art; image domains are not enumerable
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : null}
    </span>
  );
}
