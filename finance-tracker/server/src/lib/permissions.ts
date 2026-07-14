import type { Response, NextFunction } from "express";
import { getDb } from "./db.js";
import type { AuthedRequest } from "./auth.js";

/**
 * Access resolution. A user can reach household data through:
 *  1. Membership (owner/member row in household_members) → full edit access.
 *  2. An active (non-revoked) share:
 *     - household-level share → view or edit on everything
 *     - account-level share  → scoped to that account (+ its transactions)
 *     - category-level share → scoped to that category (budget + transactions)
 * Sharing defaults to private: no rows ⇒ no access.
 */
export interface Access {
  householdId: number;
  role: "owner" | "member" | "guest";
  permission: "edit" | "view";
  full: boolean; // true = whole household visible
  accountIds: number[]; // scoped account ids (when !full)
  categoryIds: number[]; // scoped category ids (when !full)
  editableAccountIds: number[] | "all";
  editableCategoryIds: number[] | "all";
}

export function resolveAccess(userId: number, householdId: number): Access | null {
  const db = getDb();
  const member = db
    .prepare("SELECT role FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(householdId, userId) as { role: "owner" | "member" } | undefined;
  if (member) {
    return {
      householdId,
      role: member.role,
      permission: "edit",
      full: true,
      accountIds: [],
      categoryIds: [],
      editableAccountIds: "all",
      editableCategoryIds: "all",
    };
  }
  const shares = db
    .prepare(
      `SELECT resource_type, resource_id, permission FROM shares
       WHERE household_id = ? AND grantee_user_id = ? AND revoked_at IS NULL`
    )
    .all(householdId, userId) as {
    resource_type: "household" | "account" | "category";
    resource_id: number | null;
    permission: "view" | "edit";
  }[];
  if (shares.length === 0) return null;

  const hhShare = shares.find((s) => s.resource_type === "household");
  const accountIds: number[] = [];
  const categoryIds: number[] = [];
  const editableAccountIds: number[] = [];
  const editableCategoryIds: number[] = [];
  for (const s of shares) {
    if (s.resource_type === "account" && s.resource_id != null) {
      accountIds.push(s.resource_id);
      if (s.permission === "edit") editableAccountIds.push(s.resource_id);
    }
    if (s.resource_type === "category" && s.resource_id != null) {
      categoryIds.push(s.resource_id);
      if (s.permission === "edit") editableCategoryIds.push(s.resource_id);
    }
  }
  const anyEdit = shares.some((s) => s.permission === "edit");
  return {
    householdId,
    role: "guest",
    permission: anyEdit ? "edit" : "view",
    full: !!hhShare,
    accountIds,
    categoryIds,
    editableAccountIds: hhShare?.permission === "edit" ? "all" : editableAccountIds,
    editableCategoryIds: hhShare?.permission === "edit" ? "all" : editableCategoryIds,
  };
}

export interface HouseholdRequest extends AuthedRequest {
  access?: Access;
}

/** Middleware factory: resolves :householdId and enforces minimum permission. */
export function requireHousehold(minPerm: "view" | "edit" = "view") {
  return (req: HouseholdRequest, res: Response, next: NextFunction) => {
    const householdId = Number(req.params.householdId);
    if (!Number.isInteger(householdId)) return res.status(400).json({ error: "Bad household id" });
    const access = resolveAccess(req.user!.id, householdId);
    if (!access) return res.status(404).json({ error: "Household not found" });
    if (minPerm === "edit") {
      const canEditAnything =
        access.permission === "edit" &&
        (access.editableAccountIds === "all" ||
          access.editableAccountIds.length > 0 ||
          access.editableCategoryIds === "all" ||
          access.editableCategoryIds.length > 0 ||
          access.role !== "guest");
      if (!canEditAnything) return res.status(403).json({ error: "View-only access" });
    }
    req.access = access;
    next();
  };
}

/** Can this access see the given account? */
export function canViewAccount(access: Access, accountId: number): boolean {
  return access.full || access.accountIds.includes(accountId);
}

/** Can this access edit the given account (and its transactions)? */
export function canEditAccount(access: Access, accountId: number): boolean {
  if (access.editableAccountIds === "all") return true;
  return access.editableAccountIds.includes(accountId);
}

export function canViewCategory(access: Access, categoryId: number): boolean {
  return access.full || access.categoryIds.includes(categoryId);
}

export function canEditCategory(access: Access, categoryId: number): boolean {
  if (access.editableCategoryIds === "all") return true;
  return access.editableCategoryIds.includes(categoryId);
}

/** Members only (not shared guests) — e.g. settings, sharing management. */
export function requireMember(req: HouseholdRequest, res: Response, next: NextFunction) {
  if (!req.access || req.access.role === "guest")
    return res.status(403).json({ error: "Household members only" });
  next();
}

/** Owner only — e.g. deleting the household, managing members. */
export function requireOwner(req: HouseholdRequest, res: Response, next: NextFunction) {
  if (!req.access || req.access.role !== "owner")
    return res.status(403).json({ error: "Household owner only" });
  next();
}

export function logActivity(
  householdId: number,
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  details: Record<string, unknown> = {}
) {
  getDb()
    .prepare(
      `INSERT INTO activity_log (household_id, user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(householdId, userId, action, entityType, entityId, JSON.stringify(details));
}

/** SQL fragment + params limiting transactions to what `access` may see. */
export function txnVisibilityFilter(access: Access): { sql: string; params: number[] } {
  if (access.full) return { sql: "", params: [] };
  const parts: string[] = [];
  const params: number[] = [];
  if (access.accountIds.length) {
    parts.push(`t.account_id IN (${access.accountIds.map(() => "?").join(",")})`);
    params.push(...access.accountIds);
  }
  if (access.categoryIds.length) {
    parts.push(`t.category_id IN (${access.categoryIds.map(() => "?").join(",")})`);
    params.push(...access.categoryIds);
  }
  if (!parts.length) return { sql: " AND 0", params: [] };
  return { sql: ` AND (${parts.join(" OR ")})`, params };
}
