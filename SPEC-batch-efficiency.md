# Spec: Faster month-end batch entry (Rules Engine + Bulk Grid)

## Problem
At month-end I import 20+ receipt screenshots from different sources. Today I confirm each one **sequentially** (Save & next), and for every row I re-decide the same four things: **project, payer, split, category**. Most of these are the same every month for the same merchant. This is slow and repetitive.

## Goal
Turn ~20 sequential confirmations into ~3 bulk actions by (2) auto-filling decisions the app has seen before, and (3) reviewing everything on one grid instead of one-by-one.

Build both features. #2 feeds #3.

---

## Feature 2 — Rules Engine (learn from history, auto-fill on import)

### Concept
Every saved expense teaches the app a rule: *merchant keyword → {project, category, split members, payer}*. On the next import, each scanned row is matched against known rules and pre-filled. I only touch rows with no match.

### Data
Add a Google Sheet tab **`Rules`**:
`ruleId | keyword | projectId | category | splitBetween | payerId | hitCount | lastUsed`

- `keyword` = normalized merchant token (lowercased, trimmed, punctuation stripped, e.g. `parknshop`, `klook`, `spotify`).
- `splitBetween` = comma-joined member IDs (belonging to the rule's project).
- `hitCount` / `lastUsed` = for ranking when multiple rules could match.

### Backend (Code.gs) — new actions
- `getRules()` → all rows from Rules tab.
- `upsertRule({keyword, projectId, category, splitBetween, payerId})` → if keyword exists, update fields + increment hitCount + set lastUsed; else insert with hitCount=1. Return the rule.
- `deleteRule(ruleId)`.
- Remember: redeploy as new version after editing.

### Rule capture (when do rules get created/updated?)
- On **every successful expense save** (single add, edit, and each batch-import row), fire `upsertRule` in the background using that expense's merchant keyword + its final project/category/split/payer. Silent, non-blocking (`try/catch`, never block the save).
- Keyword extraction: take `itemName`, lowercase, strip digits/punctuation, take the first 1–2 significant words (skip generic words like "the", "ltd", "limited", "com", "hkg"). Keep a small stopword list. Store the whole normalized token.

### Rule application (on import)
- When the import review list is built, call `getRules()` once and cache.
- For each scanned row, normalize its `itemName` and find the best-matching rule (exact keyword match first; else `startsWith`/`includes`; if several match, pick highest hitCount, then most recent `lastUsed`).
- If matched, pre-fill that row's project, category, split, payer from the rule and tag the row visually as **auto-filled** (small "· auto" badge, muted). Unmatched rows get a highlighted "needs input" state.
- Matching is a **suggestion** — I can always override in the grid before saving. Overriding then re-teaches the rule on save.

### Edge cases
- New merchant → no rule → row flagged for input (falls back to current-project defaults: my member as payer, split = all members).
- Rule points at a project/member/category that was since deleted → treat as no-match, don't crash.
- Same merchant, different intent months apart (e.g. Klook was "household" once, "europe2026" another) → hitCount ranking surfaces the more common one; I override the exception.

---

## Feature 3 — Bulk Grid review (replace sequential Save & next)

### Concept
After scan/import, show all rows at once in a compact editable grid. Fix only exceptions, bulk-apply values to many rows, then one **Save all**.

### Layout
A full-screen review (reuse the existing full-page overlay pattern, not a small modal). One row per transaction:

`[✓ select] | itemName (editable) | amount (editable) | currency | date | project ▾ | payer ▾ | category ▾ | split (chips) | [auto badge] | [🗑]`

- Columns are inline dropdowns/inputs. Editing a cell updates that row's model immediately (read from DOM at save, same pattern the codebase already uses).
- Auto-filled rows render muted with an "· auto" tag; needs-input rows render highlighted.
- Sort/group control: **sort by merchant** so identical items cluster; also sort by project or by needs-input-first.

### Bulk actions (top bar)
- Checkbox per row + "select all" + "select all needs-input".
- With rows selected, a bulk bar (reuse existing batch-edit UI style) sets **project / payer / category / split** on every selected row at once. E.g. select 8 grocery rows → "set project = household" → all 8 update.
- Changing a row's **project** must refresh that row's available **members** (for split) and **categories** to the target project's — same contextual behaviour already built for move-to-project. When bulk-setting project, apply the target project's default split (all its members) unless a rule said otherwise.

### Save
- One **Save all** button. Iterates rows, calls `addExpense` for each with a progress bar (reuse `showProgress`). Rows can target different projects (project is per-row).
- On each save, background `upsertRule` (feature 2 capture).
- After all saved: refresh current project's expenses, show summary toast ("18 saved · 3 to other projects"), then a **Done ✓ — close** button (no auto-close).
- Keep duplicate detection: flag rows that match an existing expense (name + date) before saving; let me skip or save anyway.

### Replaces
This grid replaces the current one-by-one "Save & next" flow for batch import. Single add-expense and edit stay as they are.

---

## Acceptance (how I'll test)
1. Import 20 screenshots. Rows for merchants I've logged before come in pre-filled and tagged "auto"; new merchants are highlighted.
2. I select all "needs-input" rows, bulk-assign a project, and the split/category options for those rows switch to that project's.
3. I fix 2–3 individual cells inline.
4. One "Save all" → progress bar → all land in the right projects → Done button → I close.
5. Next month, the merchants I fixed this month now auto-fill (rules were learned).
6. No existing feature regressed (single add/edit, settle button, admin summary, CSV parse all still work).

## Build order
1. Rules tab + Code.gs actions (`getRules`, `upsertRule`, `deleteRule`) → redeploy.
2. Rule capture on existing saves (silent `upsertRule`).
3. Rule application + auto/needs-input tagging in import review.
4. Bulk grid layout replacing sequential review.
5. Bulk-apply bar + per-row project-context refresh.
6. Save all + progress + rule capture + duplicate check + Done button.

Do each step as a separate commit so I can test and roll back independently. Don't rewrite the file wholesale — surgical edits, preserve working code, `node --check` the script blocks after each change.
