import { LegalReviewTag } from "@/components/create/legal-review-tag";

interface Section {
  title: string;
  /** Each section keeps the placeholder visible until counsel approves copy. */
  body: string[];
}

/**
 * Legal page — a reading-width disclosure document. Server component; no data
 * fetching. Every section carries LEGAL_REVIEW_REQUIRED: this is placeholder
 * copy, not approved legal language (AGENTS.md §12, brand.md).
 */
const SECTIONS: Section[] = [
  {
    title: "Not investment advice",
    body: [
      "FolioX is software for creating, holding, and redeeming tokenized strategy baskets. Nothing on this site is investment advice, a recommendation, or an offer to buy or sell any asset. Constituents, weights, and fee schedules are chosen entirely by basket creators, and FolioX does not evaluate whether any basket suits any person.",
      "Deploying a basket does not make the deploying wallet an adviser or asset manager. Unless a creator is separately licensed, no licensed relationship exists between creators, depositors, or FolioX.",
    ],
  },
  {
    title: "Jurisdiction and eligibility",
    body: [
      "Distribution of tokenized equities is restricted in many jurisdictions. Access from a restricted jurisdiction may be blocked at the frontend, but any such block is off-chain only: the on-chain programs cannot and do not gate who signs a transaction. You are responsible for compliance with the laws of your own jurisdiction.",
      "In particular, many xStocks are not offered to US persons. This paragraph is a placeholder for counsel-approved eligibility language.",
    ],
  },
  {
    title: "What xStocks are — structured instruments, not direct equity",
    body: [
      "xStocks are Token-2022 tokens issued by Backed Finance that track the price of underlying shares. Holding an xStock is not the same as holding equity in the underlying company: holders generally receive no shareholder rights, no direct voting rights, and dividends are handled by the issuer's mechanism.",
      "The value of an xStock depends on the issuer's custody and hedging arrangements. A basket vault holds xStock tokens; redeeming a basket returns xStock tokens, never off-chain shares.",
    ],
  },
  {
    title: "Fees",
    body: [
      "Creators set three fees at deployment, within hard caps: entry up to 300 bps, exit up to 100 bps, and management up to 300 bps per year. Fees are charged in basket shares, never in underlying tokens. Fee revenue splits 90% to the basket creator and 10% to the treasury; the split floors the creator portion so the two always sum to the fee.",
      "The fee schedule is immutable once a basket is deployed. Review it before minting — it is disclosed on every basket page and in the create wizard.",
    ],
  },
  {
    title: "Self-custody and permissionless redemption",
    body: [
      "FolioX and the indexer never custody user assets and never hold signing keys. Basket vaults are on-chain program-owned accounts. Redemption (redeem_in_kind) is permissionless and oracle-free: it computes pro-rata vault entitlements, floored to the raw token unit, and cannot be paused by FolioX, the creator, or any authority.",
      "If the indexer or this website is offline, redemption still works by interacting with the on-chain program directly through any Solana RPC.",
    ],
  },
  {
    title: "Token-2022 scaled-UI multiplier risk",
    body: [
      "xStock mints use the Token-2022 Scaled UI Amount extension. The multiplier changes on corporate actions such as splits and dividends. On-chain accounting always uses raw amounts and is unaffected; display values (and NAV computed off-chain) change with the multiplier. A multiplier change is a display change, not a redemption change — but between the change and the next indexer sync, displayed values can differ from reality.",
    ],
  },
  {
    title: "Zap conversions: slippage and sequential execution",
    body: [
      "Depositing USDC or exiting to USDC runs through Jupiter as a convenience path of sequential swaps followed by (or following) a core program instruction. Sequential swaps are not atomic: if a leg fails mid-way, you hold intermediate tokens and must complete the remaining legs yourself. Typical slippage exposure is 1-3% and can be worse in volatile markets. The core in-kind mint and redeem path has no such slippage.",
    ],
  },
  {
    title: "Drift is expected; there is no rebalancing",
    body: [
      "Basket weights are fixed targets. Vault composition drifts whenever prices move, because V0 baskets never trade or rebalance. The actual weight of a constituent can differ materially from its target weight. NAV and drift figures are computed by the indexer from snapshots and are historical information only — never projections.",
    ],
  },
  {
    title: "Immutability and upgrade authority",
    body: [
      "Basket parameters — constituents, weights, fee schedule, creator, and metadata hash — cannot change after deployment; no update instruction exists. The on-chain programs themselves are currently upgradable: the programs' upgrade authorities can deploy changed program code. The intended path is an upgradable multisig with a disclosed timelock in a later version. This is a material risk: program logic itself could change.",
    ],
  },
  {
    title: "Language",
    body: [
      "Baskets on FolioX are described only as strategy baskets, index baskets, onchain equity baskets, or xStocks-backed strategy tokens. They are not registered investment companies, not ETFs, and not funds, and nothing here projects returns or implies safety of principal. Smart-contract risk, issuer risk, market risk, and depeg risk all apply.",
    ],
  },
];

export default function LegalPage() {
  return (
    <div className="mx-auto w-full max-w-prose">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Risks &amp; Disclosures</h1>
        <LegalReviewTag />
      </header>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        The entire document below is placeholder copy. Every section carries{" "}
        <LegalReviewTag /> until counsel approves final language — read it as an
        engineering draft, not approved legal text.
      </p>

      <div className="mt-10 flex flex-col gap-10 text-base leading-7">
        {SECTIONS.map((section, index) => (
          <section key={section.title} aria-labelledby={`legal-section-${index}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id={`legal-section-${index}`}
                className="text-xl font-semibold tracking-tight"
              >
                {section.title}
              </h2>
              <LegalReviewTag />
            </div>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="mt-3 text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <footer className="mt-12 border-t border-border/60 pt-6 text-xs leading-5 text-muted-foreground">
        <p>
          Program IDs (localnet/devnet): whitelist{" "}
          <span className="font-mono">bdEDPr9K…YMNz</span>, basket_factory{" "}
          <span className="font-mono">sXShikYX…jAyq</span>, basket{" "}
          <span className="font-mono">37VPGtd5…gbb1</span>.
        </p>
        <p className="mt-2">
          Questions about this document belong to counsel, not to this page. Last
          review status: <LegalReviewTag />.
        </p>
      </footer>

    </div>
  );
}
