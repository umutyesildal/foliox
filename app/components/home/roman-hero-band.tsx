import Image from "next/image";

/**
 * Hero band — a full-bleed cinematic still (the Colosseum at night, floodlit
 * against a black sky) sitting directly under the hero CTAs. Pure punctuation:
 * no headline, no overlay text — just the photograph, object-position biased
 * to the dark sky at the top of the frame, and a bottom fade mask that melts
 * it back into the page background. The only type is the tiny photo credit
 * (attribution is a license requirement, kept quiet on purpose).
 *
 * roman-1.jpg — "Colosseum" by Ank Kumar, CC BY-SA 4.0. Full attribution also
 * lives in docs/roman-imagery-sources.md and the comment in app/page.tsx.
 */
export function RomanHeroBand() {
  return (
    <section aria-label="The Colosseum at night" className="relative w-full">
      <div className="relative h-[55vh] min-h-[340px] w-full overflow-hidden md:h-[65vh]">
        <Image
          src="/brand/roman-1.jpg"
          alt="The Colosseum at night, floodlit against a black sky"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[50%_30%]"
        />
        {/* Bottom fade — the band dissolves into the page, like the hero shot. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-background"
        />
        {/* Attribution — license requires it; kept to a 10px whisper. */}
        <p className="absolute bottom-2.5 right-3 font-mono text-[10px] leading-none text-muted-foreground/70">
          Photo: Ank Kumar · CC BY-SA 4.0
        </p>
      </div>
    </section>
  );
}
