import { useState, type FormEvent } from "react";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { api, type Account, type Category } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { Card, CardHeader, Spinner, ErrorState, EmptyState, inputCls, btnPrimary, Badge } from "../components/ui";

interface Share {
  id: number; resource_type: "household" | "account" | "category"; resource_id: number | null;
  permission: "view" | "edit"; created_at: string; revoked_at: string | null;
  grantee_email: string; grantee_name: string; resource_name: string | null;
}
interface Member { id: number; name: string; email: string; role: string }
interface Activity {
  id: number; action: string; entity_type: string; entity_id: number | null;
  details: Record<string, unknown>; created_at: string; user_name: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  created: "created", updated: "updated", deleted: "deleted", shared: "shared",
  revoked_share: "revoked a share on", set_budget: "set a budget for",
  bulk_categorized: "bulk-categorized", split: "split", unsplit: "removed splits on",
  invited: "invited someone to", added_member: "added a member to", removed_member: "removed a member from",
  connected: "connected", disconnected: "disconnected", reconnected: "reconnected",
  synced: "synced", sync_failed: "failed to sync", contributed: "contributed to", merged: "merged",
};

export function SharingPage() {
  const { household, access, user } = useSession();
  const hid = household!.id;
  const isMember = access?.role !== "guest";
  const isOwner = access?.role === "owner";

  const info = useFetch<{ members: Member[] }>(`/api/households/${hid}`);
  const shares = useFetch<{ shares: Share[] }>(isMember ? `/api/households/${hid}/shares` : null);
  const activity = useFetch<{ activity: Activity[] }>(`/api/households/${hid}/activity?limit=60`);
  const accounts = useFetch<{ accounts: Account[] }>(`/api/households/${hid}/accounts`);
  const categories = useFetch<{ categories: Category[] }>(`/api/households/${hid}/categories`);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  // Share form state
  const [shareEmail, setShareEmail] = useState("");
  const [resourceType, setResourceType] = useState<"household" | "account" | "category">("household");
  const [resourceId, setResourceId] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [shareOk, setShareOk] = useState<string | null>(null);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    try {
      const res = await api.post<{ joined: boolean; message?: string }>(`/api/households/${hid}/invites`, { email: inviteEmail });
      setInviteMsg(res.joined ? "Added to the household ✓" : res.message ?? "Invite created");
      setInviteEmail("");
      info.reload();
    } catch (err) {
      setInviteMsg((err as Error).message);
    }
  }

  async function createShare(e: FormEvent) {
    e.preventDefault();
    setShareErr(null);
    setShareOk(null);
    try {
      await api.post(`/api/households/${hid}/shares`, {
        email: shareEmail,
        resource_type: resourceType,
        resource_id: resourceType === "household" ? null : Number(resourceId),
        permission,
      });
      setShareOk(`Shared with ${shareEmail} ✓`);
      setShareEmail("");
      shares.reload();
      activity.reload();
    } catch (err) {
      setShareErr((err as Error).message);
    }
  }

  async function revoke(id: number) {
    if (!confirm("Revoke this share? They will immediately lose access.")) return;
    await api.post(`/api/households/${hid}/shares/${id}/revoke`);
    shares.reload();
    activity.reload();
  }

  const activeShares = (shares.data?.shares ?? []).filter((s) => !s.revoked_at);
  const revokedShares = (shares.data?.shares ?? []).filter((s) => s.revoked_at);

  return (
    <>
      <PageHeader title="Sharing" sub="Everything is private until you explicitly share it" />

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          {/* Members */}
          <Card>
            <CardHeader title="Household members" sub="Members see and edit everything in the household" />
            <ul className="px-5 pb-3 divide-y divide-hairline">
              {(info.data?.members ?? []).map((m) => (
                <li key={m.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <div className="font-medium">{m.name}{m.id === user?.id && <span className="text-ink-3"> (you)</span>}</div>
                    <div className="text-xs text-ink-3">{m.email}</div>
                  </div>
                  <Badge tone={m.role === "owner" ? "blue" : "gray"}>{m.role}</Badge>
                </li>
              ))}
            </ul>
            {isOwner && (
              <form onSubmit={invite} className="px-5 pb-5 flex gap-2">
                <input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  className={inputCls} placeholder="Invite by email…" aria-label="Invite email" />
                <button type="submit" className={btnPrimary}>Invite</button>
              </form>
            )}
            {inviteMsg && <p className="px-5 pb-4 -mt-2 text-xs text-ink-2">{inviteMsg}</p>}
          </Card>

          {/* Shares */}
          {isMember && (
            <Card>
              <CardHeader title="Shared access" sub="Give someone outside the household a specific window in" />
              <div className="px-5 pb-5">
                <form onSubmit={createShare} className="space-y-3 rounded-xl border border-hairline p-4 mb-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input type="email" required value={shareEmail} onChange={(e) => setShareEmail(e.target.value)}
                      className={inputCls} placeholder="person@example.com" aria-label="Share with email" />
                    <select value={permission} onChange={(e) => setPermission(e.target.value as "view" | "edit")} className={inputCls} aria-label="Permission">
                      <option value="view">View only</option>
                      <option value="edit">View + edit</option>
                    </select>
                    <select value={resourceType}
                      onChange={(e) => { setResourceType(e.target.value as any); setResourceId(""); }}
                      className={inputCls} aria-label="What to share">
                      <option value="household">Entire household</option>
                      <option value="account">A single account</option>
                      <option value="category">A single category/budget</option>
                    </select>
                    {resourceType !== "household" && (
                      <select required value={resourceId} onChange={(e) => setResourceId(e.target.value)} className={inputCls} aria-label="Which one">
                        <option value="" disabled>Choose…</option>
                        {resourceType === "account"
                          ? (accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)
                          : (categories.data?.categories ?? []).filter((c) => !c.is_income).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                      </select>
                    )}
                  </div>
                  <button type="submit" className={btnPrimary}>Share</button>
                  {shareErr && <p className="text-sm text-neg-text">{shareErr}</p>}
                  {shareOk && <p className="text-sm text-pos-text">{shareOk}</p>}
                </form>

                {shares.loading && !shares.data ? <Spinner /> :
                 activeShares.length === 0 ? (
                  <p className="text-sm text-ink-3 text-center py-2">Nothing is shared right now.</p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {activeShares.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                        <div>
                          <div className="font-medium">{s.grantee_name} <span className="text-ink-3 font-normal">({s.grantee_email})</span></div>
                          <div className="text-xs text-ink-3 mt-0.5">
                            {s.resource_type === "household" ? "Entire household" : `${s.resource_type}: ${s.resource_name}`}
                            {" · "}
                            <Badge tone={s.permission === "edit" ? "amber" : "gray"}>{s.permission === "edit" ? "view + edit" : "view only"}</Badge>
                          </div>
                        </div>
                        <button onClick={() => revoke(s.id)} className="text-xs font-medium text-neg-text hover:opacity-80">Revoke</button>
                      </li>
                    ))}
                  </ul>
                )}
                {revokedShares.length > 0 && (
                  <p className="text-[11px] text-ink-3 mt-3">{revokedShares.length} revoked share{revokedShares.length === 1 ? "" : "s"} kept in the activity log.</p>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Activity log */}
        <Card className="h-fit">
          <CardHeader title="Activity log" sub="Who changed what — transparency for shared households" />
          {activity.loading && !activity.data ? <Spinner /> :
           activity.error ? <ErrorState message={activity.error} retry={activity.reload} /> :
           (activity.data?.activity.length ?? 0) === 0 ? (
            <EmptyState icon="📜" title="No activity yet" />
          ) : (
            <ul className="px-5 pb-5 space-y-3 max-h-[42rem] overflow-y-auto">
              {activity.data!.activity.map((a) => (
                <li key={a.id} className="text-sm flex gap-3">
                  <span className="text-ink-3 text-xs shrink-0 w-[5.5rem] tnum mt-0.5">
                    {new Date(a.created_at + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <span className="text-ink-2">
                    <span className="font-medium text-ink">{a.user_name ?? "System"}</span>{" "}
                    {ACTION_LABEL[a.action] ?? a.action} {a.entity_type.replace("_", " ")}
                    {a.details && typeof a.details.payee === "string" ? ` “${a.details.payee}”` : ""}
                    {a.details && typeof a.details.name === "string" ? ` “${a.details.name}”` : ""}
                    {a.details && typeof a.details.with === "string" ? ` with ${a.details.with} (${a.details.permission})` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
