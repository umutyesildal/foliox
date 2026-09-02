import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";
import { AppProviders } from "./providers";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const geistMono = Geist_Mono({subsets:['latin'],variable:'--font-mono'});

export const metadata = { title: "FolioX — Strategy Baskets on Solana", description: "Create an index. Own your thesis. Onchain strategy baskets powered by xStocks." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable, geistMono.variable)}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppProviders>
          <div className="flex min-h-screen flex-col">
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
            >
              Skip to content
            </a>
            <SiteHeader />
            <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
              {children}
            </main>
            <SiteFooter />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
