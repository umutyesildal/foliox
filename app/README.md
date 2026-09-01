# FolioX App (Next.js prototype)

Current status: visual scaffold with partial chart/page polish. It is not yet a wallet-connected or localnet-backed application. See the repository-level [implementation plan](../plan.md) and [UI discovery](../docs/ui-discovery-2026-09-01.md).

Implements pages per spec §9:

- `app/page.tsx` — Landing
- `app/explore/page.tsx` — Rankings (AUM, 24h)
- `app/basket/[pubkey]/page.tsx` — Detail + drift + fees + chart
- `app/basket/[pubkey]/buy/page.tsx` — Mint (in-kind + Zap USDC via Jupiter)
- `app/basket/[pubkey]/redeem/page.tsx` — Redeem (oracle-free, scaled preview)
- `app/create/page.tsx` — 6-step wizard (select → weights → fees → seed → legal → deploy)
- `app/creator/[pubkey]/page.tsx`, `app/portfolio/page.tsx`, `app/legal/page.tsx`

Wizard validates: 2-20 xStocks, weights sum 10k, fee caps (300/100/300), legal checkboxes `LEGAL_REVIEW_REQUIRED`.
Detail shows: NAV, share price, AUM, constituents, drift vs target, creator, fee schedule, history, redeem explainer.

Known gaps: buy/redeem/portfolio/legal are still scaffolded, wallet providers are not wired into the shell, backend basket data is empty/mock, strict TypeScript currently fails, and the local chart implementations use `@visx` behind a configured but not yet verified `@bklit` registry. Complete the plan gates before presenting executable transaction controls.
