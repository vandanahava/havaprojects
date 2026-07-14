import { Link, useParams } from "react-router-dom";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import type { Txn } from "../lib/api";
import { fmtDateShort, fmtMoney } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Card, CardHeader, Money, Spinner, ErrorState, EmptyState, Badge } from "../components/ui";
import { BalanceChart } from "../components/charts";

interface AccountFull {
  id: number; name: string; type: string; source: string; institution_name: string | null;
  current_balance: number;
}

export function AccountDetailPage() {
  const { household } = useSession();
  const { accountId } = useParams();
  const hid = household!.id;
  const detail = useFetch<{ account: AccountFull; history: { date: string; balance: number }[] }>(
    `/api/households/${hid}/accounts/${accountId}`
  );
  const txns = useFetch<{ transactions: Txn[]; total: number }>(
    `/api/households/${hid}/transactions?account_id=${accountId}&limit=50`
  );

  if (detail.loading && !detail.data) return <Spinner label="Loading account…" />;
  if (detail.error) return <Card><ErrorState message={detail.error} retry={detail.reload} /></Card>;
  const account = detail.data!.account;
  const isLiability = account.type === "credit" || account.type === "loan";

  return (
    <>
      <div className="mb-4">
        <Link to="/accounts" className="text-xs text-ink-3 hover:text-accent">← All accounts</Link>
      </div>
      <PageHeader
        title={account.name}
        sub={account.source === "plaid"
          ? `Connected via ${account.institution_name || "bank"}`
          : `Manual account${account.institution_name ? ` · ${account.institution_name}` : ""}`}
        right={
          <div className="text-right">
            <div className="text-xs text-ink-3">{isLiability ? "Amount owed" : "Balance"}</div>
            <div className="tnum text-2xl font-semibold">
              {fmtMoney(account.current_balance)}
            </div>
          </div>
        }
      />

      <Card className="mb-5">
        <CardHeader title="Balance history" right={
          account.source === "plaid" ? <Badge tone="blue">synced via Plaid</Badge> : <Badge tone="gray">Manual</Badge>
        } />
        <div className="px-2 pb-3">
          {detail.data!.history.length < 2 ? (
            <EmptyState icon="📈" title="Not enough history yet"
              body="Balance snapshots build up as you update the balance or sync." />
          ) : (
            <BalanceChart history={detail.data!.history} liability={isLiability} />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Transactions" sub={txns.data ? `${txns.data.total} total` : undefined} />
        <div className="px-2 pb-3">
          {txns.loading && !txns.data ? <Spinner /> :
           txns.error ? <ErrorState message={txns.error} retry={txns.reload} /> :
           (txns.data?.transactions.length ?? 0) === 0 ? (
            <EmptyState icon="⇄" title="No transactions in this account" />
          ) : (
            <ul>
              {txns.data!.transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-page transition">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg shrink-0" aria-hidden>{t.category_icon ?? "💳"}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{t.payee || "(no payee)"}</div>
                      <div className="text-xs text-ink-3">{fmtDateShort(t.date)}{t.category_name ? ` · ${t.category_name}` : ""}</div>
                    </div>
                  </div>
                  <Money value={t.amount} sign colored className="text-sm font-medium shrink-0" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
