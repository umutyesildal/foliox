import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata = { title: "FolioX — Strategy Baskets on Solana", description: "Create an index. Own your thesis. Onchain strategy baskets powered by xStocks." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable)}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <a href="/" className="font-semibold tracking-tight">FolioX <span className="text-muted-foreground">· xStocks baskets</span></a>
            <nav className="flex gap-4 text-sm text-muted-foreground"><a href="/providers" className="hover:text-foreground">Providers</a><a href="/market" className="hover:text-foreground">Market</a><a href="/stock/TSLAx" className="hover:text-foreground">TSLAx</a><a href="/explore" className="hover:text-foreground">Explore</a><a href="/create" className="hover:text-foreground">Create</a><a href="/portfolio" className="hover:text-foreground">Portfolio</a></nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 py-10 text-xs text-muted-foreground">Not investment advice · xStocks are structured instruments · <a href="/legal" className="underline">Risks & Disclosures</a></footer>
      </body>
    </html>
  );
}
