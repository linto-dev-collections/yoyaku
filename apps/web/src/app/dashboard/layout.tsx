"use client";

import { Alert, AlertDescription } from "@yoyaku/ui/components/ui/alert";
import { Button } from "@yoyaku/ui/components/ui/button";
import { cn } from "@yoyaku/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

const NAV = [
  { href: "/dashboard/showings", label: "公演" },
  { href: "/dashboard/organization", label: "組織・メンバー" },
  { href: "/dashboard/connect", label: "Stripe Connect" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const pathname = usePathname();

  if (!isPending && !session) {
    return (
      <Alert>
        <AlertDescription className="space-y-2">
          <p>主催ダッシュボードの利用にはサインインが必要です。</p>
          <Button
            size="sm"
            onClick={() =>
              authClient.signIn.social({
                provider: "google",
                callbackURL: window.location.href,
              })
            }
          >
            Google でサインイン
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-[180px_1fr]">
      <nav
        className="flex flex-row gap-1 md:flex-col"
        aria-label="主催メニュー"
      >
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
