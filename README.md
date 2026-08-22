# StowNest — Operations & Analytics Platform

Internal platform for running the business off the operations spreadsheet:
department dashboards, analytics with drill-down, record CRUD, role-based
access and an executive presentation mode.

React + TypeScript + Vite on the front, Vercel serverless functions on the back,
Google Sheets as the system of record for v1.

---

## What is built

| Area | State |
|---|---|
| Design system, tokens, light + dark | Complete |
| App shell, permission-derived navigation | Complete |
| Executive Overview | Complete |
| Department dashboards (all 8, config-driven) | Complete |
| Analytics / business review (build-your-own view) | Complete |
| Record detail pages | Complete |
| Reports and export (CSV, print-to-PDF) | Complete |
| Presentation mode | Complete |
| Administration — users, permissions, sheet mapping health | Complete |
| Chart library (9 types, hand-built SVG) | Complete |
| Data table (sort, group, filter, paginate, bulk, columns) | Complete |
| Permission engine, shared client + server | Complete |
| Sheets read/write API with audit trail | Complete |
| **Column mapping verified against the real sheet** | **Not done — see below** |

---

## The one thing you must do before trusting a number

I have never seen your spreadsheet. Every `sheetColumn` value in
`src/config/datasets.ts` is a **plausible guess at your header text**, not a
verified mapping.

Open `src/config/datasets.ts` and set each `sheetColumn` to the exact header
text in the corresponding tab:

```ts
{ key: 'amount_paid', header: 'Received', type: 'currency',
  sheetColumn: 'Amount Paid' },   // <-- must match the sheet header exactly
```

That file is the **only** place in the codebase that knows about sheet headers.
Rename a header in Sheets, change one line here, and nothing else moves.

A column with no `sheetColumn` is treated as absent. It is hidden from tables
and forms, and any metric requiring it renders **"Data unavailable"** naming the
exact missing column — it never becomes a zero. `expenses.is_marketing_spend`
is deliberately left unmapped so you can see this behaviour: Cost per lead and
CAC both report themselves unavailable rather than inventing a number.

**Administration → Settings** lists every unmapped column and every metric it
blocks. Work down that page until it is clean.

---

## Setup

### 1. Install and run on sample data

```bash
npm install
cp .env.example .env
# set VITE_DATA_SOURCE=demo
npm run dev
```

Demo mode runs on generated sample rows and shows a permanent amber banner on
every screen. It is never used as a fallback — if the live Sheets connection
fails, you get an error, not quietly substituted fake numbers.

### 2. Google Cloud

1. Create a project, enable the **Google Sheets API**.
2. Create a **service account**. Create a JSON key. Keep it out of the repo.
3. **Share the spreadsheet with the service account email as Editor.**
   Nothing works until you do this — the service account is a separate identity.
4. Create an **OAuth 2.0 Client ID** (Web application). Add your Vercel URL and
   `http://localhost:5173` to authorised JavaScript origins.

### 3. Spreadsheet tabs

One tab per dataset. Tab names are set by `sheetName` in the config:

`leads` · `customers` · `jobs` · `vendors` · `space` · `movements` · `tasks` ·
`invoices` · `expenses` · `access_control` · `audit_log`

**`access_control`** controls who gets in. Columns:

| Email | Name | Role | Departments | Grants | Status |
|---|---|---|---|---|---|
| you@stownest.com | You | super_admin | | | Active |
| ops@stownest.com | Ops Lead | department_admin | operations,logistics | | Active |
| exec@stownest.com | Analyst | employee | sales | EXPORT | Active |

`Departments` is a comma-separated list of department ids, ignored for
super admins. `Grants` adds actions on top of the role default — this is how you
give one person `EXPORT` or `DELETE` without promoting them. Setting `Status` to
`Suspended` revokes access on their next request.

**`audit_log`** needs headers: `Timestamp, Actor, Action, Dataset, Record, Detail`.
Every create, update and delete appends a row.

### 4. Environment variables

Set these in Vercel. Only `VITE_*` reaches the browser.

```
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
VITE_DATA_SOURCE=sheets

GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_SA_EMAIL=sn-platform@project.iam.gserviceaccount.com
GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
SHEETS_SPREADSHEET_ID=1AbC...
SUPER_ADMIN_EMAILS=you@stownest.com
ALLOWED_HOSTED_DOMAIN=stownest.com
```

`SUPER_ADMIN_EMAILS` is a bootstrap: those addresses can sign in before the
access sheet has a row for them, otherwise nobody could ever add the first user.

### 5. Deploy

```bash
vercel --prod
```

---

## Security model

The browser never touches Google Sheets. It receives a Google **ID token only** —
no Drive or Sheets scope — and sends it to our own `/api` routes. Those routes:

1. Verify the token against Google's public keys for our client id.
2. Optionally enforce your Workspace domain.
3. Look the verified email up on `access_control` to resolve role and departments.
4. Run `can(principal, action, department)` before touching the sheet.

The role always comes from the sheet, never from the request, so nobody can
promote themselves by editing a payload. `src/lib/permissions/policy.ts` is
imported by both the UI and the API, so the two cannot drift apart — the UI
hiding a Delete button is a courtesy, the server check is the control.

Writes are additionally filtered by config: a request can only set columns that
are both `editable` and mapped. Values beginning `=`, `+`, `-` or `@` are
prefixed with an apostrophe so a submitted value cannot become a live formula
inside the spreadsheet.

---

## Data accuracy

Requirement one, and the reason for the `ƒ` button on every metric card.

* Every metric declares its required columns, its literal formula and a plain
  English definition. Click `ƒ` on any card to see all three plus the sheet tabs
  it read.
* Missing column → "Data unavailable", naming the column. Never zero.
* Empty selection → "No records". Zero denominator → "Insufficient data".
* **Revenue ≠ Collections ≠ Profit**, and they are separate metrics with
  separate formulas that cannot be confused:
  * Revenue = `SUM(invoices.amount)` excluding void
  * Collections = `SUM(invoices.amount_paid)` excluding void
  * Outstanding = revenue − collections
  * Profit = revenue − `SUM(expenses.amount)`
* Deltas compare against the immediately preceding window of equal length.
  All-time has no comparable prior window, so deltas are suppressed rather than
  guessed.
* Time series zero-fill empty buckets. A month with no invoices plots at zero;
  skipping it would make a flat line look like growth.
* Correlation is only shown at n ≥ 6, printed with its sample size and an
  explicit "association only, not cause".

Run `npm run check` to typecheck and execute the behavioural suite covering
Indian date parsing, currency formatting, the unavailable-metric path, the
revenue/collections separation, period maths, zero-fill, ageing buckets and
permission fail-closed behaviour.

---

## Architecture

```
src/config/        departments, datasets (sheet mapping), metrics — plain data
src/lib/data/      DataAdapter interface + Sheets adapter + demo adapter + cache
src/lib/analytics/ period, filters, aggregation, metric resolution
src/lib/permissions/ policy shared with the API
src/components/    primitives, charts, table, metric card, shell
src/pages/         one page per surface; Department serves all 8 departments
api/               Vercel functions: the only code that sees the sheet
```

**Adding a department** is an entry in `src/config/departments.ts` plus its
datasets and metrics. No new route, page, guard or navigation change.

**Replacing Sheets with a real backend** means writing one class implementing
`DataAdapter` in `src/lib/data/` and changing which one `store.ts` instantiates.
Pages, hooks, charts and tables know only that interface, so none of them
change. That is the seam that keeps this from being a dead end when the
spreadsheet stops scaling.

**Performance.** One cache per dataset with a single in-flight request shared by
every subscriber — ten metric cards and four charts on a screen produce one
Sheets read, not fourteen. 60-second freshness window, background revalidation,
5-minute staleness flagged in the control bar. Routes are code-split; the
Overview does not carry the analytics or admin bundles.

---

## Known gaps

* **Column mappings are unverified.** See the top of this file.
* The demo data generator is compiled into the production bundle even when
  `VITE_DATA_SOURCE=sheets` (~6 KB). Worth converting to a dynamic import.
* Delete removes a spreadsheet row outright. If you want recoverable deletes,
  add an `archived` column and switch `deleteRowByIndex` to a flag update.
* Sheets has no change feed, so "refresh" is a poll. If two people edit the same
  row within the 60-second window, last write wins. Move to a database before
  concurrent editing matters.
* No tests on the React components — the suite covers the calculation, period
  and permission layers, which is where a wrong answer is expensive.
