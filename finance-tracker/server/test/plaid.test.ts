import { describe, it, expect, beforeEach } from "vitest";
import { encryptSecret, decryptSecret } from "../src/lib/crypto.js";
import { syncPlaidItem, mapPlaidType, type SyncClient, type PlaidTxnData, type PlaidAccountData } from "../src/lib/plaidSync.js";
import { detectRecurring } from "../src/routes/recurring.js";
import { freshApp, signup, createHousehold, type Agent } from "./helpers.js";
import { getDb } from "../src/lib/db.js";

describe("token encryption at rest", () => {
  it("round-trips and never stores plaintext", () => {
    const token = "access-sandbox-abc123-very-secret";
    const enc = encryptSecret(token);
    expect(enc).not.toContain(token);
    expect(enc.split(":")).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(token);
    // unique IV per encryption
    expect(encryptSecret(token)).not.toBe(enc);
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("secret");
    const [iv, tag, data] = enc.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptSecret(`${iv}:${tag}:${flipped.toString("base64")}`)).toThrow();
  });
});

describe("plaid account type mapping", () => {
  it("maps plaid types to ours", () => {
    expect(mapPlaidType("depository", "checking")).toBe("checking");
    expect(mapPlaidType("depository", "savings")).toBe("savings");
    expect(mapPlaidType("credit", "credit card")).toBe("credit");
    expect(mapPlaidType("loan", "mortgage")).toBe("loan");
    expect(mapPlaidType("investment", "brokerage")).toBe("investment");
  });
});

function mockClient(overrides: Partial<{
  accounts: PlaidAccountData[];
  pages: { added: PlaidTxnData[]; modified: PlaidTxnData[]; removed: { transaction_id: string }[] }[];
  failWith: unknown;
}> = {}): SyncClient {
  const accounts = overrides.accounts ?? [
    {
      account_id: "plaid-acc-1", name: "Sandbox Checking", type: "depository", subtype: "checking",
      balances: { current: 2500.5, iso_currency_code: "USD" },
    },
  ];
  const pages = overrides.pages ?? [];
  let page = 0;
  return {
    async accountsBalanceGet() {
      if (overrides.failWith) throw overrides.failWith;
      return { data: { accounts } };
    },
    async transactionsSync() {
      const p = pages[page] ?? { added: [], modified: [], removed: [] };
      page++;
      return {
        data: { ...p, next_cursor: `cursor-${page}`, has_more: page < pages.length },
      };
    },
  };
}

function plaidTxn(over: Partial<PlaidTxnData>): PlaidTxnData {
  return {
    transaction_id: "pt-1", account_id: "plaid-acc-1", amount: 12.5, date: "2026-07-01",
    name: "COFFEE SHOP", pending: false,
    personal_finance_category: { primary: "FOOD_AND_DRINK" }, ...over,
  };
}

describe("plaid sync reconciliation", () => {
  let app: ReturnType<typeof freshApp>["app"];
  let agent: Agent;
  let hid: number;
  let itemRowId: number;

  beforeEach(async () => {
    ({ app } = freshApp());
    ({ agent } = await signup(app, "plaid@example.com"));
    hid = await createHousehold(agent);
    const db = getDb();
    const info = db.prepare(
      `INSERT INTO plaid_items (household_id, item_id, access_token_encrypted, institution_name, created_by)
       VALUES (?, 'item-1', ?, 'First Sandbox Bank', 1)`
    ).run(hid, encryptSecret("access-sandbox-token"));
    itemRowId = Number(info.lastInsertRowid);
  });

  it("creates accounts, snapshots balances, and imports transactions with flipped sign", async () => {
    const client = mockClient({
      pages: [{
        added: [
          plaidTxn({}),
          plaidTxn({ transaction_id: "pt-2", amount: -2000, name: "PAYROLL", date: "2026-07-02", personal_finance_category: { primary: "INCOME" } }),
        ],
        modified: [], removed: [],
      }],
    });
    const result = await syncPlaidItem(client, itemRowId);
    expect(result.status).toBe("ok");
    expect(result.added).toBe(2);

    const accounts = await agent.get(`/api/households/${hid}/accounts`);
    const acct = accounts.body.accounts.find((a: any) => a.source === "plaid");
    expect(acct).toBeTruthy();
    expect(acct.name).toBe("Sandbox Checking");
    expect(acct.current_balance).toBe(2500.5);
    expect(acct.institution_name).toBe("First Sandbox Bank");

    const txns = await agent.get(`/api/households/${hid}/transactions`);
    const coffee = txns.body.transactions.find((t: any) => t.payee === "COFFEE SHOP");
    const payroll = txns.body.transactions.find((t: any) => t.payee === "PAYROLL");
    expect(coffee.amount).toBe(-12.5);          // plaid outflow → our negative
    expect(coffee.category_name).toBe("Dining Out"); // PFC mapping
    expect(payroll.amount).toBe(2000);          // plaid inflow → our positive
  });

  it("is idempotent: re-syncing modified transactions updates instead of duplicating", async () => {
    await syncPlaidItem(mockClient({ pages: [{ added: [plaidTxn({})], modified: [], removed: [] }] }), itemRowId);
    await syncPlaidItem(mockClient({ pages: [{ added: [], modified: [plaidTxn({ amount: 20, pending: true })], removed: [] }] }), itemRowId);
    const txns = await agent.get(`/api/households/${hid}/transactions`);
    const imported = txns.body.transactions.filter((t: any) => t.payee === "COFFEE SHOP");
    expect(imported).toHaveLength(1);
    expect(imported[0].amount).toBe(-20);
    expect(imported[0].pending).toBe(1);
  });

  it("removes transactions Plaid deleted", async () => {
    await syncPlaidItem(mockClient({ pages: [{ added: [plaidTxn({})], modified: [], removed: [] }] }), itemRowId);
    const result = await syncPlaidItem(
      mockClient({ pages: [{ added: [], modified: [], removed: [{ transaction_id: "pt-1" }] }] }),
      itemRowId
    );
    expect(result.removed).toBe(1);
    const txns = await agent.get(`/api/households/${hid}/transactions`);
    expect(txns.body.transactions.filter((t: any) => t.payee === "COFFEE SHOP")).toHaveLength(0);
  });

  it("marks the item login_required on ITEM_LOGIN_REQUIRED instead of failing silently", async () => {
    const err = { response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "re-auth" } } };
    const result = await syncPlaidItem(mockClient({ failWith: err }), itemRowId);
    expect(result.status).toBe("login_required");
    const status = await agent.get(`/api/households/${hid}/plaid/status`);
    expect(status.body.items[0].status).toBe("login_required");
  });
});

describe("recurring detection", () => {
  it("detects monthly bills with consistent amounts", () => {
    const txns = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"].map((date) => ({
      date, amount: -15.99, payee: "Streamly Video", account_id: 1, category_id: 2,
    }));
    const found = detectRecurring(txns);
    expect(found).toHaveLength(1);
    expect(found[0].frequency).toBe("monthly");
    expect(found[0].avg_amount).toBe(15.99);
    expect(found[0].next_due).toBe("2026-05-05");
  });

  it("ignores irregular payees, income, and < 3 occurrences", () => {
    const txns = [
      // irregular intervals
      { date: "2026-01-01", amount: -50, payee: "Random Shop", account_id: 1, category_id: null },
      { date: "2026-01-19", amount: -50, payee: "Random Shop", account_id: 1, category_id: null },
      { date: "2026-03-02", amount: -50, payee: "Random Shop", account_id: 1, category_id: null },
      // income, monthly — should be ignored (only outflows are bills)
      { date: "2026-01-01", amount: 1000, payee: "Employer", account_id: 1, category_id: null },
      { date: "2026-02-01", amount: 1000, payee: "Employer", account_id: 1, category_id: null },
      { date: "2026-03-01", amount: 1000, payee: "Employer", account_id: 1, category_id: null },
      // too few
      { date: "2026-01-10", amount: -9.99, payee: "Newbie", account_id: 1, category_id: null },
      { date: "2026-02-10", amount: -9.99, payee: "Newbie", account_id: 1, category_id: null },
    ];
    expect(detectRecurring(txns)).toHaveLength(0);
  });

  it("detects weekly patterns with small amount variance", () => {
    const txns = ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"].map((date, i) => ({
      date, amount: -(40 + i), payee: "Gas Station", account_id: 1, category_id: null,
    }));
    const found = detectRecurring(txns);
    expect(found).toHaveLength(1);
    expect(found[0].frequency).toBe("weekly");
  });
});
