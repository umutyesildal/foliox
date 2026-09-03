import Image from "next/image";

/**
 * Hero band — a full-bleed cinematic still (the Pantheon dome interior, oculus
 * glowing) sitting directly under the hero CTAs. Pure punctuation: no headline,
 * no overlay text — just the photograph, object-cover full width, and a bottom
 * fade mask that melts it back into the page background. The only type is the
 * tiny photo credit (attribution is a license requirement, kept quiet on
 * purpose).
 *
 * roman-2.jpg — "Pantheon, dome interior" photo by T. Le Berre, CC BY-SA 4.0.
 * Full attribution also lives in docs/roman-imagery-sources.md and the comment
 * in app/page.tsx.
 */
export function RomanHeroBand() {
  return (
    <section aria-label="The Pantheon dome interior, lit by its oculus" className="relative w-full">
      <div className="relative h-[55vh] min-h-[340px] w-full overflow-hidden md:h-[65vh]">
        <Image
          src="/brand/roman-2.jpg"
          alt="The Pantheon dome interior, daylight pouring through the oculus"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[50%_45%]"
        />
        {/* Bottom fade — the band dissolves into the page, like the hero shot. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-background"
        />
        {/* Attribution — license requires it; kept to a 10px whisper. */}
        <p className="absolute bottom-2.5 right-3 font-mono text-[10px] leading-none text-muted-foreground/70">
          Photo: T. Le Berre · CC BY-SA 4.0
        </p>
      </div>
    </section>
  );
}
