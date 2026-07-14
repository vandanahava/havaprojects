import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, signup, createHousehold, createAccount, getCategoryId, addTxn, type Agent } from "./helpers.js";

let app: ReturnType<typeof freshApp>["app"];
let agent: Agent;
let hid: number;
let accountId: number;

beforeEach(async () => {
  ({ app } = freshApp());
  ({ agent } = await signup(app, "owner@example.com"));
  hid = await createHousehold(agent);
  accountId = await createAccount(agent, hid);
});

describe("transaction CRUD", () => {
  it("creates, reads, updates, and deletes a transaction", async () => {
    const groceries = await getCategoryId(agent, hid, "Groceries");
    const id = await addTxn(agent, hid, {
      account_id: accountId, date: "2026-07-01", amount: -42.5, payee: "Test Mart", category_id: groceries,
    });

    let list = await agent.get(`/api/households/${hid}/transactions`);
    expect(list.body.total).toBe(1);
    expect(list.body.transactions[0].payee).toBe("Test Mart");
    expect(list.body.transactions[0].amount).toBe(-42.5);

    const upd = await agent.patch(`/api/households/${hid}/transactions/${id}`).send({ amount: -50, payee: "Test Mart 2" });
    expect(upd.status).toBe(200);
    list = await agent.get(`/api/households/${hid}/transactions`);
    expect(list.body.transactions[0].amount).toBe(-50);

    const del = await agent.delete(`/api/households/${hid}/transactions/${id}`);
    expect(del.status).toBe(200);
    list = await agent.get(`/api/households/${hid}/transactions`);
    expect(list.body.total).toBe(0);
  });

  it("validates input", async () => {
    const bad1 = await agent.post(`/api/households/${hid}/transactions`).send({
      account_id: accountId, date: "not-a-date", amount: -5, payee: "x",
    });
    expect(bad1.status).toBe(400);
    const bad2 = await agent.post(`/api/households/${hid}/transactions`).send({
      account_id: 99999, date: "2026-07-01", amount: -5, payee: "x",
    });
    expect(bad2.status).toBe(404);
    const bad3 = await agent.post(`/api/households/${hid}/transactions`).send({
      account_id: accountId, date: "2026-07-01", amount: -5, payee: "x", category_id: 424242,
    });
    expect(bad3.status).toBe(400);
  });

  it("searches and filters", async () => {
    const dining = await getCategoryId(agent, hid, "Dining Out");
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-01", amount: -10, payee: "Coffee Corner", category_id: dining });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-02", amount: -20, payee: "Book Nook" });

    const bySearch = await agent.get(`/api/households/${hid}/transactions?search=coffee`);
    expect(bySearch.body.total).toBe(1);
    expect(bySearch.body.transactions[0].payee).toBe("Coffee Corner");

    const byCat = await agent.get(`/api/households/${hid}/transactions?category_id=${dining}`);
    expect(byCat.body.total).toBe(1);

    const uncat = await agent.get(`/api/households/${hid}/transactions?category_id=none`);
    expect(uncat.body.total).toBe(1);
    expect(uncat.body.transactions[0].payee).toBe("Book Nook");

    const byDate = await agent.get(`/api/households/${hid}/transactions?start=2026-07-02&end=2026-07-02`);
    expect(byDate.body.total).toBe(1);
  });

  it("bulk categorizes", async () => {
    const shopping = await getCategoryId(agent, hid, "Shopping");
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await addTxn(agent, hid, { account_id: accountId, date: "2026-07-01", amount: -5, payee: `P${i}` }));
    }
    const res = await agent.post(`/api/households/${hid}/transactions/bulk-categorize`).send({
      ids, category_id: shopping,
    });
    expect(res.body.updated).toBe(3);
    const list = await agent.get(`/api/households/${hid}/transactions?category_id=${shopping}`);
    expect(list.body.total).toBe(3);
  });

  it("enforces that splits sum to the transaction amount", async () => {
    const groceries = await getCategoryId(agent, hid, "Groceries");
    const shopping = await getCategoryId(agent, hid, "Shopping");
    const id = await addTxn(agent, hid, { account_id: accountId, date: "2026-07-01", amount: -100, payee: "Big Box" });

    const bad = await agent.put(`/api/households/${hid}/transactions/${id}/splits`).send({
      splits: [{ category_id: groceries, amount: -60 }, { category_id: shopping, amount: -30 }],
    });
    expect(bad.status).toBe(400);

    const good = await agent.put(`/api/households/${hid}/transactions/${id}/splits`).send({
      splits: [{ category_id: groceries, amount: -60 }, { category_id: shopping, amount: -40 }],
    });
    expect(good.status).toBe(200);

    const list = await agent.get(`/api/households/${hid}/transactions`);
    expect(list.body.transactions[0].splits).toHaveLength(2);

    // clearing splits
    const clear = await agent.put(`/api/households/${hid}/transactions/${id}/splits`).send({ splits: [] });
    expect(clear.status).toBe(200);
  });

  it("manages tags", async () => {
    const id = await addTxn(agent, hid, { account_id: accountId, date: "2026-07-01", amount: -10, payee: "Tagged" });
    await agent.put(`/api/households/${hid}/transactions/${id}/tags`).send({ tags: ["Vacation", "reimbursable"] });
    const list = await agent.get(`/api/households/${hid}/transactions?tag=vacation`);
    expect(list.body.total).toBe(1);
    expect(list.body.transactions[0].tags.sort()).toEqual(["reimbursable", "vacation"]);
  });
});
