import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  requireHousehold,
  canViewAccount,
  canEditAccount,
  logActivity,
  type HouseholdRequest,
} from "../lib/permissions.js";

export const accountsRouter = Router({ mergeParams: true });
accountsRouter.use(requireAuth);

const LIABILITY_TYPES = new Set(["credit", "loan"]);

const accountSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["checking", "savings", "credit", "loan", "investment", "cash", "property"]),
  balance: z.number().finite(),
  institution_name: z.string().max(100).optional(),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function snapshotBalance(accountId: number, balance: number, date?: string) {
  getDb()
    .prepare(
      `INSERT INTO balance_snapshots (account_id, date, balance) VALUES (?, ?, ?)
       ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance`
    )
    .run(accountId, date ?? today(), balance);
}

accountsRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const db = getDb();
  let rows = db
    .prepare(
      `SELECT a.*, pi.status as plaid_status FROM accounts a
       LEFT JOIN plaid_items pi ON pi.id = a.plaid_item_id
       WHERE a.household_id = ? AND a.archived = 0 ORDER BY a.type, a.name`
    )
    .all(req.access!.householdId) as any[];
  if (!req.access!.full) {
    rows = rows.filter((r) => canViewAccount(req.access!, r.id));
  }
  res.json({
    accounts: rows.map((r) => ({ ...r, is_liability: LIABILITY_TYPES.has(r.type) })),
  });
});

accountsRouter.post("/", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  if (req.access!.role === "guest")
    return res.status(403).json({ error: "Only household members can add accounts" });
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid account" });
  const { name, type, balance, institution_name } = parsed.data;
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO accounts (household_id, name, type, source, institution_name, current_balance)
       VALUES (?, ?, ?, 'manual', ?, ?)`
    )
    .run(req.access!.householdId, name.trim(), type, institution_name?.trim() ?? null, balance);
  const id = Number(info.lastInsertRowid);
  snapshotBalance(id, balance);
  logActivity(req.access!.householdId, req.user!.id, "created", "account", id, { name, type });
  res.status(201).json({ id });
});

accountsRouter.get("/:accountId", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.accountId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad account id" });
  if (!canViewAccount(req.access!, id)) return res.status(404).json({ error: "Account not found" });
  const db = getDb();
  const account = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  const history = db
    .prepare("SELECT date, balance FROM balance_snapshots WHERE account_id = ? ORDER BY date")
    .all(id);
  res.json({ account, history });
});

accountsRouter.patch("/:accountId", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.accountId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad account id" });
  if (!canEditAccount(req.access!, id)) return res.status(403).json({ error: "No edit access to this account" });
  const parsed = z
    .object({
      name: z.string().min(1).max(100).optional(),
      balance: z.number().finite().optional(),
      institution_name: z.string().max(100).optional(),
      archived: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const db = getDb();
  const existing = db
    .prepare("SELECT id, source FROM accounts WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId) as { id: number; source: string } | undefined;
  if (!existing) return res.status(404).json({ error: "Account not found" });
  const { name, balance, institution_name, archived } = parsed.data;
  if (balance !== undefined && existing.source === "plaid")
    return res.status(400).json({ error: "Connected account balances update via sync" });
  if (name) db.prepare("UPDATE accounts SET name = ? WHERE id = ?").run(name.trim(), id);
  if (institution_name !== undefined)
    db.prepare("UPDATE accounts SET institution_name = ? WHERE id = ?").run(institution_name.trim(), id);
  if (archived !== undefined)
    db.prepare("UPDATE accounts SET archived = ? WHERE id = ?").run(archived ? 1 : 0, id);
  if (balance !== undefined) {
    db.prepare("UPDATE accounts SET current_balance = ? WHERE id = ?").run(balance, id);
    snapshotBalance(id, balance);
  }
  logActivity(req.access!.householdId, req.user!.id, "updated", "account", id, parsed.data);
  res.json({ ok: true });
});

accountsRouter.delete("/:accountId", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.accountId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad account id" });
  if (req.access!.role === "guest")
    return res.status(403).json({ error: "Only household members can delete accounts" });
  const db = getDb();
  const existing = db
    .prepare("SELECT id, name FROM accounts WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId) as { id: number; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "Account not found" });
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  logActivity(req.access!.householdId, req.user!.id, "deleted", "account", id, { name: existing.name });
  res.json({ ok: true });
});
