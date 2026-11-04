# Implementation log — CasitasManager

## 2026-11-04 — Phase 1 (Environment)

- Repo GitHub `FRisma/casitasManager` vinculado; branch de trabajo agent.
- Node 22 + npm; `@google/clasp@2.5.0` como devDependency.
- `.gitignore`, `.claspignore`, `.clasp.dev.json`, `.clasp.prod.json` (placeholders Script ID).
- `scripts/safe-clasp.js` garantiza separación DEV/PROD.
- `docs/ENVIRONMENT.md` escrito.
- **Bloqueo:** sin `clasp login` / Script IDs (Franco).

## 2026-11-04 — Phase 2 (Google resources — código)

- `setupEnvironment` / `setupDevEnvironment` / `setupProdEnvironment` idempotentes.
- Árbol Drive `CasitasManager-{ENV}/Properties/Natania-XV/...`.
- Spreadsheet + schema (incl. **Contacts** multi-owner/tenant).
- Seeds Services (Municipalidad `enabled=false`).
- **No ejecutado en vivo:** falta auth Google.

## 2026-11-04 — Phase 3 (Core)

- Módulos `sheets`, `drive`, `invoices` (dedupe), `payments`, `logging`, utils.
- Identidad factura + normalización montos AR.

## 2026-11-04 — Phase 4 (Providers)

- Sonda HTTP documentada en `PROVIDERS.md`.
- Adapters Ecogas / OSSE / Naturgy / Municipalidad con outcomes honestos.
- Limitaciones: reCAPTCHA, SPA, DNS OSSE, catastro faltante.

## 2026-11-04 — Phase 5 (Notifications)

- Email + Telegram; DEV redirige a owners; dry-run por defecto.
- `generateMonthlyReport` / `previewMonthlyReport` / `sendMonthlyReport` + gate `approveMonthlyReport`.
- Ops owner Telegram: `approve_report`, `status`, `run_check` (sin query-bot inquilinos).

## 2026-11-04 — Follow-up: differentiated owner/tenant copy

- Tenant email/Telegram: texto informativo ES original (“únicamente informativo”).
- Owner email/Telegram: copy ops (`payment_status`, vencimientos, totales, Sheet/PDF, nota de notify a inquilinos).
- `sendTestNotifyAllConfiguredContacts` envía cuerpo por rol (no el mismo body).
- `sendMonthlyReport` en DEV sigue **solo owners** (con copy ops).

## 2026-11-04 — Phase 6 (Scheduler)

- `setupTriggers` / `removeTriggers` / `runDailyCheck` / `runAllProviders` / `runProvider`.
- Días 1/10/20/28 08:00 `America/Argentina/Buenos_Aires` + LockService.
- **PROD triggers no activados.**

## 2026-11-04 — Phase 7 (Tests)

- `npm test` → 23 assertions OK (Node).
- Integration local: build + unit + portal probes.
- E2E Drive/Sheets/Gmail/Telegram real: **bloqueado sin auth Franco**.

## 2026-11-04 — Phase 8 (Prod readiness)

- Checklist en `OPERATIONS.md`.
- Sin activación PROD.

## 2026-11-04 — Follow-up: claspignore + manual import + probes

- **Bugfix:** `.claspignore` usaba `!src/**` pero `rootDir=src` hace paths relativos a `src/` → solo pusheaba `appsscript.json`. Reescrito al patrón default de clasp (`!**/*.js`, etc.).
- Preflight `npm run push:preflight` / integrado en `push:dev` — aborta si < 10 archivos.
- `importManualInvoice` / `importManualInvoiceFromDrive` + docs en OPERATIONS.
- Naturgy: documentados `/api/v1/bills/public_pdf` (requieren token); OSSE multi-URL DNS; Ecogas form `logon?s=p`.
- Unit tests: 35 assertions (dry-run redirect DEV→owner, telegram dry-run, manual metadata).

## 2026-11-04 — Provider fetch feasibility (CAS-17)

- Informe: `docs/provider-fetch-feasibility.md` (+ store mirror).
- **OSSE:** host correcto `facturaweb.osse.com.ar`; API pública `UnidadByUnidadAlt` → `UltimasFacturas` → `ImprimirFactura` (PDF OK en sonda). Full auto factible. Seed/`osse.js` actualizan portal; fetch aún `not_implemented`.
- Ecogas: sigue bloqueado por reCAPTCHA. Naturgy: SPA+token/Turnstile. Municipalidad: sin catastro.
- Sin bypass CAPTCHA · sin activar PROD.
