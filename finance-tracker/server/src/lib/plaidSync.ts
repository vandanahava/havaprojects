import { getDb } from "./db.js";
import { decryptSecret } from "./crypto.js";
import { logActivity } from "./permissions.js";

/**
 * Sync engine for Plaid items. The Plaid API surface used here is injected
 * (SyncClient) so tests can exercise reconciliation without network access.
 * Uses read-only endpoints only: /accounts/balance/get and /transactions/sync.
 */

export interface PlaidAccountData {
  account_id: string;
  name: string;
  type: string; // depository | credit | loan | investment
  subtype: string | null;
  balances: { current: number | null; iso_currency_code: string | null };
}

export interface PlaidTxnData {
  transaction_id: string;
  account_id: string;
  amount: number; // Plaid: positive = money OUT of the account
  date: string;
  name: string;
  pending: boolean;
  personal_finance_category?: { primary?: string } | null;
}

export interface SyncClient {
  accountsBalanceGet(req: { access_token: string }): Promise<{ data: { accounts: PlaidAccountData[] } }>;
  transactionsSync(req: { access_token: string; cursor?: string; count?: number }): Promise<{
    data: {
      added: PlaidTxnData[];
      modified: PlaidTxnData[];
      removed: { transaction_id: string }[];
      next_cursor: string;
      has_more: boolean;
    };
  }>;
}

export function mapPlaidType(type: string, subtype: string | null): string {
  if (type === "depository") return subtype === "savings" ? "savings" : "checking";
  if (type === "credit") return "credit";
  if (type === "loan") return "loan";
  if (type === "investment") return "investment";
  return "checking";
}

// Map Plaid's personal finance categories onto our default category names.
const PLAID_CATEGORY_MAP: Record<string, string> = {
  FOOD_AND_DRINK: "Dining Out",
  GENERAL_MERCHANDISE: "Shopping",
  GROCERIES: "Groceries",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Utilities",
  MEDICAL: "Health",
  ENTERTAINMENT: "Entertainment",
  PERSONAL_CARE: "Personal Care",
  GENERAL_SERVICES: "Fees",
  LOAN_PAYMENTS: "Fees",
  INCOME: "Salary",
  TRANSFER_IN: "Other Income",
};

function isPlaidAuthError(err: unknown): boolean {
  const code = (err as any)?.response?.data?.error_code;
  return code === "ITEM_LOGIN_REQUIRED" || code === "ITEM_LOCKED" || code === "INVALID_CREDENTIALS";
}

export interface SyncResult {
  itemId: number;
  added: number;
  modified: number;
  removed: number;
  status: "ok" | "login_required" | "error";
  error?: string;
}

/** Pull balances + transactions for one plaid_items row and reconcile into
 *  our accounts/transactions tables. */
export async function syncPlaidItem(client: SyncClient, plaidItemRowId: number): Promise<SyncResult> {
  const db = getDb();
  const item = db
    .prepare("SELECT * FROM plaid_items WHERE id = ?")
    .get(plaidItemRowId) as any;
  if (!item) throw new Error(`plaid_items row ${plaidItemRowId} not found`);
  const accessToken = decryptSecret(item.access_token_encrypted);
  const result: SyncResult = { itemId: plaidItemRowId, added: 0, modified: 0, removed: 0, status: "ok" };

  try {
    // 1. Balances → accounts + daily snapshot
    const balRes = await client.accountsBalanceGet({ access_token: accessToken });
    const today = new Date().toISOString().slice(0, 10);
    for (const pa of balRes.data.accounts) {
      const existing = db
        .prepare("SELECT id FROM accounts WHERE plaid_account_id = ?")
        .get(pa.account_id) as { id: number } | undefined;
      const balance = pa.balances.current ?? 0;
      let accountId: number;
      if (existing) {
        accountId = existing.id;
        db.prepare("UPDATE accounts SET current_balance = ?, name = COALESCE(NULLIF(name,''), ?) WHERE id = ?")
          .run(balance, pa.name, accountId);
      } else {
        const info = db
          .prepare(
            `INSERT INTO accounts (household_id, name, type, source, plaid_item_id, plaid_account_id, institution_name, current_balance, currency)
             VALUES (?, ?, ?, 'plaid', ?, ?, ?, ?, ?)`
          )
          .run(
            item.household_id, pa.name, mapPlaidType(pa.type, pa.subtype), item.id,
            pa.account_id, item.institution_name, balance, pa.balances.iso_currency_code ?? "USD"
          );
        accountId = Number(info.lastInsertRowid);
      }
      db.prepare(
        `INSERT INTO balance_snapshots (account_id, date, balance) VALUES (?, ?, ?)
         ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance`
      ).run(accountId, today, balance);
    }

    // 2. Transactions via cursor-based /transactions/sync
    let cursor: string | undefined = item.sync_cursor ?? undefined;
    let hasMore = true;
    const catIdByName = new Map<string, number>();
    for (const row of db
      .prepare("SELECT id, name FROM categories WHERE household_id = ?")
      .all(item.household_id) as { id: number; name: string }[]) {
      catIdByName.set(row.name, row.id);
    }
    while (hasMore) {
      const syncRes = await client.transactionsSync({ access_token: accessToken, cursor, count: 500 });
      const { added, modified, removed, next_cursor, has_more } = syncRes.data;
      const apply = db.transaction(() => {
        for (const tx of [...added, ...modified]) {
          const acct = db
            .prepare("SELECT id FROM accounts WHERE plaid_account_id = ?")
            .get(tx.account_id) as { id: number } | undefined;
          if (!acct) continue;
          const ourAmount = -tx.amount; // Plaid: positive = outflow; ours: negative = outflow
          const catName = PLAID_CATEGORY_MAP[tx.personal_finance_category?.primary ?? ""] ?? null;
          const categoryId = catName ? catIdByName.get(catName) ?? null : null;
          const exists = db
            .prepare("SELECT id FROM transactions WHERE plaid_transaction_id = ?")
            .get(tx.transaction_id) as { id: number } | undefined;
          if (exists) {
            db.prepare(
              "UPDATE transactions SET amount = ?, date = ?, payee = ?, pending = ? WHERE id = ?"
            ).run(ourAmount, tx.date, tx.name, tx.pending ? 1 : 0, exists.id);
            result.modified++;
          } else {
            db.prepare(
              `INSERT INTO transactions (household_id, account_id, category_id, date, amount, payee, pending, plaid_transaction_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(item.household_id, acct.id, categoryId, tx.date, ourAmount, tx.name, tx.pending ? 1 : 0, tx.transaction_id);
            result.added++;
          }
        }
        for (const rm of removed) {
          const info = db
            .prepare("DELETE FROM transactions WHERE plaid_transaction_id = ?")
            .run(rm.transaction_id);
          result.removed += info.changes;
        }
      });
      apply();
      cursor = next_cursor;
      hasMore = has_more;
    }
    db.prepare(
      "UPDATE plaid_items SET sync_cursor = ?, last_synced_at = datetime('now'), status = 'ok' WHERE id = ?"
    ).run(cursor ?? null, item.id);
    logActivity(item.household_id, null, "synced", "plaid_item", item.id, {
      added: result.added, modified: result.modified, removed: result.removed,
    });
  } catch (err) {
    if (isPlaidAuthError(err)) {
      db.prepare("UPDATE plaid_items SET status = 'login_required' WHERE id = ?").run(item.id);
      result.status = "login_required";
      result.error = "Bank connection needs to be re-authenticated";
      logActivity(item.household_id, null, "sync_failed", "plaid_item", item.id, { reason: "login_required" });
    } else {
      db.prepare("UPDATE plaid_items SET status = 'error' WHERE id = ?").run(item.id);
      result.status = "error";
      result.error = (err as any)?.response?.data?.error_message ?? (err as Error).message;
      logActivity(item.household_id, null, "sync_failed", "plaid_item", item.id, { reason: result.error });
    }
  }
  return result;
}

/** Sync every non-errored item (used by the scheduled job). */
export async function syncAllItems(client: SyncClient): Promise<SyncResult[]> {
  const db = getDb();
  const items = db.prepare("SELECT id FROM plaid_items WHERE status != 'login_required'").all() as { id: number }[];
  const results: SyncResult[] = [];
  for (const it of items) {
    results.push(await syncPlaidItem(client, it.id));
  }
  return results;
}
