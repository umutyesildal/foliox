interface Section {
  title: string;
  /** Short label used in the table of contents. */
  toc: string;
  body: string[];
}

/**
 * Legal page — a reading-width disclosure document. Server component; no data
 * fetching. Sections are quiet cards under a small sticky table of contents.
 * Copy is placeholder engineering prose, not counsel-approved legal text.
 */
const SECTIONS: Section[] = [
  {
    title: "Not investment advice",
    toc: "Not advice",
    body: [
      "Basalt is software for creating, holding, and redeeming tokenized strategy baskets. Nothing on this site is investment advice, a recommendation, or an offer to buy or sell any asset. Constituents, weights, and fee schedules are chosen entirely by basket creators, and Basalt does not evaluate whether any basket suits any person.",
      "Deploying a basket does not make the deploying wallet an adviser or asset manager. Unless a creator is separately licensed, no licensed relationship exists between creators, depositors, or Basalt.",
    ],
  },
  {
    title: "Jurisdiction and eligibility",
    toc: "Eligibility",
    body: [
      "Distribution of tokenized equities is restricted in many jurisdictions. Access from a restricted jurisdiction may be blocked at the frontend, but any such block is off-chain only: the on-chain programs cannot and do not gate who signs a transaction. You are responsible for compliance with the laws of your own jurisdiction.",
      "In particular, many xStocks are not offered to US persons. This paragraph is a placeholder for counsel-approved eligibility language.",
    ],
  },
  {
    title: "What xStocks are — structured instruments, not direct equity",
    toc: "What xStocks are",
    body: [
      "xStocks are Token-2022 tokens issued by Backed Finance that track the price of underlying shares. Holding an xStock is not the same as holding equity in the underlying company: holders generally receive no shareholder rights, no direct voting rights, and dividends are handled by the issuer's mechanism.",
      "The value of an xStock depends on the issuer's custody and hedging arrangements. A basket vault holds xStock tokens; redeeming a basket returns xStock tokens, never off-chain shares.",
    ],
  },
  {
    title: "Fees",
    toc: "Fees",
    body: [
      "Creators set three fees at deployment, within hard caps: entry up to 300 bps, exit up to 100 bps, and management up to 300 bps per year. Fees are charged in basket shares, never in underlying tokens. Fee revenue splits 90% to the basket creator and 10% to the treasury; the split floors the creator portion so the two always sum to the fee.",
      "The fee schedule is immutable once a basket is deployed. Review it before minting — it is disclosed on every basket page and in the create wizard.",
    ],
  },
  {
    title: "Self-custody and permissionless redemption",
    toc: "Self-custody",
    body: [
      "Basalt and the indexer never custody user assets and never hold signing keys. Basket vaults are on-chain program-owned accounts. Redemption (redeem_in_kind) is permissionless and oracle-free: it computes pro-rata vault entitlements, floored to the raw token unit, and cannot be paused by Basalt, the creator, or any authority.",
      "If the indexer or this website is offline, redemption still works by interacting with the on-chain program directly through any Solana RPC.",
    ],
  },
  {
    title: "Token-2022 scaled-UI multiplier risk",
    toc: "Scaled-UI risk",
    body: [
      "xStock mints use the Token-2022 Scaled UI Amount extension. The multiplier changes on corporate actions such as splits and dividends. On-chain accounting always uses raw amounts and is unaffected; display values (and NAV computed off-chain) change with the multiplier. A multiplier change is a display change, not a redemption change — but between the change and the next indexer sync, displayed values can differ from reality.",
    ],
  },
  {
    title: "Zap conversions: slippage and sequential execution",
    toc: "Zap slippage",
    body: [
      "Depositing USDC or exiting to USDC runs through Jupiter as a convenience path of sequential swaps followed by (or following) a core program instruction. Sequential swaps are not atomic: if a leg fails mid-way, you hold intermediate tokens and must complete the remaining legs yourself. Typical slippage exposure is 1-3% and can be worse in volatile markets. The core in-kind mint and redeem path has no such slippage.",
    ],
  },
  {
    title: "Drift is expected; there is no rebalancing",
    toc: "Drift",
    body: [
      "Basket weights are fixed targets. Vault composition drifts whenever prices move, because V0 baskets never trade or rebalance. The actual weight of a constituent can differ materially from its target weight. NAV and drift figures are computed by the indexer from snapshots and are historical information only — never projections.",
    ],
  },
  {
    title: "Immutability and upgrade authority",
    toc: "Upgradability",
    body: [
      "Basket parameters — constituents, weights, fee schedule, creator, and metadata hash — cannot change after deployment; no update instruction exists. The on-chain programs themselves are currently upgradable: the programs' upgrade authorities can deploy changed program code. The intended path is an upgradable multisig with a disclosed timelock in a later version. This is a material risk: program logic itself could change.",
    ],
  },
  {
    title: "Language",
    toc: "Language",
    body: [
      "Baskets on Basalt are described only as strategy baskets, index baskets, onchain equity baskets, or xStocks-backed strategy tokens. They are not registered investment companies, not ETFs, and not funds, and nothing here projects returns or implies safety of principal. Smart-contract risk, issuer risk, market risk, and depeg risk all apply.",
    ],
  },
];

export default function LegalPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-semibold">Risks &amp; Disclosures</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Placeholder disclosure copy for Basalt baskets — an engineering draft, not
          counsel-approved legal text.
        </p>
      </header>

      <nav
        aria-label="Sections"
        className="sticky top-14 z-10 -mx-2 mt-6 border-y border-border/60 bg-background/90 px-2 py-2.5 backdrop-blur"
      >
        <ol className="flex flex-wrap gap-x-4 gap-y-1">
          {SECTIONS.map((section, index) => (
            <li key={section.title}>
              <a
                href={`#legal-section-${index}`}
                className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>{" "}
                {section.toc}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-6 flex flex-col gap-4">
        {SECTIONS.map((section, index) => (
          <section
            key={section.title}
            aria-labelledby={`legal-section-${index}`}
            className="rounded-lg border bg-card p-5 scroll-mt-20"
          >
            <h2 id={`legal-section-${index}`} className="font-display text-base font-medium">
              <span className="mr-2 font-mono text-xs tabular-nums text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              {section.title}
            </h2>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="mt-3 text-sm leading-6 text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <footer className="mt-8 border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">
        <p>
          Program IDs (localnet/devnet): whitelist{" "}
          <span className="font-mono">bdEDPr9K…YMNz</span>, basket_factory{" "}
          <span className="font-mono">sXShikYX…jAyq</span>, basket{" "}
          <span className="font-mono">37VPGtd5…gbb1</span>.
        </p>
        <p className="mt-2">
          Placeholder copy — final language is owned by counsel, not by this page.
        </p>
      </footer>
    </div>
  );
}
