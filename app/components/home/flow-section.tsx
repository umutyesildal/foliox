import Image from "next/image";
import Link from "next/link";

/**
 * Flow section — replaces the old bento gateway. One idea: every basket
 * follows the same three steps, shown as three inscription columns — a large
 * Cinzel numeral, a real crop of that step's screen (flow/create|holdings|
 * redeem.png), a lowercase `fig.` caption, and two lines of copy. The crop
 * card lifts 2px with a brightening border on hover (≤200ms, reduced-motion
 * honored); the numeral and caption stay still. No color — typography only.
 */

const STEPS = [
  {
    numeral: "I",
    fig: "fig. i — create",
    copy: "Pick the stocks, set the weights. Immutable after deployment.",
    href: "/create",
    src: "/brand/flow/create.png",
    alt: "FolioX create flow — selecting xStocks and setting basket weights",
  },
  {
    numeral: "II",
    fig: "fig. ii — mint",
    copy: "Deposit tokens, receive basket tokens at the exact weights.",
    href: "/explore",
    src: "/brand/flow/holdings.png",
    alt: "FolioX basket page — minted basket tokens held at exact weights",
  },
  {
    numeral: "III",
    fig: "fig. iii — redeem",
    copy: "Burn tokens, receive the underlying. Wallet to wallet.",
    href: "/portfolio",
    src: "/brand/flow/redeem.png",
    alt: "FolioX redeem flow — burning basket tokens for the underlying",
  },
] as const;

export function FlowSection() {
  return (
    <section
      aria-labelledby="flow-heading"
      className="border-t border-border py-16 dark:border-border/60"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Section header — tracked Cinzel eyebrow + the one line. */}
        <header>
          <h2
            id="flow-heading"
            className="font-[family-name:var(--font-display)] text-xs font-medium tracking-[0.22em] text-muted-foreground"
          >
            CREATE · MINT · REDEEM
          </h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Every basket follows the same three steps.
          </p>
        </header>

        <ol className="mt-10 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.numeral}>
              <Link
                href={step.href}
                className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden="true"
                  className="font-[family-name:var(--font-display)] text-4xl font-medium leading-none text-foreground/90"
                >
                  {step.numeral}
                </span>
                <span className="mt-5 block overflow-hidden rounded-lg border border-border transition-[border-color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-foreground/30 motion-reduce:transform-none motion-reduce:transition-none">
                  <Image
                    src={step.src}
                    alt={step.alt}
                    width={1280}
                    height={900}
                    sizes="(min-width: 640px) 30vw, 100vw"
                    className="aspect-[4/3] w-full object-cover object-top"
                  />
                </span>
                <span className="mt-3 block font-mono text-[11px] lowercase tracking-wide text-muted-foreground">
                  {step.fig}
                </span>
                <span className="mt-2 block max-w-xs text-sm leading-5 text-muted-foreground">
                  {step.copy}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
