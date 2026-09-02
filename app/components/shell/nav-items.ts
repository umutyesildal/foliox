/**
 * Header navigation model shared by the desktop nav and the mobile disclosure.
 * Paths are Next.js App Router routes owned by the page workers.
 */
export interface NavItem {
  href: string;
  label: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/stocks", label: "Stocks" },
  { href: "/etfs", label: "ETFs" },
  { href: "/explore", label: "Baskets" },
];

export const CONTEXT_ACTIONS: NavItem[] = [
  { href: "/create", label: "Create" },
  { href: "/portfolio", label: "Portfolio" },
];

/** Active-route check: exact for "/", prefix match for section routes. */
export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
