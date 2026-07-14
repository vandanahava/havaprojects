import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  requireHousehold,
  requireMember,
  logActivity,
  type HouseholdRequest,
} from "../lib/permissions.js";

export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireAuth);

categoriesRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const includeArchived = req.query.archived === "1";
  const rows = getDb()
    .prepare(
      `SELECT id, name, icon, is_income, archived FROM categories
       WHERE household_id = ? ${includeArchived ? "" : "AND archived = 0"} ORDER BY is_income, name`
    )
    .all(req.access!.householdId);
  res.json({ categories: rows });
});

const catSchema = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().max(10).optional(),
  is_income: z.boolean().optional(),
});

categoriesRouter.post("/", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const parsed = catSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid category" });
  const { name, icon, is_income } = parsed.data;
  const db = getDb();
  const dupe = db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .get(req.access!.householdId, name.trim());
  if (dupe) return res.status(409).json({ error: "A category with that name exists" });
  const info = db
    .prepare("INSERT INTO categories (household_id, name, icon, is_income) VALUES (?, ?, ?, ?)")
    .run(req.access!.householdId, name.trim(), icon ?? "📁", is_income ? 1 : 0);
  logActivity(req.access!.householdId, req.user!.id, "created", "category", Number(info.lastInsertRowid), { name });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

categoriesRouter.patch("/:categoryId", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const id = Number(req.params.categoryId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const parsed = z
    .object({ name: z.string().min(1).max(60).optional(), icon: z.string().max(10).optional(), archived: z.boolean().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const db = getDb();
  const cat = db
    .prepare("SELECT id FROM categories WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId);
  if (!cat) return res.status(404).json({ error: "Category not found" });
  const { name, icon, archived } = parsed.data;
  if (name) db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name.trim(), id);
  if (icon) db.prepare("UPDATE categories SET icon = ? WHERE id = ?").run(icon, id);
  if (archived !== undefined) db.prepare("UPDATE categories SET archived = ? WHERE id = ?").run(archived ? 1 : 0, id);
  logActivity(req.access!.householdId, req.user!.id, "updated", "category", id, parsed.data);
  res.json({ ok: true });
});

/** Merge source category into target: retag transactions, splits, budgets, then archive source. */
categoriesRouter.post("/:categoryId/merge", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const sourceId = Number(req.params.categoryId);
  const parsed = z.object({ target_id: z.number().int() }).safeParse(req.body);
  if (!Number.isInteger(sourceId) || !parsed.success) return res.status(400).json({ error: "Bad request" });
  const targetId = parsed.data.target_id;
  if (sourceId === targetId) return res.status(400).json({ error: "Cannot merge a category into itself" });
  const db = getDb();
  const both = db
    .prepare("SELECT COUNT(*) as n FROM categories WHERE id IN (?, ?) AND household_id = ?")
    .get(sourceId, targetId, req.access!.householdId) as { n: number };
  if (both.n !== 2) return res.status(404).json({ error: "Category not found" });
  const run = db.transaction(() => {
    db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ? AND household_id = ?")
      .run(targetId, sourceId, req.access!.householdId);
    db.prepare("UPDATE transaction_splits SET category_id = ? WHERE category_id = ?").run(targetId, sourceId);
    db.prepare("DELETE FROM budgets WHERE category_id = ? AND household_id = ?").run(sourceId, req.access!.householdId);
    db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(sourceId);
  });
  run();
  logActivity(req.access!.householdId, req.user!.id, "merged", "category", sourceId, { into: targetId });
  res.json({ ok: true });
});
