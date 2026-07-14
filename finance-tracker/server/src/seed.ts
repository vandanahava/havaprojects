/**
 * Seeds the database with a fully fictional demo household:
 *   The "Juniper Lane" household — Avery & Riley Juniper, with friend
 *   Jordan Wren holding a view-only share.
 *
 * Demo logins (all password: demo1234):
 *   avery@example.com  — household owner
 *   riley@example.com  — household member
 *   jordan@example.com — view-only shared guest
 *
 * All names, institutions, and figures are invented. No real financial data.
 */
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createDb, setDb, getDb } from "./lib/db.js";

// Load .env like index.ts does
const envPath = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const DB_PATH = process.env.DATABASE_PATH || "./data/hearthledger.db";

// Deterministic RNG so seeds are reproducible
let rngState = 42;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) % 2 ** 31;
  return rngState / 2 ** 31;
}
function randBetween(min: number, max: number): number {
  return Math.round((min + rand() * (max - min)) * 100) / 100;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  return iso(new Date(Date.now() - n * 86400_000));
}

const MONTHS_OF_HISTORY = 8;

async function main() {
  // Fresh database every seed
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
  }
  const db = createDb(DB_PATH);
  setDb(db);

  const hash = await bcrypt.hash("demo1234", 10);
  const insUser = db.prepare("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)");
  const avery = Number(insUser.run("avery@example.com", hash, "Avery Juniper").lastInsertRowid);
  const riley = Number(insUser.run("riley@example.com", hash, "Riley Juniper").lastInsertRowid);
  const jordan = Number(insUser.run("jordan@example.com", hash, "Jordan Wren").lastInsertRowid);

  const hid = Number(
    db.prepare("INSERT INTO households (name, owner_id) VALUES (?, ?)").run("Juniper Lane", avery).lastInsertRowid
  );
  const insMember = db.prepare(
    "INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)"
  );
  insMember.run(hid, avery, "owner");
  insMember.run(hid, riley, "member");

  // Jordan gets a view-only share of the whole household (revocable, logged)
  db.prepare(
    `INSERT INTO shares (household_id, resource_type, resource_id, grantee_user_id, permission, created_by)
     VALUES (?, 'household', NULL, ?, 'view', ?)`
  ).run(hid, jordan, avery);

  // Categories (same defaults the app creates)
  const CATS: [string, string, number][] = [
    ["Groceries", "🛒", 0], ["Dining Out", "🍽️", 0], ["Housing", "🏠", 0],
    ["Utilities", "💡", 0], ["Transportation", "🚗", 0], ["Health", "🩺", 0],
    ["Insurance", "🛡️", 0], ["Subscriptions", "📺", 0], ["Shopping", "🛍️", 0],
    ["Travel", "✈️", 0], ["Kids", "🧸", 0], ["Pets", "🐾", 0],
    ["Entertainment", "🎬", 0], ["Personal Care", "💇", 0], ["Gifts & Charity", "🎁", 0],
    ["Education", "🎓", 0], ["Fees", "🧾", 0], ["Other", "📁", 0],
    ["Salary", "💼", 1], ["Freelance", "🧑‍💻", 1], ["Interest & Dividends", "📈", 1],
    ["Other Income", "💵", 1],
  ];
  const insCat = db.prepare(
    "INSERT INTO categories (household_id, name, icon, is_income) VALUES (?, ?, ?, ?)"
  );
  const catId = new Map<string, number>();
  for (const [name, icon, inc] of CATS) {
    catId.set(name, Number(insCat.run(hid, name, icon, inc).lastInsertRowid));
  }

  // ── Accounts (all fictional institutions) ────────────────────────────
  const insAcct = db.prepare(
    `INSERT INTO accounts (household_id, name, type, source, institution_name, current_balance)
     VALUES (?, ?, ?, 'manual', ?, ?)`
  );
  const checking = Number(insAcct.run(hid, "Joint Checking", "checking", "First Meadow Bank", 0).lastInsertRowid);
  const savings = Number(insAcct.run(hid, "High-Yield Savings", "savings", "First Meadow Bank", 0).lastInsertRowid);
  const credit = Number(insAcct.run(hid, "Sapphire Rewards Card", "credit", "Cobalt Card Co.", 0).lastInsertRowid);
  const carLoan = Number(insAcct.run(hid, "Subaru Loan", "loan", "Drivetrain Credit Union", 0).lastInsertRowid);
  const brokerage = Number(insAcct.run(hid, "Index Brokerage", "investment", "Alder Invest", 0).lastInsertRowid);
  const home = Number(insAcct.run(hid, "1214 Juniper Lane", "property", "", 0).lastInsertRowid);
  const mortgage = Number(insAcct.run(hid, "Mortgage", "loan", "Homestead Lending", 0).lastInsertRowid);
  const cash = Number(insAcct.run(hid, "Wallet Cash", "cash", "", 0).lastInsertRowid);

  // ── Transactions over MONTHS_OF_HISTORY months ───────────────────────
  const insTxn = db.prepare(
    `INSERT INTO transactions (household_id, account_id, category_id, date, amount, payee, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const txn = (
    account: number, date: string, amount: number, payee: string, cat: string | null,
    notes = "", by: number = avery
  ) => Number(insTxn.run(hid, account, cat ? catId.get(cat)! : null, date, amount, payee, notes, by).lastInsertRowid);

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS_OF_HISTORY - 1), 1);

  for (let m = 0; m < MONTHS_OF_HISTORY; m++) {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const y = monthStart.getFullYear();
    const mo = monthStart.getMonth();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const dateIn = (day: number) => iso(new Date(Date.UTC(y, mo, Math.min(day, daysInMonth))));
    const isCurrentMonth = m === MONTHS_OF_HISTORY - 1;
    const lastDay = isCurrentMonth ? now.getDate() : daysInMonth;
    const has = (day: number) => day <= lastDay;

    // Income: Avery salary 1st & 15th, Riley salary 5th, occasional freelance
    if (has(1)) txn(checking, dateIn(1), 3120, "Bramblewood Design Co", "Salary", "Avery payroll", avery);
    if (has(15)) txn(checking, dateIn(15), 3120, "Bramblewood Design Co", "Salary", "Avery payroll", avery);
    if (has(5)) txn(checking, dateIn(5), 4260, "Cedar City Schools", "Salary", "Riley payroll", riley);
    if (m % 3 === 1 && has(20)) txn(checking, dateIn(20), randBetween(400, 900), "Freelance client", "Freelance", "", avery);
    if (has(28)) txn(savings, dateIn(28), randBetween(55, 85), "First Meadow Bank", "Interest & Dividends", "APY interest");

    // Fixed bills — consistent payees/amounts for recurring detection
    if (has(1)) txn(checking, dateIn(1), -2350, "Homestead Lending", "Housing", "Mortgage payment");
    if (has(3)) txn(checking, dateIn(3), -428.5, "Drivetrain Credit Union", "Transportation", "Car payment");
    if (has(7)) txn(checking, dateIn(7), -randBetween(120, 190), "Cedar Power & Light", "Utilities");
    if (has(9)) txn(checking, dateIn(9), -randBetween(60, 85), "Cedar City Water", "Utilities");
    if (has(11)) txn(checking, dateIn(11), -79.99, "Fiberline Internet", "Utilities");
    if (has(12)) txn(credit, dateIn(12), -15.99, "Streamly Video", "Subscriptions");
    if (has(14)) txn(credit, dateIn(14), -11.99, "Tunebird Music", "Subscriptions");
    if (has(16)) txn(credit, dateIn(16), -42, "Cedar Fitness Club", "Health", "Gym membership");
    if (has(18)) txn(checking, dateIn(18), -164.33, "Shield Mutual Insurance", "Insurance", "Auto + renters");

    // Groceries roughly weekly
    for (const day of [2, 8, 15, 22, 27]) {
      if (has(day)) txn(credit, dateIn(day), -randBetween(70, 165), pick(["Greenleaf Market", "Greenleaf Market", "Hollow Oak Grocery"]), "Groceries", "", pick([avery, riley]));
    }
    // Dining out
    for (const day of [4, 10, 13, 19, 24]) {
      if (has(day) && rand() > 0.25)
        txn(credit, dateIn(day), -randBetween(18, 85), pick(["Noodle Cart", "La Petite Fourche", "Ember & Rye", "Morning Bell Cafe", "Taco Verde"]), "Dining Out", "", pick([avery, riley]));
    }
    // Gas
    for (const day of [6, 17, 26]) {
      if (has(day)) txn(credit, dateIn(day), -randBetween(38, 62), "Roadrunner Fuel", "Transportation", "", pick([avery, riley]));
    }
    // Shopping / misc
    if (has(9) && rand() > 0.3) txn(credit, dateIn(9), -randBetween(25, 140), pick(["Umbra Home Goods", "Pixel & Post", "Cedar Books"]), "Shopping");
    if (has(21) && rand() > 0.5) txn(credit, dateIn(21), -randBetween(30, 90), "Whisker & Paw Supply", "Pets");
    if (has(23) && rand() > 0.5) txn(credit, dateIn(23), -randBetween(15, 60), "Cinema Royale", "Entertainment");
    if (has(25) && rand() > 0.6) txn(checking, dateIn(25), -randBetween(40, 120), "Clover Clinic", "Health");

    // Credit card payment (transfer-ish; categorized Fees→ none)
    if (has(20)) txn(checking, dateIn(20), -randBetween(900, 1400), "Cobalt Card Co. Payment", null, "Card autopay");

    // Savings transfer
    if (has(16)) txn(checking, dateIn(16), -800, "Transfer to Savings", null, "Automatic transfer");
    if (has(16)) txn(savings, dateIn(16), 800, "Transfer from Checking", null, "Automatic transfer");
  }

  // A vacation with tagged transactions two months ago
  const vacBase = new Date(now.getFullYear(), now.getMonth() - 2, 10);
  const vacTxns = [
    txn(credit, iso(vacBase), -486.4, "Skyway Airlines", "Travel", "Flights to Portland"),
    txn(credit, iso(new Date(vacBase.getTime() + 86400_000)), -389, "The Fern Hotel", "Travel", "3 nights"),
    txn(credit, iso(new Date(vacBase.getTime() + 2 * 86400_000)), -74.2, "Tidepool Oyster Bar", "Dining Out"),
  ];
  db.prepare("INSERT INTO tags (household_id, name) VALUES (?, 'vacation')").run(hid);
  const vacationTag = (db.prepare("SELECT id FROM tags WHERE household_id = ? AND name = 'vacation'").get(hid) as { id: number }).id;
  for (const t of vacTxns) {
    db.prepare("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)").run(t, vacationTag);
  }

  // A split transaction: big-box run split between groceries and shopping
  const splitId = txn(credit, daysAgo(6), -212.4, "Granary Wholesale", null, "Split: groceries + household");
  const insSplit = db.prepare(
    "INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)"
  );
  insSplit.run(splitId, catId.get("Groceries")!, -132.4);
  insSplit.run(splitId, catId.get("Shopping")!, -80);

  // ── Balance snapshots: weekly, with gentle trends ────────────────────
  const insSnap = db.prepare(
    "INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance) VALUES (?, ?, ?)"
  );
  const totalDays = MONTHS_OF_HISTORY * 30;
  const trend = (
    account: number, startBal: number, endBal: number, jitter: number
  ) => {
    for (let d = totalDays; d >= 0; d -= 7) {
      const p = 1 - d / totalDays;
      const base = startBal + (endBal - startBal) * p;
      const wobble = d === 0 ? 0 : (rand() - 0.5) * 2 * jitter;
      insSnap.run(account, daysAgo(d), Math.round((base + wobble) * 100) / 100);
    }
  };
  trend(checking, 6200, 8425.11, 900);
  trend(savings, 18600, 24950.6, 250);
  trend(credit, 1450, 1238.42, 400);      // amount owed
  trend(carLoan, 14100, 11310.75, 60);    // amount owed, decreasing
  trend(brokerage, 31200, 36780.33, 1400);
  trend(home, 412000, 420000, 0);
  trend(mortgage, 291400, 286120.5, 90);  // amount owed, decreasing
  trend(cash, 260, 180, 40);

  // Set current balances to the final snapshot values
  for (const [acct, bal] of [
    [checking, 8425.11], [savings, 24950.6], [credit, 1238.42], [carLoan, 11310.75],
    [brokerage, 36780.33], [home, 420000], [mortgage, 286120.5], [cash, 180],
  ] as [number, number][]) {
    db.prepare("UPDATE accounts SET current_balance = ? WHERE id = ?").run(bal, acct);
  }

  // ── Budgets for the last 4 months (groceries rolls over) ─────────────
  const insBudget = db.prepare(
    `INSERT INTO budgets (household_id, category_id, month, amount, rollover) VALUES (?, ?, ?, ?, ?)`
  );
  const budgetPlan: [string, number, number][] = [
    ["Groceries", 650, 1], ["Dining Out", 320, 0], ["Utilities", 350, 0],
    ["Transportation", 650, 0], ["Subscriptions", 45, 0], ["Entertainment", 120, 0],
    ["Shopping", 200, 1], ["Health", 220, 0], ["Pets", 80, 0],
  ];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    for (const [cat, amount, roll] of budgetPlan) {
      insBudget.run(hid, catId.get(cat)!, month, amount, roll);
    }
  }

  // ── Goals ────────────────────────────────────────────────────────────
  const insGoal = db.prepare(
    "INSERT INTO goals (household_id, name, icon, target_amount, target_date, saved_amount) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const nextYear = now.getFullYear() + 1;
  insGoal.run(hid, "Emergency Fund", "🛟", 15000, null, 9500);
  insGoal.run(hid, "Japan Trip", "🗾", 6000, `${nextYear}-04-01`, 2150);
  insGoal.run(hid, "New Roof", "🏠", 12000, `${nextYear}-09-01`, 3800);

  // ── Activity log entries ─────────────────────────────────────────────
  const insAct = db.prepare(
    `INSERT INTO activity_log (household_id, user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`
  );
  insAct.run(hid, avery, "created", "household", hid, JSON.stringify({ name: "Juniper Lane" }), `-${MONTHS_OF_HISTORY * 30} days`);
  insAct.run(hid, avery, "added_member", "user", riley, JSON.stringify({ email: "riley@example.com" }), `-${MONTHS_OF_HISTORY * 30 - 1} days`);
  insAct.run(hid, avery, "shared", "household", null, JSON.stringify({ with: "jordan@example.com", permission: "view" }), "-45 days");
  insAct.run(hid, riley, "set_budget", "budget", catId.get("Groceries")!, JSON.stringify({ month: "current", amount: 650 }), "-20 days");
  insAct.run(hid, avery, "created", "goal", 1, JSON.stringify({ name: "Emergency Fund" }), "-60 days");

  const counts = {
    users: 3,
    transactions: (db.prepare("SELECT COUNT(*) n FROM transactions").get() as any).n,
    snapshots: (db.prepare("SELECT COUNT(*) n FROM balance_snapshots").get() as any).n,
    budgets: (db.prepare("SELECT COUNT(*) n FROM budgets").get() as any).n,
  };
  console.log("✅ Seeded demo household 'Juniper Lane'");
  console.log(`   ${counts.transactions} transactions, ${counts.snapshots} balance snapshots, ${counts.budgets} budget rows`);
  console.log("   Logins (password: demo1234):");
  console.log("     avery@example.com  — owner");
  console.log("     riley@example.com  — member");
  console.log("     jordan@example.com — view-only guest");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
