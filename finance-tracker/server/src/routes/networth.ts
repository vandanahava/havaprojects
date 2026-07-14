import { Router } from "express";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { requireHousehold, canViewAccount, type HouseholdRequest } from "../lib/permissions.js";

export const networthRouter = Router({ mergeParams: true });
networthRouter.use(requireAuth);

const LIABILITY_TYPES = new Set(["credit", "loan"]);

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  net: number;
}

/** Core calculation, exported for tests. Carries each account's last known
 *  balance forward across the sampled dates. Liability balances are stored
 *  as positive amounts owed and subtracted from net worth. */
export function computeNetWorthSeries(
  accounts: { id: number; type: string }[],
  snapshots: { account_id: number; date: string; balance: number }[],
  dates: string[]
): NetWorthPoint[] {
  const byAccount = new Map<number, { date: string; balance: number }[]>();
  for (const s of snapshots) {
    if (!byAccount.has(s.account_id)) byAccount.set(s.account_id, []);
    byAccount.get(s.account_id)!.push(s);
  }
  for (const list of byAccount.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  return dates.map((date) => {
    let assets = 0;
    let liabilities = 0;
    for (const acct of accounts) {
      const snaps = byAccount.get(acct.id);
      if (!snaps) continue;
      let last: number | null = null;
      for (const s of snaps) {
        if (s.date <= date) last = s.balance;
        else break;
      }
      if (last === null) continue;
      if (LIABILITY_TYPES.has(acct.type)) liabilities += Math.abs(last);
      else assets += last;
    }
    return { date, assets: round2(assets), liabilities: round2(liabilities), net: round2(assets - liabilities) };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sampleDates(days: number): string[] {
  const step = days <= 35 ? 1 : days <= 100 ? 2 : days <= 200 ? 4 : 7;
  const out: string[] = [];
  const end = new Date();
  for (let i = days; i >= 0; i -= step) {
    const d = new Date(end.getTime() - i * 86400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  const todayStr = end.toISOString().slice(0, 10);
  if (out[out.length - 1] !== todayStr) out.push(todayStr);
  return out;
}

networthRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 180, 7), 3650);
  const db = getDb();
  let accounts = db
    .prepare("SELECT id, type FROM accounts WHERE household_id = ? AND archived = 0")
    .all(req.access!.householdId) as { id: number; type: string }[];
  if (!req.access!.full) accounts = accounts.filter((a) => canViewAccount(req.access!, a.id));
  if (accounts.length === 0) return res.json({ series: [], current: { assets: 0, liabilities: 0, net: 0 } });

  const ids = accounts.map((a) => a.id);
  const snapshots = db
    .prepare(
      `SELECT account_id, date, balance FROM balance_snapshots
       WHERE account_id IN (${ids.map(() => "?").join(",")}) ORDER BY date`
    )
    .all(...ids) as { account_id: number; date: string; balance: number }[];

  const series = computeNetWorthSeries(accounts, snapshots, sampleDates(days));
  const current = series[series.length - 1] ?? { assets: 0, liabilities: 0, net: 0 };
  res.json({ series, current });
});
