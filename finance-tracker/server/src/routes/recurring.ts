import { Router } from "express";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { requireHousehold, txnVisibilityFilter, type HouseholdRequest } from "../lib/permissions.js";

export const recurringRouter = Router({ mergeParams: true });
recurringRouter.use(requireAuth);

interface TxnLite {
  date: string;
  amount: number;
  payee: string;
  account_id: number;
  category_id: number | null;
}

export interface DetectedRecurring {
  payee: string;
  frequency: "weekly" | "biweekly" | "monthly" | "yearly";
  avg_amount: number;
  last_date: string;
  next_due: string;
  account_id: number;
  category_id: number | null;
  occurrences: number;
}

const FREQ_DAYS: Record<DetectedRecurring["frequency"], number> = {
  weekly: 7, biweekly: 14, monthly: 30, yearly: 365,
};

function classifyInterval(days: number): DetectedRecurring["frequency"] | null {
  if (days >= 5 && days <= 9) return "weekly";
  if (days >= 12 && days <= 16) return "biweekly";
  if (days >= 26 && days <= 35) return "monthly";
  if (days >= 350 && days <= 380) return "yearly";
  return null;
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Detect recurring outflows: ≥3 occurrences of the same payee at a
 *  consistent interval with amounts within 25% of the median. Exported for tests. */
export function detectRecurring(txns: TxnLite[]): DetectedRecurring[] {
  const groups = new Map<string, TxnLite[]>();
  for (const t of txns) {
    if (t.amount >= 0 || !t.payee.trim()) continue;
    const key = t.payee.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const out: DetectedRecurring[] = [];
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = list.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const consistentAmounts = list.filter((t) => Math.abs(Math.abs(t.amount) - median) <= median * 0.25);
    if (consistentAmounts.length < 3) continue;

    const intervals: number[] = [];
    for (let i = 1; i < consistentAmounts.length; i++) {
      const d1 = new Date(consistentAmounts[i - 1].date).getTime();
      const d2 = new Date(consistentAmounts[i].date).getTime();
      intervals.push(Math.round((d2 - d1) / 86400_000));
    }
    const freqs = intervals.map(classifyInterval);
    const counts = new Map<string, number>();
    for (const f of freqs) if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    let best: DetectedRecurring["frequency"] | null = null;
    let bestCount = 0;
    for (const [f, c] of counts) if (c > bestCount) { best = f as DetectedRecurring["frequency"]; bestCount = c; }
    // Majority of intervals must match the detected frequency
    if (!best || bestCount < Math.ceil(intervals.length * 0.6)) continue;

    const last = consistentAmounts[consistentAmounts.length - 1];
    const avg = consistentAmounts.reduce((s, t) => s + Math.abs(t.amount), 0) / consistentAmounts.length;
    out.push({
      payee: last.payee.trim(),
      frequency: best,
      avg_amount: Math.round(avg * 100) / 100,
      last_date: last.date,
      next_due: addDays(last.date, FREQ_DAYS[best]),
      account_id: last.account_id,
      category_id: last.category_id,
      occurrences: consistentAmounts.length,
    });
  }
  return out.sort((a, b) => a.next_due.localeCompare(b.next_due));
}

/** Re-detect and upsert, then return the recurring list. */
recurringRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const db = getDb();
  const vis = txnVisibilityFilter(req.access!);
  const since = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
  const txns = db
    .prepare(
      `SELECT t.date, t.amount, t.payee, t.account_id, t.category_id FROM transactions t
       WHERE t.household_id = ? AND t.date >= ? ${vis.sql} ORDER BY t.date`
    )
    .all(req.access!.householdId, since, ...vis.params) as TxnLite[];
  const detected = detectRecurring(txns);
  const upsert = db.transaction(() => {
    for (const r of detected) {
      db.prepare(
        `INSERT INTO recurring_items (household_id, payee, account_id, category_id, avg_amount, frequency, last_date, next_due)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(household_id, payee, frequency) DO UPDATE SET
           avg_amount = excluded.avg_amount, last_date = excluded.last_date,
           next_due = excluded.next_due, account_id = excluded.account_id,
           category_id = excluded.category_id`
      ).run(
        req.access!.householdId, r.payee, r.account_id, r.category_id,
        r.avg_amount, r.frequency, r.last_date, r.next_due
      );
    }
  });
  upsert();
  const rows = db
    .prepare(
      `SELECT ri.*, c.name as category_name, c.icon as category_icon, a.name as account_name
       FROM recurring_items ri
       LEFT JOIN categories c ON c.id = ri.category_id
       LEFT JOIN accounts a ON a.id = ri.account_id
       WHERE ri.household_id = ? AND ri.dismissed = 0 ORDER BY ri.next_due`
    )
    .all(req.access!.householdId);
  res.json({ recurring: rows });
});

recurringRouter.post("/:recurringId/dismiss", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.recurringId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const info = getDb()
    .prepare("UPDATE recurring_items SET dismissed = 1 WHERE id = ? AND household_id = ?")
    .run(id, req.access!.householdId);
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
