import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, signup, createHousehold, createAccount, getCategoryId, addTxn, type Agent } from "./helpers.js";

let app: ReturnType<typeof freshApp>["app"];
let agent: Agent;
let hid: number;
let accountId: number;
let groceries: number;

beforeEach(async () => {
  ({ app } = freshApp());
  ({ agent } = await signup(app, "owner@example.com"));
  hid = await createHousehold(agent);
  accountId = await createAccount(agent, hid);
  groceries = await getCategoryId(agent, hid, "Groceries");
});

async function budgetRow(month: string, categoryId = groceries) {
  const res = await agent.get(`/api/households/${hid}/budgets?month=${month}`);
  return res.body.budgets.find((b: any) => b.category.id === categoryId);
}

describe("budget calculations", () => {
  it("computes spent, available, and status", async () => {
    await agent.put(`/api/households/${hid}/budgets`).send({
      category_id: groceries, month: "2026-07", amount: 500,
    });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-05", amount: -120, payee: "Market", category_id: groceries });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-10", amount: -80, payee: "Market", category_id: groceries });
    // Income and other months must not count
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-11", amount: 999, payee: "Refund", category_id: groceries });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-06-11", amount: -300, payee: "Market", category_id: groceries });

    const row = await budgetRow("2026-07");
    expect(row.spent).toBe(200);
    expect(row.available).toBe(300);
    expect(row.status).toBe("on_track");
  });

  it("flags close and over statuses", async () => {
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-07", amount: 100 });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-05", amount: -90, payee: "M", category_id: groceries });
    expect((await budgetRow("2026-07")).status).toBe("close");
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-06", amount: -20, payee: "M", category_id: groceries });
    const row = await budgetRow("2026-07");
    expect(row.status).toBe("over");
    expect(row.available).toBe(-10);
  });

  it("rolls unspent budget into the next month when rollover is on", async () => {
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-06", amount: 500, rollover: true });
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-07", amount: 500, rollover: true });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-06-10", amount: -300, payee: "M", category_id: groceries });

    const july = await budgetRow("2026-07");
    expect(july.budget.carry).toBe(200); // 500 - 300 carried forward
    expect(july.available).toBe(700);
  });

  it("does not roll over when the flag is off, and overspend never carries negative", async () => {
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-06", amount: 500, rollover: false });
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-07", amount: 500, rollover: true });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-06-10", amount: -100, payee: "M", category_id: groceries });
    // June has rollover off → July should not inherit June's leftover
    const july = await budgetRow("2026-07");
    expect(july.budget.carry).toBe(0);

    // Now overspend a rollover month: August must not get a negative carry
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-08", amount: 500, rollover: true });
    await addTxn(agent, hid, { account_id: accountId, date: "2026-07-15", amount: -800, payee: "M", category_id: groceries });
    const august = await budgetRow("2026-08");
    expect(august.budget.carry).toBe(0);
  });

  it("counts split lines instead of the parent transaction's category", async () => {
    const shopping = await getCategoryId(agent, hid, "Shopping");
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-07", amount: 500 });
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: shopping, month: "2026-07", amount: 500 });

    // Parent categorized as groceries but split 60/40 groceries/shopping
    const id = await addTxn(agent, hid, {
      account_id: accountId, date: "2026-07-05", amount: -100, payee: "Big Box", category_id: groceries,
    });
    await agent.put(`/api/households/${hid}/transactions/${id}/splits`).send({
      splits: [{ category_id: groceries, amount: -60 }, { category_id: shopping, amount: -40 }],
    });

    expect((await budgetRow("2026-07", groceries)).spent).toBe(60);
    expect((await budgetRow("2026-07", shopping)).spent).toBe(40);
  });

  it("upserts budgets and validates month format", async () => {
    const bad = await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-13", amount: 10 });
    expect(bad.status).toBe(400);
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-07", amount: 100 });
    await agent.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-07", amount: 250 });
    expect((await budgetRow("2026-07")).budget.amount).toBe(250);
  });
});
