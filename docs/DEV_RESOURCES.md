# DEV resources — CasitasManager

Created by Franco via `setupEnvironment()` / `setupDevEnvironment()` on **2026-11-04**.

These IDs are Franco’s Google resources (not secrets). Do **not** put Script tokens, Telegram bot tokens, or OAuth creds here.

## Spreadsheet

| Field | Value |
|-------|-------|
| ID | `1ym4VjGXIHcVxJB67FqXc24v2Eeawm9uFaRW-KYlvXzY` |
| URL | https://docs.google.com/spreadsheets/d/1ym4VjGXIHcVxJB67FqXc24v2Eeawm9uFaRW-KYlvXzY |

Unauthenticated HEAD check: **302** (resource exists; login required to open).

## Drive root folder

| Field | Value |
|-------|-------|
| ID | `1b1w62UKe7Pn-1pGCsyPnpjttzlWSILs` |
| URL | https://drive.google.com/drive/folders/1b1w62UKe7Pn-1pGCsyPnpjttzlWSILs |

Unauthenticated HEAD check: **404** (private folder — open while logged in as Franco).

## Apps Script DEV (local only)

Script ID lives in uncommitted `.clasp.dev.json` / `.clasp.json` on Franco’s Mac — not documented here. Editor: [script.google.com](https://script.google.com) → CasitasManager DEV.

## Contacts sheet (seeded)

Headers: `contact_id | property_id | role | name | email | telegram | active | notes`

| contact_id | role | name | email / telegram |
|------------|------|------|------------------|
| `owner_1` | owner | Propietario (completar) | **Fill with Franco’s test email** (and optional Telegram chat id) |
| `tenant_1` | tenant | Inquilino (completar) | **Leave empty in DEV** — dry-run notifies owners only |

## Safety

- DEV stays `DRY_RUN=true` until Franco opts out.
- No `setupTriggers` / `push:prod` / real tenant emails without explicit OK.
- Do not send real email or Telegram from automation while validating.

## Next clicks (Franco)

1. Open the [Sheet](https://docs.google.com/spreadsheets/d/1ym4VjGXIHcVxJB67FqXc24v2Eeawm9uFaRW-KYlvXzY) → **Contacts** → set `owner_1` email (and telegram if testing).
2. Keep `tenant_1` email blank.
3. In DEV Apps Script editor: `getSystemStatus()` → confirm `dryRun: true` and the IDs above.
4. Optional: `npm run push:dev` if local branch is ahead of what he last pushed (preflight should list **~25** files).
5. `previewMonthlyReport('2026-11')` — inspect preview only; do **not** `sendMonthlyReport` yet unless dry-run destinations are intentional.
6. Optional later: `importManualInvoice({…})` / Drive PDF helpers; Telegram token via `setTelegramBotToken` — still no PROD.
