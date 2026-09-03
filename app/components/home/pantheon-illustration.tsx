/**
 * Pantheon illustration (roman-empire, owner feedback 2026-09-03: the hero
 * photo band is out — draw the building instead). Front-elevation line art in
 * the manner of an architectural engraving: on the left, the octastyle
 * portico — three steps, eight fluted-shaft columns with capital and base
 * ticks, the entablature, and the wide low pediment with a doubled raking
 * cornice; on the right, the big rotunda drum with its two cornices, the
 * stepped rings at the dome's springing, the shallow saucer dome, and the
 * oculus ring at the apex. A lower intermediate block joins the two masses.
 *
 * Strokes only (fill="none", currentColor) so the drawing inherits the page's
 * ink and survives both themes; a fainter offset ghost outline behind the
 * main one gives the architectural-drawing double-line feel. Decorative —
 * the section around it carries the aria label.
 */
export function PantheonIllustration({ className }: { className?: string }) {
  // Shared geometry, drawn twice: ghost offset copy first, main copy on top.
  const geometry = (
    <g strokeLinecap="round" strokeLinejoin="round">
      {/* Ground line */}
      <path d="M36 364h728" strokeWidth={2} />

      {/* Portico steps — three risers with mitered ends */}
      <path
        d="M48 364h340M54 355h328M60 346h316"
        strokeWidth={1.5}
      />
      <path
        d="M48 364l6-9M54 355l6-9M388 364l-6-9M382 355l-6-9"
        strokeWidth={1.5}
      />

      {/* Eight columns — shafts */}
      <path
        d="M73.5 238v103M82.5 238v103M109.5 238v103M118.5 238v103M145.5 238v103M154.5 238v103M181.5 238v103M190.5 238v103M217.5 238v103M226.5 238v103M253.5 238v103M262.5 238v103M289.5 238v103M298.5 238v103M325.5 238v103M334.5 238v103"
        strokeWidth={1.5}
      />
      {/* Capitals — necking + abacus ticks */}
      <path
        d="M72 234h12M70.5 228h15M108 234h12M106.5 228h15M144 234h12M142.5 228h15M180 234h12M178.5 228h15M216 234h12M214.5 228h15M252 234h12M250.5 228h15M288 234h12M286.5 228h15M324 234h12M322.5 228h15"
        strokeWidth={1.5}
      />
      {/* Bases */}
      <path
        d="M71.5 341h13M107.5 341h13M143.5 341h13M179.5 341h13M215.5 341h13M251.5 341h13M287.5 341h13M323.5 341h13"
        strokeWidth={1.5}
      />

      {/* Entablature — architrave over the abacuses, cornice above */}
      <path d="M60 228h316M54 210h328" strokeWidth={2} />

      {/* Pediment — wide and low, outer raking cornice over the inner
          tympanum line */}
      <path d="M44 210L218 162L392 210" strokeWidth={2} />
      <path d="M58 210L218 171L378 210" strokeWidth={1.5} />

      {/* Intermediate block — the low shoulder joining portico to rotunda */}
      <path d="M392 364V246H448" strokeWidth={1.5} />

      {/* Rotunda drum — walls, crowning cornice, mid cornice */}
      <path d="M448 364V222M724 364V222" strokeWidth={2} />
      <path d="M442 222h288M448 262h276" strokeWidth={2} />

      {/* Stepped rings at the dome springing */}
      <path
        d="M458 206h256M458 222v-16M714 222v-16M472 192h228M472 206v-14M700 206v-14"
        strokeWidth={1.5}
      />

      {/* Shallow dome */}
      <path d="M472 192A114 62 0 0 1 700 192" strokeWidth={2} />

      {/* Oculus — raised ring with the open eye inside */}
      <circle cx={586} cy={121} r={9} strokeWidth={2} />
      <circle cx={586} cy={121} r={4} strokeWidth={1.5} />
    </g>
  );

  return (
    <svg
      viewBox="0 40 800 360"
      role="img"
      aria-label="Line drawing of the Pantheon: an eight-column portico with a triangular pediment beside the cylindrical rotunda and its oculus-topped dome"
      fill="none"
      stroke="currentColor"
      className={className}
    >
      {/* Ghost offset outline — the draftsman's doubling */}
      <g strokeOpacity={0.15} transform="translate(14 -10)">
        {geometry}
      </g>
      <g strokeOpacity={0.9}>{geometry}</g>
    </svg>
  );
}
