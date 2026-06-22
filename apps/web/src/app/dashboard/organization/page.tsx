"use client";

import { Button } from "@yoyaku/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@yoyaku/ui/components/ui/card";
import { Input } from "@yoyaku/ui/components/ui/input";
import { Label } from "@yoyaku/ui/components/ui/label";
import { Separator } from "@yoyaku/ui/components/ui/separator";
import { toast } from "@yoyaku/ui/components/ui/sonner";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function OrganizationPage() {
  const { data: orgs } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const [busy, setBusy] = useState(false);

  async function createOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const slug = String(form.get("slug") ?? "").trim();
    if (!name || !slug) return;
    setBusy(true);
    const res = await authClient.organization.create({ name, slug });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? "組織の作成に失敗しました。");
      return;
    }
    await authClient.organization.setActive({ organizationId: res.data.id });
    toast.success("組織を作成しました。");
  }

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!active) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "member") as "member" | "admin";
    if (!email) return;
    setBusy(true);
    const res = await authClient.organization.inviteMember({
      email,
      role,
      organizationId: active.id,
    });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? "招待に失敗しました。");
      return;
    }
    toast.success(`${email} を招待しました（招待リンクを共有してください）。`);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-bold text-2xl tracking-tight">組織・メンバー</h1>

      <Card>
        <CardHeader>
          <CardTitle>所属組織</CardTitle>
          <CardDescription>
            操作対象（有効な組織）を切り替えられます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(orgs ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              所属している組織がありません。下のフォームから作成してください。
            </p>
          ) : (
            (orgs ?? []).map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="text-sm">
                  {o.name}
                  {active?.id === o.id && (
                    <span className="ml-2 text-muted-foreground text-xs">
                      （有効）
                    </span>
                  )}
                </span>
                {active?.id !== o.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      authClient.organization.setActive({
                        organizationId: o.id,
                      })
                    }
                  >
                    有効にする
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>新しい組織を作成</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createOrg} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="org-name">組織名</Label>
              <Input id="org-name" name="name" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-slug">スラッグ（URL 用・半角英数）</Label>
              <Input id="org-slug" name="slug" pattern="[a-z0-9-]+" required />
            </div>
            <Button type="submit" disabled={busy}>
              作成する
            </Button>
          </form>
        </CardContent>
      </Card>

      {active && (
        <Card>
          <CardHeader>
            <CardTitle>メンバー（{active.name}）</CardTitle>
            <CardDescription>
              admin 以上は公演を管理できます。招待はメール＋リンクで運用します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              {(active.members ?? []).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span>{m.user?.email ?? m.userId}</span>
                  <span className="text-muted-foreground text-xs">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
            <Separator />
            <form onSubmit={invite} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="invite-email">招待するメールアドレス</Label>
                <Input id="invite-email" name="email" type="email" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-role">ロール</Label>
                <select
                  id="invite-role"
                  name="role"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  defaultValue="member"
                >
                  <option value="member">member（閲覧）</option>
                  <option value="admin">admin（公演管理）</option>
                </select>
              </div>
              <Button type="submit" disabled={busy}>
                招待する
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
