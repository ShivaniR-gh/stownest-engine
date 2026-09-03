# StowNest Dashboard — Updated Architecture Proposal

Revised to reflect your decisions on monthly tabs, existing data, Order ID, and permissions. No code changed yet.

**Note on the screenshot:** the permissions screenshot referenced in decision 4 didn't come through in this thread. I've worked from the actual implementation in `src/lib/permissions/policy.ts`, which you also named as source of truth. If the screenshot shows anything the code doesn't, send it and I'll reconcile.

---

## What these decisions changed

Three of them simplify the work substantially:

**No migration** (decision 2) removes the hardest unknown. Schemas no longer have to match whatever headers exist in the current sheets. The app defines headers; new tabs get them; old tabs are left alone.

**Explicit month selection** (decision 1) removes date-inference. The user picks February from a dropdown, so the server never has to derive a tab from a record's date. This also makes the destination auditable — it's a parameter, not a computation.

**Manual Order ID** (decision 3) means no ID generation, but it does mean uniqueness must be checked before writing.

One decision adds a security requirement that wasn't in the previous proposal — see §3.

---

## 1. Proposed schema structure

Extend the existing `ColumnDef` and `DatasetDef` in `src/config/types.ts`. Additive only; every current dataset keeps working unchanged.

```ts
export interface ColumnDef {
  // ---- all existing fields unchanged ----
  key: string;
  header: string;
  type: ColumnType;
  sheetColumn?: string;
  enumValues?: string[];
  required?: boolean;
  editable?: boolean;
  // ---- new ----
  unique?: boolean;        // checked server-side against the destination tab
  min?: number;            // numbers: value; dates: earliest
  max?: number;
  pattern?: string;        // regex source, validated both sides
  patternHint?: string;    // "ORD-001" — shown when the pattern fails
}

export interface DatasetDef {
  // ---- all existing fields unchanged ----
  id: string;
  label: string;
  noun: string;
  department: DepartmentId;
  sheetName: string;
  spreadsheetEnv?: string;
  idColumn: string;
  columns: ColumnDef[];
  // ---- new ----
  /** 'static' (default) writes to sheetName. 'monthly' writes to a tab the
   *  user selects from `tabOptions`. */
  tabStrategy?: 'static' | 'monthly';
  /** The CLOSED set of tabs this dataset may write to. Nothing outside this
   *  list is ever accepted from the client. */
  tabOptions?: string[];
  /** Create a missing tab with schema headers rather than rejecting. */
  createMissingTab?: boolean;
}
```

Facility Orders, as an example (real headers pending the sample sheets — see §13):

```ts
{
  id: 'facility_orders',
  label: 'Orders',
  noun: 'order',
  department: 'facility',
  spreadsheetEnv: 'SHEETS_ID_FACILITY_ORDERS',
  sheetName: 'Orders',
  idColumn: 'order_id',
  tabStrategy: 'monthly',
  tabOptions: ['January','February','March','April','May','June',
               'July','August','September','October','November','December'],
  createMissingTab: true,
  columns: [
    { key: 'order_id',    header: 'Order ID',    type: 'id',       sheetColumn: 'Order ID',
      required: true, editable: true, unique: true,
      pattern: '^[A-Za-z0-9-]{3,32}$', patternHint: 'e.g. ORD-001' },
    { key: 'vendor_name', header: 'Vendor Name', type: 'text',     sheetColumn: 'Vendor Name',
      required: true, editable: true },
    { key: 'order_date',  header: 'Order Date',  type: 'date',     sheetColumn: 'Order Date',
      required: true, editable: true },
    { key: 'item',        header: 'Item',        type: 'text',     sheetColumn: 'Item',
      required: true, editable: true },
    { key: 'quantity',    header: 'Quantity',    type: 'number',   sheetColumn: 'Quantity',
      required: true, editable: true, min: 1 },
    { key: 'price',       header: 'Price',       type: 'currency', sheetColumn: 'Price',
      required: true, editable: true, min: 0 },
    { key: 'status',      header: 'Status',      type: 'enum',     sheetColumn: 'Status',
      required: true, editable: true,
      enumValues: ['Pending','Approved','Delivered','Cancelled'] },
  ],
}
```

The `columns` array is the single definition of what the form shows, what the server validates, what a created tab's header row contains, and which sheet column each value lands in. One list, four uses — they cannot drift apart.

---

## 2. Proposed spreadsheet configuration

Already supported by `spreadsheetIdFor()` in `api/_lib/sheets.ts`, which resolves in this order:

1. `ds.spreadsheetId` — literal id from the `data_sources` tab
2. `ds.spreadsheetEnv` — named Vercel env var, e.g. `SHEETS_ID_FACILITY_A`
3. `SHEETS_SPREADSHEET_ID` — the default control workbook

So a department with several workbooks is just several datasets naming different ids:

```
Facility
├── SHEETS_ID_FACILITY_A
│   ├── facility_vendors      → Vendors      (static)
│   ├── facility_orders       → monthly tabs (Jan…Dec)
│   └── facility_maintenance  → Maintenance  (static)
└── SHEETS_ID_FACILITY_B
    └── facility_inventory    → Inventory    (static)
```

No "one department = one sheet" assumption exists anywhere in the code.

**Recommendation:** use `spreadsheetEnv` rather than putting ids in the `data_sources` tab. Ids stay out of the repo, differ per environment, and are managed in Vercel alongside the service-account key.

---

## 3. Proposed tab / month handling

The user selects the month; the client sends it; **the server treats it as untrusted input.**

```
POST /api/data/facility_orders?tab=February
```

Resolution, server-side:

```
tabStrategy === 'static'   → use ds.sheetName. Ignore any client tab entirely.
tabStrategy === 'monthly'  → require a tab param
                             → must be in ds.tabOptions (exact match)
                             → otherwise 400, no write
```

### Why the closed list matters

This is the one genuinely new risk the month feature introduces, and it needs stating plainly.

If the server accepted an arbitrary tab name from the client, a crafted request could append a row to **any tab in that workbook**. Where a dataset points at the control workbook, that includes `access_control` — and a row there grants a role. An employee with CREATE on one department could escalate to super admin.

`tabOptions` closes this. The tab is chosen from a list the application defines, never from free text. A request naming a tab outside the list is rejected before any Sheets call.

This is also why month selection must not fall back to "derive from the record date" — a date is user input too, and formatting it into a tab name reopens the same hole.

---

## 4. Proposed column mapping

Unchanged from what the code already does, which is the right approach.

Writes go through `toSheetRow()`, which positions each value against the **live header row** by matching `sheetColumn` case- and whitespace-insensitively:

```ts
const i = headers.findIndex(h => norm(h) === norm(c.sheetColumn!));
if (i >= 0) out[i] = String(values[c.key] ?? '');
```

Consequences worth knowing: reordering columns in the sheet doesn't corrupt writes; a column in the sheet the schema doesn't know about is left untouched; a schema column missing from the sheet is skipped rather than shifting everything after it.

That last case shouldn't happen for app-created tabs, but it can if someone edits headers by hand. See §8 for how that's detected.

---

## 5. Proposed permission enforcement

**No changes.** `api/data/[dataset].ts` already implements exactly what decision 4 asks for:

```ts
const METHOD_ACTION: Record<string, Action> = {
  GET: 'VIEW', POST: 'CREATE', PATCH: 'UPDATE', DELETE: 'DELETE',
};

const principal = await authenticate(req);
const ds = await getDatasetDef(id);
if (!can(principal, action, ds.department)) throw new HttpError(403, …);
```

`can()` lives in `src/lib/permissions/policy.ts` and is imported by **both** the React app and the serverless functions. The UI uses it to hide buttons; the API uses it to refuse requests. Same function, so they cannot disagree.

Role defaults as implemented:

| Role | VIEW | CREATE | UPDATE | DELETE | EXPORT | ANALYTICS | MANAGE_USERS | MANAGE_PERMISSIONS |
|---|---|---|---|---|---|---|---|---|
| Super admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Department admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Employee | ✓ | ✓ | ✓ | — | — | ✓ | — | — |

Plus per-person `grants` (add an action) and `denies` (remove one, applied last and winning over everything). Department scope via `hasDepartment()`; non-global actions fail closed when no department is supplied.

Adding month selection changes nothing here — a monthly write is still `POST` → `CREATE` → checked against `ds.department`.

**Per decision 8**, the employee needs no Google Sheets access at all. The service account performs the write; direct workbook access stays with whoever you've shared it with.

---

## 6. Proposed serverless API flow

```
POST /api/data/facility_orders?tab=February
  │
  ├─ authenticate(req)              → Google ID token verified for our client id
  │                                   AND email active on access_control
  │                                   → 401 if not
  │
  ├─ getDatasetDef('facility_orders')
  │                                   → 404 if unknown dataset
  │
  ├─ can(principal, 'CREATE', ds.department)
  │                                   → 403 if not permitted
  │
  ├─ resolveDestinationTab(ds, 'February')
  │                                   → 400 if not in ds.tabOptions
  │
  ├─ validate(ds, body.values)        → 400 with per-field errors
  │     required · type · enum · min/max · pattern · date validity
  │     formula-injection neutralised
  │
  ├─ uniqueness check on unique columns (reads destination tab)
  │                                   → 409 "Order ID ORD-001 already exists in February"
  │
  ├─ ensureTabWithSchema(ds, 'February')
  │                                   → creates tab + headers if missing
  │
  ├─ appendRow(ds, values, tab)       → Google Sheets API
  │                                   → any Sheets error propagates as a failure
  │
  ├─ audit(...)                       → append-only trail; failure logged, not fatal
  │
  └─ 200 { row }                      ONLY after Sheets confirms
```

Every failure path returns before any write. There is no partial-success state.

---

## 7. Proposed Google Sheets write flow

```
resolve spreadsheet id     spreadsheetIdFor(ds)            [exists]
resolve + ensure tab       ensureTabWithSchema(ds, tab)    [new, wraps existing ensureTab]
read live header row       headerRow(ds, tab)              [exists, needs tab param]
build positioned row       toSheetRow(ds, headers, values) [exists]
append                     values/{tab}!A1:append          [exists]
parse row number from      updates.updatedRange            [exists]
return { ...values, __row, __id }
```

The only change to `appendRow` is accepting a resolved tab instead of always using `ds.sheetName`.

---

## 8. How missing monthly tabs will be created

`ensureTab(spreadsheetId, title, headers)` **already exists** in `api/_lib/sheets.ts` and does most of this. It's currently used to create config tabs. Its behaviour:

1. `listTabs()` — is the tab there?
2. If not, `batchUpdate` with `addSheet` to create it
3. Read row 1; if empty, write the header array

What needs adding is a thin wrapper that derives the headers from the schema and verifies an existing tab:

```ts
async function ensureTabWithSchema(ds: DatasetDef, tab: string) {
  const sid = spreadsheetIdFor(ds);
  const headers = ds.columns.filter(c => c.sheetColumn).map(c => c.sheetColumn!);

  await ensureTab(sid, tab, headers);          // creates + headers if absent

  // Tab existed already: confirm its headers can receive every required column.
  const live = await readRange(sid, rangeForSheet(tab, '1:1'));
  const present = new Set((live[0] ?? []).map(norm));
  const missing = ds.columns
    .filter(c => c.sheetColumn && c.required && !present.has(norm(c.sheetColumn)))
    .map(c => c.sheetColumn);

  if (missing.length) {
    throw new HttpError(409,
      `The "${tab}" tab is missing required columns: ${missing.join(', ')}. ` +
      `Ask an admin to correct the tab headers.`);
  }
}
```

Per decision 7, headers come from `ds.columns` — never copied from another tab. A created February tab gets exactly:

```
| Order ID | Vendor Name | Order Date | Item | Quantity | Price | Status |
```

The verification step matters for decision 6. Without it, a hand-edited tab with a renamed header would silently drop that column's value on every write — the row would appear in the sheet with a blank where the price should be, and nobody would know until someone totalled the column.

**One item for your confirmation:** should the created tab be given a frozen header row and basic formatting (bold row 1), so a manually-opened sheet looks intentional rather than raw? It's a small addition to the `addSheet` request. My recommendation is yes.

---

## 9. How validation will work

Two layers, one schema, server authoritative.

| Rule | Frontend | Server | Source |
|---|---|---|---|
| Required | ✓ | ✓ | `required` |
| Type (number, date, email) | ✓ | ✓ | `type` |
| Enum membership | ✓ (as a select) | ✓ | `enumValues` |
| Min / max | ✓ | ✓ | `min` / `max` |
| Pattern | ✓ | ✓ | `pattern` |
| Date validity | ✓ | ✓ | `type: 'date'` |
| Length ≤ 2000 | — | ✓ | fixed |
| **Uniqueness** | — | ✓ | `unique` |
| **Formula injection** | — | ✓ | fixed |
| **Unknown/non-editable keys dropped** | — | ✓ | `columns` is the allow-list |

The last three are server-only by design. Uniqueness needs the live sheet. Formula injection — a value starting `=`, `+`, `-` or `@` executes as a formula inside Sheets — is already neutralised in `sanitise()` by prefixing with `'`. And `sanitise()` iterates the schema rather than the request body, so a crafted request cannot write to a column that isn't editable or doesn't exist.

Shared rules go in a new `api/_lib/validate.ts` imported by both sides, the same pattern `policy.ts` already uses for permissions.

### Uniqueness scope — needs your decision

Per decision 3, Order ID is entered manually and may need to be unique. **Unique within what?**

- **Within the destination tab** — ORD-001 could exist in both January and February. One read, fast.
- **Across all tabs in the dataset** — ORD-001 is unique for all of Facility Orders. Requires reading every month tab on every submit; slow and gets slower each month.

I'd suggest per-tab unless the business genuinely needs global. If global is required, a better shape is a hidden index tab the app maintains, rather than scanning twelve tabs per write.

There's also a race worth naming: two people submitting ORD-001 within the same second can both pass the check before either writes. Sheets has no unique constraint, so this cannot be fully closed at the API layer. Rare in practice at your volumes, but it means uniqueness here is a strong check, not a guarantee.

---

## 10. How the existing access-control system is reused

Nothing new is built. The chain is already in place end to end:

```
access_control tab (Google Sheet)
  → principalFromRow()      parses role, departments, grants, denies
  → authenticate()          verifies Google token, looks up the row
  → Principal
  → can(principal, action, department)
      ├─ React: hide/show buttons          (convenience)
      └─ API:   allow/refuse the request   (the actual control)
```

`principalFromRow()` also drops department ids that aren't in the runtime registry and logs them, so a typo in the sheet can't silently look like access to a department that doesn't exist.

Only one addition is needed on the UI side: the month picker and Add-record button should be gated on `can(principal, 'CREATE', department)` using the existing `usePermission` hook and `Gate` component. That's consistent with how every other action in the app is already gated.

---

## 11. Files that need to change

| File | Change | Size |
|---|---|---|
| `src/config/types.ts` | Add `unique`/`min`/`max`/`pattern` to `ColumnDef`; `tabStrategy`/`tabOptions`/`createMissingTab` to `DatasetDef` | Small |
| `src/config/datasets.ts` | Add real Facility schemas (pending §13) | Medium |
| `api/_lib/sheets.ts` | `appendRow`/`updateRowByIndex`/`deleteRowByIndex`/`headerRow` accept a resolved tab; add `ensureTabWithSchema` | Medium |
| `api/data/[dataset].ts` | Resolve + validate tab param; call shared validator; uniqueness check; per-field errors | Medium |
| `src/components/data/RecordForm.tsx` | Month selector for monthly datasets; validation parity; field-level server errors | Medium |
| `src/lib/data/adapter.ts` + `sheetsAdapter.ts` | Thread an optional `tab` through `create()` | Small |
| `src/lib/data/store.ts` | Pass `tab` to `createRow` | Small |

## New files

| File | Purpose |
|---|---|
| `api/_lib/validate.ts` | Shared validation, imported by both layers |
| `api/_lib/tabs.ts` | `resolveDestinationTab()` + `ensureTabWithSchema()` |
| `src/config/datasets/facility.ts` | Facility schemas, once there are several |

## 12. Files that can remain unchanged

Everything else — around 60 of the 80 source files. Specifically:

- **All authentication:** `api/_lib/auth.ts`, `api/auth/session.ts`, `googleIdentity.ts`, `AuthContext.tsx`
- **All permissions:** `policy.ts`, `Gate.tsx`, `usePermission.ts`, `scope.ts`
- **All charts and metrics:** 10 chart components, `metrics.ts`, the whole `lib/analytics/` folder
- **Shell and primitives:** `AppShell`, `Sidebar`, `TopBar`, `Icon`, `primitives/index`
- **Sheets read path:** `readDataset()`, `resolveTab()`, `spreadsheetIdFor()`, `audit()`
- **Data table, drill-down, dataset panel, export, formatting**
- **All admin pages:** users, permissions, departments, settings

---

## 13. Still needed from you

**The sample spreadsheets.** Both links require authentication I don't have. Per your earlier instruction I'm not guessing at structure, so the concrete Facility schemas can't be written yet.

Since there's no migration (decision 2), I need less than before — not the existing data, just the intended shape:

1. **Tab names** in each workbook, and which are monthly vs static
2. **Exact column headers** for each dataset, in the order you want them created — spelling and spacing matter, they become `sheetColumn` and the created tab's header row
3. **Allowed values** for any status/category fields
4. **Which fields are required**

A downloaded `.xlsx`, a pasted header row per tab, or just a typed list all work equally well.

## 14. Open items for your confirmation

| # | Question | My recommendation |
|---|---|---|
| a | Uniqueness scope: per-tab or across all months? | Per-tab |
| b | Format created tabs (bold + frozen header row)? | Yes |
| c | Spreadsheet ids via `spreadsheetEnv` (Vercel) or the `data_sources` tab? | `spreadsheetEnv` |
| d | Existing tab with mismatched headers: reject, or add the missing columns? | Reject with a clear message — silently altering someone's sheet is worse |
| e | Should UPDATE and DELETE also work on monthly tabs, or is monthly create-only for now? | Confirm — affects scope |
| f | Confirm the earlier seed-dataset cleanup is **not** applied (it conflicts with app-defined schema). Demo-data removal still stands. | Don't apply |

---

## One risk to note before implementation

`deleteRowByIndex` resolves its tab through `tabId(sid, ds.sheetName)` — the static name — rather than a passed-in tab. If monthly datasets ever support delete (open item **e**), that path would delete from the wrong tab. It needs the same tab parameter as the other write functions.

Related: until every write path is verified against a scratch workbook, no destructive operation should run against the real Facility sheets. A mis-resolved tab on a read shows wrong numbers and someone notices; on a write or delete it damages a sheet another team owns, and nobody notices until the numbers stop reconciling.
