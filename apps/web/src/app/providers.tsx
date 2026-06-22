"use client";

import { Toaster } from "@yoyaku/ui/components/ui/sonner";
import { TooltipProvider } from "@yoyaku/ui/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/** アプリ全体のクライアントプロバイダ（テーマ・ツールチップ・トースト）。 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  );
}
