# 🪙 HearthLedger — Household Finance Tracker

A Monarch-inspired personal/household finance web app: accounts & net worth,
transactions, budgets with rollover, recurring-bill detection, reports,
savings goals, and **granular household sharing** — with real bank
connections via **Plaid** (Sandbox by default).

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS 4 + Recharts
- **Backend:** Node 22 + Express + TypeScript + SQLite (better-sqlite3)
- **Bank data:** official `plaid` Node SDK — read-only products only (Transactions + Balance)
- **Auth:** email/password (bcrypt-hashed) + httpOnly session cookies
- **Tests:** Vitest + Supertest (47 tests: auth, CRUD, budget math, permission boundaries, net worth, Plaid sync, recurring detection)

---

## Quick start

```bash
cd finance-tracker
npm install
cp .env.example .env        # then edit .env (see below; app runs without Plaid keys)
npm run seed                # creates the demo household with 8 months of fictional data
npm run dev                 # API on :4000, web app on :5173
```

Open **http://localhost:5173** and sign in with a demo account
(all passwords are `demo1234`):

| Email | Role |
|---|---|
| `avery@example.com` | Household owner |
| `riley@example.com` | Household member |
| `jordan@example.com` | View-only shared guest (sees everything, can edit nothing) |

All seed data is fictional — invented people, invented institutions.

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Signs session tokens. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex key that AES-256-GCM-encrypts Plaid access tokens at rest. Generate the same way. |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Plaid API keys (optional — leave blank to run without bank connections). |
| `PLAID_ENV` | `sandbox` (default) / `development` / `production`. |
| `DATABASE_PATH` | SQLite file, default `./data/hearthledger.db`. |
| `PORT` | API port, default 4000. |

If the two secrets are unset, the dev server generates ephemeral ones and
warns loudly — fine for a quick look, wrong for real use.

### Running tests

```bash
npm test          # runs the full server test suite (in-memory DB, no network)
```

### Production-style serving

```bash
npm run build     # builds web → web/dist, typechecks server
npm start         # Express serves the API and the built frontend on :4000
```

---

## Connecting a bank (Plaid Sandbox walkthrough)

Bank logins happen **only inside Plaid Link** (Plaid's own hosted widget).
This app never sees, stores, logs, or transmits your bank username/password.
The only things persisted are Plaid's `access_token` (AES-256-GCM encrypted
at rest) and `item_id`.

1. **Get free Sandbox keys** — sign up at
   <https://dashboard.plaid.com/signup> (self-serve, no approval needed for
   Sandbox). Your `client_id` and Sandbox `secret` are under
   **Dashboard → Developers → Keys**.
2. Put them in `.env` as `PLAID_CLIENT_ID` / `PLAID_SECRET`, keep
   `PLAID_ENV=sandbox`, restart `npm run dev`.
3. In the app: **Accounts → 🔗 Connect a bank**. Plaid Link opens.
4. Pick any test institution (e.g. **First Platypus Bank**) and use Plaid's
   published Sandbox test credentials:
   - username: `user_good`
   - password: `pass_good`
   - if asked for MFA code: `1234`
5. Finish Link. The app exchanges the public token server-side, encrypts and
   stores the access token, and immediately syncs accounts + transactions
   via `/accounts/balance/get` and `/transactions/sync`. Connected accounts
   appear alongside manual ones, labeled "via [institution]".
6. **Reconnect flow:** to see the re-auth path in Sandbox, Plaid's dashboard
   can force an `ITEM_LOGIN_REQUIRED` state; the app then shows a
   "needs re-authentication" banner with a **Reconnect** button that
   relaunches Link in update mode — nothing fails silently.
7. A background job re-syncs every connected item every 6 hours; you can
   also click **Sync now** per connection.

### Going live with Plaid (read this before assuming it's "done")

Sandbox works end-to-end with fake institutions. Moving to **real banks**
requires steps only the Plaid account holder can complete:

- **Development/Limited Production** access and especially **full
  Production** require Plaid's application review: company/use-case
  description, identity verification, security questionnaire, and (for some
  products/regions) compliance attestations. **No AI agent, and no code
  change, can do this for you** — it's a business process between you and
  Plaid.
- After approval you swap `PLAID_ENV` and the corresponding `secret`. The
  code path is identical.
- Reminder: this app uses read-only products only. It never initiates
  payments or transfers, and must not be wired to Plaid Transfer/Payment
  Initiation.

---

## Security posture

- Passwords bcrypt-hashed (cost 10); sessions are random 256-bit tokens
  stored **hashed** server-side, delivered as `httpOnly` cookies.
- Every data route is auth-gated **and** household-scoped; a view-only share
  is enforced server-side on every mutating endpoint (verified by tests that
  hit the API directly, bypassing the UI).
- All SQL is parameterized (better-sqlite3 prepared statements); all input
  validated with zod.
- Plaid `access_token`s are AES-256-GCM encrypted with a key from the
  environment; they never appear in exports, logs, or API responses.
- Sharing is **default-private**, per-resource (household / account /
  category), per-permission (view / edit), revocable, and every grant &
  revocation is written to the activity log.
- No secrets in the repo: `.env` is gitignored; `.env.example` ships
  placeholders only.

## Project layout

```
finance-tracker/
├── server/
│   ├── src/lib/        db schema, auth, permissions, crypto, plaid client + sync engine
│   ├── src/routes/     one file per resource (accounts, transactions, budgets, …)
│   ├── src/seed.ts     fictional demo household generator
│   └── test/           vitest + supertest suite
└── web/
    └── src/
        ├── components/ layout, charts, UI kit, Plaid Link button
        ├── pages/      one file per screen
        └── lib/        api client, formatting, palette
```
