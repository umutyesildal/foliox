"use client";

import { LegalReviewTag } from "./legal-review-tag";
import type { LegalAcknowledgments } from "./types";

interface AcknowledgmentSpec {
  key: keyof LegalAcknowledgments;
  statement: string;
  detail: string;
}

const ACKNOWLEDGMENTS: AcknowledgmentSpec[] = [
  {
    key: "notAdvice",
    statement: "Creating and deploying this basket is not investment advice.",
    detail:
      "Basalt provides tooling, not recommendations. Nothing here evaluates whether these constituents, weights, or fees suit any person. Weight selection, fee selection, and deployment are entirely the creator's decisions.",
  },
  {
    key: "jurisdiction",
    statement:
      "I am responsible for the jurisdiction I create from, and access may be restricted.",
    detail:
      "Distribution of tokenized equities is restricted in several jurisdictions (including, without limitation, US persons for many xStocks). Any frontend geo-check is off-chain only — the on-chain program cannot gate who signs.",
  },
  {
    key: "structuredInstrument",
    statement:
      "xStocks are Backed Finance structured instruments, not direct equity.",
    detail:
      "Each xStock is a tokenized tracker issued by Backed; holders have no shareholder rights in the underlying company, dividends are handled by the issuer mechanism, and the token's value depends on the issuer's custody and hedging arrangements.",
  },
  {
    key: "creatorNotAdviser",
    statement:
      "I am not acting as a licensed adviser, and the 90/10 fee split is my compensation.",
    detail:
      "Unless separately licensed, deploying a basket does not make me an adviser or asset manager. The fee schedule I set (up to 300/100/300 bps) is paid by depositors and redeemers, split 90% creator / 10% treasury, and is immutable once deployed.",
  },
];

/**
 * Step 5 — four hard acknowledgments. Deploy stays blocked until all four are
 * checked, and the LEGAL_REVIEW_REQUIRED placeholder stays visible.
 */
export function LegalCheckboxes({
  legal,
  onChange,
}: {
  legal: LegalAcknowledgments;
  onChange: (key: keyof LegalAcknowledgments, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          All four acknowledgments are required. Copy below is a placeholder for
          counsel.
        </p>
        <LegalReviewTag className="ml-auto" />
      </div>

      <ul className="flex flex-col gap-2">
        {ACKNOWLEDGMENTS.map((spec) => (
          <li key={spec.key}>
            <label
              className={legal[spec.key] ? "flex cursor-pointer gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3" : "flex cursor-pointer gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"}
            >
              <input
                type="checkbox"
                checked={legal[spec.key]}
                onChange={(event) => onChange(spec.key, event.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{spec.statement}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {spec.detail}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-5 text-muted-foreground">
        These acknowledgments are UI copy only — they are not stored on-chain and
        do not replace any jurisdiction-specific agreement.{" "}
        <LegalReviewTag />
      </p>
    </div>
  );
}
