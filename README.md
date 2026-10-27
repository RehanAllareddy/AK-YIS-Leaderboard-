# AK Young Investors Society Leaderboard

A public points leaderboard for the AK Young Investors Society, plus a secure admin dashboard where club officers manage members and points. Every point change is recorded in a permanent audit log.

- **Public leaderboard** (`/`): rankings, a compact top-three podium, light and dark themes (follows the device setting, with a toggle in the header), search, sorting, a Top 10 filter, a large-text view for classroom screens, and live updates within about 5 seconds of any change.
- **Admin dashboard** (`/admin`): add, rename, deactivate, and reactivate members; one-click and custom point adjustments; set or reset totals with confirmation; audit history; quick-action settings.
- **Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, and PostgreSQL. Supabase is recommended in production. An embedded Postgres (PGlite) is used for local development and tests.

---

## Quick start (local, no database server needed)

Requires Node.js 20.12 or newer.

```bash
npm install
cp .env.example .env.local        # defaults to the embedded local database
npm run setup:local               # create tables + import data/leaderboard_2026-10-27.json
npm run admin:create -- --username <your-username>   # prompts for a password
npm run dev                       # http://localhost:3000
```

> The embedded database lives in `.data/` (git-ignored) and allows **only one process at a time**. Stop `npm run dev` before running `db:*` or `admin:create` scripts. The scripts will tell you if you forget.

---

## Production setup (Supabase + Vercel)

### 1. Create the database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Connect** (or **Project Settings → Database**) and copy two connection strings:
   - **Session pooler** (port 5432): use it for running the scripts below.
   - **Transaction pooler** (port 6543): use it for the deployed app on Vercel.

The app connects to Postgres directly from the server. It never uses Supabase's anon or service-role API keys, and no Supabase key ever reaches the browser.

### 2. Create tables, import data, create the first admin

From your machine, with `DATABASE_URL` set to the **session pooler** string. Put it in `.env.local` or pass it inline; don't commit it.

```bash
npm run db:migrate
npm run db:import                 # imports data/leaderboard_2026-10-27.json
npm run admin:create -- --username <your-username> --display-name "Your Name"
```

### 3. Deploy to Vercel

1. Push this repository to GitHub and import it in Vercel. The framework preset (Next.js) is detected automatically.
2. Under **Settings → Environment Variables**, add:
   - `DATABASE_URL`: the **transaction pooler** string.
   - `DATABASE_CA_CERT` (recommended): Supabase's CA certificate (**Project Settings → Database → SSL Configuration → Download certificate**). Paste the PEM contents; `\n` escapes are accepted. Without it, connections are still encrypted, but the server certificate isn't verified.
3. Deploy. Future schema changes are applied by running `npm run db:migrate` against the database. Deploys never modify data.

Any other PostgreSQL 14+ host (Neon, RDS, Railway, …) works the same way.

---

## First admin account

There is **no default username or password**. Admins can only be created from a terminal that has database access:

```bash
npm run admin:create -- --username <name> [--display-name "Ms. Rivera"]
```

- The password is prompted for and hidden. It must be at least 12 characters and must not contain the username.
- It is stored only as a salted **scrypt** hash.
- Running the command again for an existing username **resets the password** and signs that admin out everywhere.
- `--deactivate` disables an account and ends its sessions.
- For CI or automation, pipe the password in: `printf '%s' "$PW" | npm run admin:create -- --username <name> --password-stdin`. Never pass passwords as arguments, because they end up in shell history.

---

## Data migration (`leaderboard_2026-10-27.json`)

The original export is kept unchanged in `data/leaderboard_2026-10-27.json` as a backup; the importer only reads it.

```bash
npm run db:import                         # import (safe to re-run)
npm run db:import -- --dry-run            # validate + report, write nothing
npm run db:import -- path/to/other.json   # a different export
npm run db:import -- --overwrite          # replace DB values that differ from the file (rarely wanted)
```

What the importer guarantees:

| Requirement | How |
| --- | --- |
| Every member imported, data preserved exactly | `id`, `name`, `score`, `status`, and `createdAt` are stored verbatim. Names are not trimmed or normalised, and scores are not recalculated. The per-member `history` array is kept in `members.legacy_history` and shown in **Audit history** when you filter by member. |
| Settings preserved | `pointSettings` drive the dashboard's quick-action buttons (+5, +1, −1). `appSettings` and the top-level `history` are stored as `legacyAppSettings` and `legacyGlobalHistory`. |
| Idempotent, no duplicates | Members are matched by `id`. Re-running inserts only missing members. |
| Admin changes are never clobbered | After the first import, the database is the source of truth. A member already in the database whose values differ from the file is **skipped and reported**, unless you pass `--overwrite`. An overwrite is itself audited. |
| Malformed records reported | Each bad record is listed with its index and the reasons. Valid records still import, and the command exits with code 2. A file that isn't a leaderboard export aborts with no changes. |
| Summary | Prints records / imported / updated / skipped / rejected, the file's SHA-256, settings results, and warnings (such as a history that doesn't sum to the score). Each run is also logged in `import_runs`. |
| Atomic | The whole import is one transaction. |

Inactive members are imported and kept. They're hidden only from the public ranking.

---

## How it works

### Data model (`db/migrations/001_initial_schema.sql`)

| Table | Purpose |
| --- | --- |
| `members` | `id`, `name`, `score`, `status` (`active`/`inactive`), `legacy_history`, `version` (optimistic-concurrency token), timestamps |
| `admins` | Usernames and scrypt password hashes |
| `admin_sessions` | SHA-256 of each session token, expiry, IP, and user agent |
| `login_attempts` | Failed-login records used for rate limiting |
| `point_adjustments` | **Audit log:** member, previous total, new total, delta, kind (`adjust`/`set`/`reset`/`import`), reason, admin, timestamp |
| `member_events` | **Audit log:** member created, renamed, deactivated, reactivated, or imported |
| `app_settings` | Point settings and preserved legacy settings |
| `import_runs` | One row per import, with its summary |

Both audit tables are **append-only**; a database trigger rejects `UPDATE` and `DELETE`. Members are never hard-deleted.

### Security

- **Server-side auth only.** Every `/api/admin/*` handler verifies the session against the database before doing anything. The `/admin` page also checks on the server and redirects to the login page. Hiding UI is not the protection.
- **Sessions.** The session cookie holds a random 256-bit token; only its SHA-256 is stored. It is `HttpOnly`, `SameSite=Strict`, and in production `Secure` with the `__Host-` prefix. Sessions expire after 8 hours. Logging out deletes the session server-side, and deactivating an admin or resetting their password ends their sessions immediately.
- **Passwords.** Hashed with salted scrypt (N=2¹⁵, r=8, p=1); nothing is stored in localStorage or sessionStorage.
- **No account enumeration.** "Invalid username or password." is returned in every failure case. Unknown usernames still run a full hash comparison, so response timing doesn't reveal valid usernames either.
- **Rate limiting** (stored in the database, so it works across serverless instances), per 15 minutes:
  - 5 failures per IP + username
  - 20 per IP
  - 50 per username
- **CSRF.** State-changing requests require a same-origin `Origin` header and a JSON body, on top of the `SameSite=Strict` cookie.
- **Validation.** All inputs are checked with shared zod schemas on both the client and server: whole numbers, totals 0–1,000,000, adjustments ±10,000, names up to 100 characters with no control characters.
- **Server-side trust.** The acting admin always comes from the session; any admin id, username, or previous score in a request body is ignored.
- **Safe concurrent updates.** Each point change locks the member row, checks the `version` the admin last saw, and updates the score and audit log **in one transaction**. If someone else changed the member first, the request is rejected with 409 and the UI loads the fresh values; it never silently overwrites newer data.
- **Large changes need confirmation.** Changes of ±10 or more, and resets to 0, are refused by the server unless the request is explicitly confirmed.
- **Injection and XSS.** All SQL is parameterised, React escapes all rendered text, and a strict Content-Security-Policy plus `X-Frame-Options`, `nosniff`, HSTS, and related headers are set in `next.config.ts`.
- **No leaked internals.** Unexpected errors return a generic message; details go only to server logs.
- **Minimal public data.** The public API returns only `id`, `name`, `score`, and `rank` for **active** members.
- **Supabase lockdown.** Row Level Security is enabled on every table with no policies, and table privileges are revoked from `anon` and `authenticated`, so Supabase's auto-generated REST API exposes nothing. The app connects as the database owner from the server only.

### Live updates

The leaderboard polls `/api/leaderboard` every 5 seconds while the tab is visible. ETags make unchanged polls a cheap `304`. It also refreshes immediately when the tab regains focus, and instantly when an admin makes a change in another tab of the same browser (via `BroadcastChannel`).

### Ranking

Members are ranked by points, highest first, using competition ranking: tied members share a rank and the next rank is skipped (1, 1, 3). Ties are listed alphabetically. Ranks 1, 2, and 3 get gold, silver, and bronze styling, and first place gets a crown and a "Leader" badge.

---

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Vitest suite (each test uses its own in-memory Postgres) |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run db:migrate` | Apply new migrations in `db/migrations/` |
| `npm run db:import` | Import a leaderboard export |
| `npm run admin:create` | Create an admin or reset an admin's password |

To change the schema, add a new numbered `.sql` file to `db/migrations/`. Applied migrations are tracked in `schema_migrations`, and each runs in a transaction.

### Tests

`tests/` covers:

- **Authentication:** generic login errors, cookie flags, hashed tokens, logout, expiry, deactivated admins, rate limiting.
- **Authorization:** every admin endpoint returns 401 without a session or with a forged one; CSRF is blocked; client-supplied admin ids are ignored.
- **Score adjustments:** add, subtract, set, and reset; negative totals are blocked; stale writes are rejected; concurrent requests are handled; large changes require confirmation; a failed audit insert rolls back the score; audit records are append-only.
- **Migration:** the exact field-by-field match against the real JSON file, idempotency, no clobbering of admin edits, `--overwrite`, dry runs, malformed-record reporting, and an unchanged source file.
- **Persistence:** data and audit history survive closing and reopening an on-disk database, and the import stays safe to re-run after a restart.

### Project layout

```
data/                       original JSON export (read-only backup)
db/migrations/              SQL schema migrations
scripts/                    migrate / import / create-admin CLIs
src/app/                    pages and API route handlers
src/components/             leaderboard, admin dashboard, UI primitives
src/lib/auth/               password hashing, sessions, rate limiting
src/lib/db/                 Postgres/PGlite client and migration runner
src/lib/import/             JSON importer
src/lib/server/             business logic (members, points, audit) and HTTP helpers
src/lib/validation.ts       shared client/server validation
tests/                      Vitest suite
```

---

## Manual configuration checklist

- [ ] Create a Supabase (or other PostgreSQL) database.
- [ ] Run `npm run db:migrate` and `npm run db:import` against it.
- [ ] Create the first admin with `npm run admin:create`.
- [ ] In Vercel, set `DATABASE_URL` (transaction pooler) and preferably `DATABASE_CA_CERT`.
- [ ] Optional: if the site is served from more than one domain, list the extra origins in `APP_ORIGINS`.
- [ ] Optional: in Supabase, turn off the Data API (**Project Settings → API**), since the app doesn't use it. It is already locked down by RLS.
- [ ] If you deploy somewhere other than Vercel, put the app behind a proxy that sets `X-Forwarded-For` / `X-Real-IP` correctly; rate limiting uses them.
