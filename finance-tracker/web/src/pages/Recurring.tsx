import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Card, CardHeader, Spinner, ErrorState, EmptyState, Badge } from "../components/ui";

interface RecurringItem {
  id: number; payee: string; avg_amount: number; frequency: string;
  last_date: string; next_due: string; category_name: string | null;
  category_icon: string | null; account_name: string | null;
}

export function RecurringPage() {
  const { household, access } = useSession();
  const hid = household!.id;
  const canEdit = access?.permission === "edit";
  const data = useFetch<{ recurring: RecurringItem[] }>(`/api/households/${hid}/recurring`);

  const items = data.data?.recurring ?? [];
  const monthlyTotal = items.reduce((s, r) => {
    const perMonth = r.frequency === "weekly" ? r.avg_amount * 4.33
      : r.frequency === "biweekly" ? r.avg_amount * 2.17
      : r.frequency === "yearly" ? r.avg_amount / 12
      : r.avg_amount;
    return s + perMonth;
  }, 0);

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  async function dismiss(id: number) {
    await api.post(`/api/households/${hid}/recurring/${id}/dismiss`);
    data.reload();
  }

  return (
    <>
      <PageHeader
        title="Recurring bills"
        sub="Detected automatically from repeated transactions"
        right={
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-ink-3">≈ Monthly total</div>
            <div className="tnum text-xl font-semibold">{fmtMoney(monthlyTotal, { cents: false })}</div>
          </div>
        }
      />
      <Card>
        <CardHeader title="Upcoming" sub={items.length ? `${items.length} recurring bills detected` : undefined} />
        {data.loading && !data.data ? <Spinner /> :
         data.error ? <ErrorState message={data.error} retry={data.reload} /> :
         items.length === 0 ? (
          <EmptyState icon="↻" title="No recurring bills detected yet"
            body="Once the same payee shows up 3+ times at a steady interval (weekly, monthly, yearly), it appears here with its next due date." />
        ) : (
          <ul className="px-5 pb-4 divide-y divide-hairline">
            {items.map((r) => {
              const dueSoon = r.next_due >= today && r.next_due <= soon;
              const overdue = r.next_due < today;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0" aria-hidden>{r.category_icon ?? "🧾"}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                        {r.payee}
                        <Badge tone="gray">{r.frequency}</Badge>
                        {overdue && <Badge tone="red">past due</Badge>}
                        {dueSoon && <Badge tone="amber">due soon</Badge>}
                      </div>
                      <div className="text-xs text-ink-3 mt-0.5">
                        next due {fmtDate(r.next_due)} · last paid {fmtDate(r.last_date)}
                        {r.account_name ? ` · ${r.account_name}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="tnum text-sm font-semibold">{fmtMoney(r.avg_amount)}</span>
                    {canEdit && (
                      <button onClick={() => dismiss(r.id)} className="text-xs text-ink-3 hover:text-neg-text">
                        Not recurring
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
