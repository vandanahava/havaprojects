import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthedRequest, SESSION_COOKIE } from "../lib/auth.js";
import { requireHousehold, requireMember, type HouseholdRequest } from "../lib/permissions.js";

export const settingsRouter = Router({ mergeParams: true });
settingsRouter.use(requireAuth);

/** Full JSON export of a household's data (members only). Plaid access
 *  tokens are never included. */
settingsRouter.get(
  "/households/:householdId/export.json",
  requireHousehold("view"),
  requireMember,
  (req: HouseholdRequest, res) => {
    const db = getDb();
    const hid = req.access!.householdId;
    const grab = (sql: string) => db.prepare(sql).all(hid);
    const data = {
      exported_at: new Date().toISOString(),
      household: db.prepare("SELECT id, name, currency, locale, created_at FROM households WHERE id = ?").get(hid),
      accounts: grab("SELECT id, name, type, source, institution_name, current_balance, currency, archived, created_at FROM accounts WHERE household_id = ?"),
      balance_history: db
        .prepare(
          `SELECT bs.account_id, bs.date, bs.balance FROM balance_snapshots bs
           JOIN accounts a ON a.id = bs.account_id WHERE a.household_id = ? ORDER BY bs.date`
        )
        .all(hid),
      categories: grab("SELECT id, name, icon, is_income, archived FROM categories WHERE household_id = ?"),
      transactions: grab(
        "SELECT id, account_id, category_id, date, amount, payee, notes, pending, created_at FROM transactions WHERE household_id = ?"
      ),
      splits: db
        .prepare(
          `SELECT sp.* FROM transaction_splits sp JOIN transactions t ON t.id = sp.transaction_id WHERE t.household_id = ?`
        )
        .all(hid),
      budgets: grab("SELECT id, category_id, month, amount, rollover FROM budgets WHERE household_id = ?"),
      goals: grab("SELECT id, name, target_amount, target_date, saved_amount, created_at FROM goals WHERE household_id = ?"),
      tags: grab("SELECT id, name FROM tags WHERE household_id = ?"),
      shares: grab(
        "SELECT id, resource_type, resource_id, grantee_user_id, permission, created_at, revoked_at FROM shares WHERE household_id = ?"
      ),
      activity: grab(
        "SELECT id, user_id, action, entity_type, entity_id, details, created_at FROM activity_log WHERE household_id = ?"
      ),
    };
    res.setHeader("Content-Disposition", `attachment; filename="hearthledger-export.json"`);
    res.json(data);
  }
);

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Full CSV export (transactions with resolved names). */
settingsRouter.get(
  "/households/:householdId/export.csv",
  requireHousehold("view"),
  requireMember,
  (req: HouseholdRequest, res) => {
    const rows = getDb()
      .prepare(
        `SELECT t.date, t.payee, t.amount, c.name as category, a.name as account, t.notes, t.pending
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.household_id = ? ORDER BY t.date`
      )
      .all(req.access!.householdId) as any[];
    const header = "date,payee,amount,category,account,notes,pending";
    const lines = rows.map((r) =>
      [r.date, r.payee, r.amount, r.category ?? "", r.account, r.notes, r.pending].map(csvEscape).join(",")
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="hearthledger-transactions.csv"`);
    res.send([header, ...lines].join("\n"));
  }
);

/** Delete the signed-in user's account. Requires password confirmation.
 *  Households they own are deleted entirely (cascades); memberships and
 *  shares elsewhere are removed. */
settingsRouter.post("/account/delete", async (req: AuthedRequest, res) => {
  const parsed = z.object({ password: z.string().min(1), confirm: z.literal("DELETE") }).safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Password and confirm: "DELETE" are required' });
  const db = getDb();
  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ?")
    .get(req.user!.id) as { id: number; password_hash: string };
  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect password" });
  const run = db.transaction(() => {
    const owned = db.prepare("SELECT id FROM households WHERE owner_id = ?").all(user.id) as { id: number }[];
    for (const h of owned) db.prepare("DELETE FROM households WHERE id = ?").run(h.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  });
  run();
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});
