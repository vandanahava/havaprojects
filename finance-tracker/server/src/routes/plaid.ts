import { Router } from "express";
import { z } from "zod";
import { CountryCode, Products } from "plaid";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  requireHousehold,
  requireMember,
  logActivity,
  type HouseholdRequest,
} from "../lib/permissions.js";
import { getPlaidClient, plaidConfigured, plaidEnvName } from "../lib/plaid.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { syncPlaidItem } from "../lib/plaidSync.js";

export const plaidRouter = Router({ mergeParams: true });
plaidRouter.use(requireAuth);

plaidRouter.get("/status", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const items = getDb()
    .prepare(
      `SELECT id, institution_name, status, last_synced_at, created_at,
              (SELECT COUNT(*) FROM accounts a WHERE a.plaid_item_id = plaid_items.id) as account_count
       FROM plaid_items WHERE household_id = ?`
    )
    .all(req.access!.householdId);
  res.json({ configured: plaidConfigured(), env: plaidEnvName(), items });
});

/** Create a Link token. Pass { plaid_item_id } to relaunch Link in update
 *  mode for the ITEM_LOGIN_REQUIRED reconnect flow. */
plaidRouter.post("/link-token", requireHousehold("edit"), requireMember, async (req: HouseholdRequest, res) => {
  if (!plaidConfigured())
    return res.status(503).json({
      error: "Plaid keys are not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env (Sandbox keys are free — see README).",
    });
  const parsed = z.object({ plaid_item_id: z.number().int().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Bad request" });
  try {
    const client = getPlaidClient();
    const base = {
      user: { client_user_id: String(req.user!.id) },
      client_name: "HearthLedger",
      language: "en",
      country_codes: [CountryCode.Us],
    };
    let request;
    if (parsed.data.plaid_item_id) {
      const item = getDb()
        .prepare("SELECT * FROM plaid_items WHERE id = ? AND household_id = ?")
        .get(parsed.data.plaid_item_id, req.access!.householdId) as any;
      if (!item) return res.status(404).json({ error: "Connection not found" });
      // Update mode: no products array, pass the existing access token
      request = { ...base, access_token: decryptSecret(item.access_token_encrypted) };
    } else {
      request = { ...base, products: [Products.Transactions] };
    }
    const resp = await client.linkTokenCreate(request);
    res.json({ link_token: resp.data.link_token });
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data?.error_message ?? "Failed to create link token" });
  }
});

/** Exchange the public_token from a successful Plaid Link session. We store
 *  ONLY the encrypted access_token and item_id — bank credentials never
 *  touch this server. */
plaidRouter.post("/exchange", requireHousehold("edit"), requireMember, async (req: HouseholdRequest, res) => {
  if (!plaidConfigured()) return res.status(503).json({ error: "Plaid not configured" });
  const parsed = z
    .object({
      public_token: z.string().min(1).max(500),
      institution_name: z.string().max(200).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "public_token required" });
  try {
    const client = getPlaidClient();
    const exch = await client.itemPublicTokenExchange({ public_token: parsed.data.public_token });
    const accessToken = exch.data.access_token;
    const itemId = exch.data.item_id;
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO plaid_items (household_id, item_id, access_token_encrypted, institution_name, created_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        req.access!.householdId, itemId, encryptSecret(accessToken),
        parsed.data.institution_name?.trim() ?? "Bank", req.user!.id
      );
    const rowId = Number(info.lastInsertRowid);
    logActivity(req.access!.householdId, req.user!.id, "connected", "plaid_item", rowId, {
      institution: parsed.data.institution_name,
    });
    // Initial sync pulls accounts + transaction history
    const result = await syncPlaidItem(client, rowId);
    res.status(201).json({ id: rowId, sync: result });
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data?.error_message ?? "Token exchange failed" });
  }
});

plaidRouter.post("/items/:itemId/sync", requireHousehold("edit"), requireMember, async (req: HouseholdRequest, res) => {
  if (!plaidConfigured()) return res.status(503).json({ error: "Plaid not configured" });
  const id = Number(req.params.itemId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const item = getDb()
    .prepare("SELECT id FROM plaid_items WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId);
  if (!item) return res.status(404).json({ error: "Connection not found" });
  const result = await syncPlaidItem(getPlaidClient(), id);
  res.json({ sync: result });
});

/** After a successful update-mode Link relaunch, mark the item healthy and resync. */
plaidRouter.post("/items/:itemId/reconnected", requireHousehold("edit"), requireMember, async (req: HouseholdRequest, res) => {
  const id = Number(req.params.itemId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const db = getDb();
  const item = db
    .prepare("SELECT id FROM plaid_items WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId);
  if (!item) return res.status(404).json({ error: "Connection not found" });
  db.prepare("UPDATE plaid_items SET status = 'ok' WHERE id = ?").run(id);
  logActivity(req.access!.householdId, req.user!.id, "reconnected", "plaid_item", id);
  const result = plaidConfigured() ? await syncPlaidItem(getPlaidClient(), id) : null;
  res.json({ ok: true, sync: result });
});

/** Disconnect: revoke the item at Plaid, then convert its accounts to manual
 *  so history is preserved. */
plaidRouter.delete("/items/:itemId", requireHousehold("edit"), requireMember, async (req: HouseholdRequest, res) => {
  const id = Number(req.params.itemId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const db = getDb();
  const item = db
    .prepare("SELECT * FROM plaid_items WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId) as any;
  if (!item) return res.status(404).json({ error: "Connection not found" });
  if (plaidConfigured()) {
    try {
      await getPlaidClient().itemRemove({ access_token: decryptSecret(item.access_token_encrypted) });
    } catch {
      // Item may already be removed at Plaid; proceed with local cleanup.
    }
  }
  const run = db.transaction(() => {
    db.prepare(
      "UPDATE accounts SET source = 'manual', plaid_item_id = NULL, plaid_account_id = NULL WHERE plaid_item_id = ?"
    ).run(id);
    db.prepare("DELETE FROM plaid_items WHERE id = ?").run(id);
  });
  run();
  logActivity(req.access!.householdId, req.user!.id, "disconnected", "plaid_item", id, {
    institution: item.institution_name,
  });
  res.json({ ok: true });
});
