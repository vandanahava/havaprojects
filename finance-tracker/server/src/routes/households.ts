import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import {
  requireHousehold,
  requireMember,
  requireOwner,
  logActivity,
  type HouseholdRequest,
} from "../lib/permissions.js";
import { randomToken } from "../lib/crypto.js";

export const householdsRouter = Router();
householdsRouter.use(requireAuth);

const DEFAULT_CATEGORIES: [string, string, number][] = [
  ["Groceries", "🛒", 0], ["Dining Out", "🍽️", 0], ["Housing", "🏠", 0],
  ["Utilities", "💡", 0], ["Transportation", "🚗", 0], ["Health", "🩺", 0],
  ["Insurance", "🛡️", 0], ["Subscriptions", "📺", 0], ["Shopping", "🛍️", 0],
  ["Travel", "✈️", 0], ["Kids", "🧸", 0], ["Pets", "🐾", 0],
  ["Entertainment", "🎬", 0], ["Personal Care", "💇", 0], ["Gifts & Charity", "🎁", 0],
  ["Education", "🎓", 0], ["Fees", "🧾", 0], ["Other", "📁", 0],
  ["Salary", "💼", 1], ["Freelance", "🧑‍💻", 1], ["Interest & Dividends", "📈", 1],
  ["Other Income", "💵", 1],
];

householdsRouter.post("/", (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Household name required" });
  const db = getDb();
  const create = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO households (name, owner_id) VALUES (?, ?)")
      .run(parsed.data.name.trim(), req.user!.id);
    const hid = Number(info.lastInsertRowid);
    db.prepare(
      "INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')"
    ).run(hid, req.user!.id);
    const insCat = db.prepare(
      "INSERT INTO categories (household_id, name, icon, is_income) VALUES (?, ?, ?, ?)"
    );
    for (const [name, icon, isIncome] of DEFAULT_CATEGORIES) insCat.run(hid, name, icon, isIncome);
    return hid;
  });
  const hid = create();
  logActivity(hid, req.user!.id, "created", "household", hid, { name: parsed.data.name });
  res.status(201).json({ id: hid, name: parsed.data.name.trim() });
});

householdsRouter.get("/:householdId", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const db = getDb();
  const hh = db
    .prepare("SELECT id, name, currency, locale, owner_id FROM households WHERE id = ?")
    .get(req.access!.householdId);
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email, hm.role FROM household_members hm
       JOIN users u ON u.id = hm.user_id WHERE hm.household_id = ?`
    )
    .all(req.access!.householdId);
  res.json({ household: hh, members, access: req.access });
});

householdsRouter.patch(
  "/:householdId",
  requireHousehold("edit"),
  requireOwner,
  (req: HouseholdRequest, res) => {
    const parsed = z
      .object({
        name: z.string().min(1).max(100).optional(),
        currency: z.string().length(3).optional(),
        locale: z.string().min(2).max(20).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings" });
    const db = getDb();
    const { name, currency, locale } = parsed.data;
    if (name) db.prepare("UPDATE households SET name = ? WHERE id = ?").run(name.trim(), req.access!.householdId);
    if (currency)
      db.prepare("UPDATE households SET currency = ? WHERE id = ?").run(currency.toUpperCase(), req.access!.householdId);
    if (locale) db.prepare("UPDATE households SET locale = ? WHERE id = ?").run(locale, req.access!.householdId);
    logActivity(req.access!.householdId, req.user!.id, "updated", "household", req.access!.householdId, parsed.data);
    res.json({ ok: true });
  }
);

// ── Invites ──────────────────────────────────────────────────────────────
householdsRouter.post(
  "/:householdId/invites",
  requireHousehold("edit"),
  requireOwner,
  (req: HouseholdRequest, res) => {
    const parsed = z.object({ email: z.string().email().max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Valid email required" });
    const db = getDb();
    const email = parsed.data.email;
    // If the user already exists, add them directly as a member.
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
      | { id: number }
      | undefined;
    if (existing) {
      db.prepare(
        "INSERT OR IGNORE INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')"
      ).run(req.access!.householdId, existing.id);
      logActivity(req.access!.householdId, req.user!.id, "added_member", "user", existing.id, { email });
      return res.status(201).json({ joined: true });
    }
    const token = randomToken(16);
    db.prepare(
      "INSERT INTO invites (household_id, email, token, invited_by) VALUES (?, ?, ?, ?)"
    ).run(req.access!.householdId, email, token, req.user!.id);
    logActivity(req.access!.householdId, req.user!.id, "invited", "invite", null, { email });
    // In production this would send an email; locally we return the signup hint.
    res.status(201).json({ joined: false, inviteToken: token, message: `Invite created. ${email} will join automatically when they sign up.` });
  }
);

householdsRouter.get(
  "/:householdId/invites",
  requireHousehold("view"),
  requireMember,
  (req: HouseholdRequest, res) => {
    const invites = getDb()
      .prepare(
        "SELECT id, email, status, created_at FROM invites WHERE household_id = ? ORDER BY created_at DESC"
      )
      .all(req.access!.householdId);
    res.json({ invites });
  }
);

householdsRouter.delete(
  "/:householdId/members/:userId",
  requireHousehold("edit"),
  requireOwner,
  (req: HouseholdRequest, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "Bad user id" });
    if (userId === req.user!.id)
      return res.status(400).json({ error: "Owner cannot remove themselves" });
    getDb()
      .prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ? AND role != 'owner'")
      .run(req.access!.householdId, userId);
    logActivity(req.access!.householdId, req.user!.id, "removed_member", "user", userId);
    res.json({ ok: true });
  }
);
