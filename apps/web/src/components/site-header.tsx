"use client";

import { Button, buttonVariants } from "@yoyaku/ui/components/ui/button";
import { Skeleton } from "@yoyaku/ui/components/ui/skeleton";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

/** 共通ヘッダ。公開ナビ＋セッション状態（未ログインは Google サインイン誘導）。 */
export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="font-bold text-lg tracking-tight">
          Yoyaku
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            公演一覧
          </Link>
          <Link
            href="/me/tickets"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            マイチケット
          </Link>
          <Link
            href="/dashboard/showings"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            主催
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {isPending ? (
            <Skeleton className="h-8 w-24" />
          ) : session ? (
            <>
              <span className="hidden text-muted-foreground text-sm sm:inline">
                {session.user.name}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => authClient.signOut()}
              >
                サインアウト
              </Button>
            </>
          ) : (
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
          )}
        </div>
      </div>
    </header>
  );
}
