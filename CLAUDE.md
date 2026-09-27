# SplitChinchin — Project Memory

Multi-currency expense-splitting web app. Single-file frontend, Google Sheets backend.

## Architecture
- **`index.html`** — entire frontend (HTML + CSS + vanilla JS in one file). No framework, no build step. Pushed to GitHub → auto-deploys to Vercel at https://splitchinchin.vercel.app
- **`Code.gs`** — Google Apps Script Web App = the backend/API. Reads/writes a Google Sheet. Must be **redeployed as a NEW VERSION** in the Apps Script editor after any change (existing deployment does not auto-update).
- **`api/scan-receipt.js`** — Vercel serverless function. Proxies image/text to the Anthropic API for receipt scanning. Uses `ANTHROPIC_API_KEY` env var. Model string: `claude-sonnet-4-5`.

## Backend API (Google Apps Script)
- Frontend calls it via `apiOnce()` using **fetch** (not JSONP), parsing the JSONP-wrapped response manually.
- API URL is the `/exec` deployment URL, stored as `API_URL` const in index.html.
- Routing: `doGet(e)` switches on `e.parameter.action`, dispatches to named functions, returns `JSONP(callback, result)`.

## Google Sheet tabs & columns
**Expenses** (col order is load-bearing — `addExpense` appends positionally):
`A expenseId | B projectId | C itemName | D amount | E currency | F payerId | G payerName | H splitBetween | I category | J notes | K customSplits | L expenseDate | M logDate | N createdAt`

Other tabs: **Projects** (projectId, name, defaultCurrency, archived, createdAt), **Members** (memberId, projectId, name), **Categories** (projectId, name), **FxRates**, **Payments** (paymentId, projectId, fromId, fromName, toId, toName, amount, currency, note, createdAt).

- `splitBetween` stored as comma-joined member IDs.
- `sheetData()` trims header names (a trailing space on `expenseDate ` once caused silent column-key mismatches — keep the trim).

## Key frontend state
- `state = { project, projectId, members, categories, expenses, payments, currency, me }`
- `allProjectsCache` — all projects, loaded on landing; may be empty when deep-linking into a project (fetch `getAllProjects` before relying on it).
- `isAdmin` — `sessionStorage("sc_admin")==="1"`, unlocked via landing "Admin" button + code `sfg`.

## Existing features (DO NOT REGRESS)
Add/edit/delete expense; batch import (screenshots/CSV/PDF → AI scan → per-row review with Save & next); direct Wise CSV parse; duplicate detection; batch edit (multi-select → set category/payer/split/project); per-expense "✓ settle" button; move-expense-to-project (admin); project currency inline edit; admin Expense Summary (cross-project, category breakdown, month-over-month); FX rates; charts; payments/settle-up.

## Conventions
- Keep everything in the single `index.html` — do not split into modules or add a build step.
- Match the existing paper/serif aesthetic (CSS vars `--paper --ink --accent --rule --cream --serif --mono`).
- After editing `index.html`, verify JS parses (extract `<script>` blocks, `node --check`).
- Prefer small surgical edits over rewrites. Preserve working code.
- Add `console.log` on every API payload sent/received when touching data flows.

## Hard-won gotchas
- `Code.gs` must be redeployed as a new version to take effect.
- Model string changes when Anthropic retires dated versions (`*-20250514` → `claude-sonnet-4-5`). If image scan breaks with an opaque error, check this first.
- Dates from Sheets come back as JS `Date` objects; use `toISODate()` before putting them in `<input type="date">`.
- Never validate away a save silently — a guard that `return`s on a blank field with only a toast reads as "button does nothing".
