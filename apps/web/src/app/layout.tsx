import "@yoyaku/ui/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Yoyaku（予約）",
  description:
    "座席指定チケット予約システム（CQRS / Event Sourcing on Cloudflare）",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers>
          <SiteHeader />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
