import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  currency TEXT NOT NULL DEFAULT 'USD',
  locale TEXT NOT NULL DEFAULT 'en-US',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plaid_items (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL UNIQUE,
  access_token_encrypted TEXT NOT NULL,
  institution_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','login_required','error')),
  sync_cursor TEXT,
  last_synced_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','credit','loan','investment','cash','property')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','plaid')),
  plaid_item_id INTEGER REFERENCES plaid_items(id) ON DELETE SET NULL,
  plaid_account_id TEXT UNIQUE,
  institution_name TEXT,
  current_balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance REAL NOT NULL,
  UNIQUE (account_id, date)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📁',
  is_income INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL, -- negative = spending, positive = income
  payee TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  pending INTEGER NOT NULL DEFAULT 0,
  plaid_transaction_id TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_txn_household_date ON transactions(household_id, date);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);

CREATE TABLE IF NOT EXISTS transaction_splits (
  id INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (household_id, name)
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- YYYY-MM
  amount REAL NOT NULL,
  rollover INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, category_id, month)
);

CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('household','account','category')),
  resource_id INTEGER, -- NULL for household-level shares
  grantee_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('view','edit')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_household ON activity_log(household_id, created_at);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎯',
  target_amount REAL NOT NULL,
  target_date TEXT,
  saved_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_items (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  payee TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  avg_amount REAL NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
  last_date TEXT NOT NULL,
  next_due TEXT NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, payee, frequency)
);
`;

export type DB = Database.Database;

export function createDb(filePath: string): DB {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

let _db: DB | null = null;

export function getDb(): DB {
  if (!_db) {
    _db = createDb(process.env.DATABASE_PATH || "./data/hearthledger.db");
  }
  return _db;
}

export function setDb(db: DB) {
  _db = db;
}
