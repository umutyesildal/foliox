/**
 * Demo overlay flag — pages render labeled demo datasets instead of live API
 * data; flag off = real data only.
 *
 * With `NEXT_PUBLIC_HOME_DEMO=1`, demo surfaces (the home live-proof band and
 * the /feed page) render the static, clearly-chipped datasets from
 * `components/home/home-demo-data.ts`. Demo mode must never touch the
 * network: no fetches, no polling, no auth prompts, no write endpoints —
 * every API-hitting affordance is disabled behind the same gate. When the
 * flag is off, the datasets are tree-shakeable dead weight and every page
 * takes its usual real-data path untouched.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_HOME_DEMO === "1";
}
