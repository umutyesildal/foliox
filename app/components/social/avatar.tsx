"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { truncateAddress } from "@/lib/format";

/**
 * Avatar-or-identicon for social actors. When `avatarUrl` is present it
 * renders as a plain <img> (falls back to the identicon if the image fails to
 * load); otherwise a deterministic two-tone identicon block seeded from the
 * wallet address — same address always renders the same colors. The visible
 * glyph is the handle's first character, else the wallet's first character.
 */
export function SocialAvatar({
  wallet,
  handle,
  displayName,
  avatarUrl,
  size = "sm",
  className,
}: {
  wallet: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  /** sm = feed rows (7), md = profile header (14, tailwind size units). */
  size?: "sm" | "md";
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!avatarUrl && !imageFailed;
  const dim = size === "md" ? "h-14 w-14" : "h-7 w-7";
  const glyph = (displayName || handle || wallet).trim().charAt(0).toUpperCase();
  const palette = identiconPalette(wallet);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-mono text-foreground",
        dim,
        !showImage && "text-[0.65em]",
        className,
      )}
      style={
        showImage
          ? undefined
          : {
              background: `linear-gradient(135deg, hsl(${palette.a}) 0%, hsl(${palette.b}) 100%)`,
              fontSize: size === "md" ? "1.1rem" : "0.7rem",
            }
      }
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary profile URLs; next/image domains are not enumerable
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        glyph
      )}
    </span>
  );
}

/** "actor line" — avatar + name/handle-or-truncated-wallet, used on cards. */
export function ActorLine({
  wallet,
  handle,
  displayName,
  avatarUrl,
  className,
}: {
  wallet: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  className?: string;
}) {
  const label = displayName?.trim() || (handle ? `@${handle}` : truncateAddress(wallet, 4, 4));
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <SocialAvatar
        wallet={wallet}
        handle={handle}
        displayName={displayName}
        avatarUrl={avatarUrl}
      />
      <span className="truncate text-sm font-medium text-foreground" title={wallet}>
        {label}
      </span>
    </span>
  );
}

/** Deterministic hue pair from the wallet bytes (stable across renders). */
function identiconPalette(wallet: string): { a: string; b: string } {
  let hash = 0;
  for (let i = 0; i < wallet.length; i += 1) {
    hash = (hash * 31 + wallet.charCodeAt(i)) >>> 0;
  }
  const hueA = hash % 360;
  const hueB = (hueA + 40 + (hash % 80)) % 360;
  return { a: `${hueA} 24% 46%`, b: `${hueB} 28% 30%` };
}
