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

## 2026-11-04 — OSSE auto invoice fetch (CAS-19)

- `src/providers/osse.js`: implementación real `checkAvailability` / `fetchInvoices` / `downloadInvoice` (UrlFetchApp, outcomes honestos).
- `CM.Invoices.persistProviderFetch`: PDF → `Drive.saveInvoicePdf` + upsert dedupe.
- `menuDescargarOsse` / `downloadProviderInvoice_` / `runProvider('osse')` usan descarga real (máx 1 menú / 3 scheduler período).
- Seed portal ya `facturaweb.osse.com.ar`; `seedIfEmpty` repara filas viejas `.osse.ar`.
- Unit tests Node para normalización cuenta, map factura, URLs, parse JSON (sin UrlFetch).
- Sin CAPTCHA bypass · sin `setupTriggers` PROD · Mac `clasp push` aparte.

## 2026-11-04 — Municipalidad Rivadavia auto boleta (CAS-23)

- Nomenclatura confirmada Franco: `322047490000`.
- `src/providers/municipalidad.js`: flujo ASP.NET GET → `rbTipoInm` → BUSCAR → `btnBoleta`+`Procesar` → PDF.
- Seed `enabled=true` + catastro; `seedIfEmpty` repara filas vacías; `persistProviderFetch` acepta `autoDownload`/`checkboxName`; scheduler `maxDownloads=1`.
- Limitaciones documentadas: HTTP (no HTTPS), VIEWSTATE frágil, postback Inmueble obligatorio.
- Unit tests con fixtures HTML de grilla; sonda local PDF ~65KB `%PDF-1.4`.
- Sin CAPTCHA bypass · sin activar PROD triggers.

## 2026-11-04 — Ecogas / shared manual Drive import UX (CAS-26)

- Menú: **Importar PDF Ecogas desde Drive** + **Importar PDF desde Drive…** (prompts fileId/URL, período actual, monto opcional).
- `CM.Drive.parseDriveFileId` (URL→id) · Inbox-Manual (`ensureManualInboxFolder` / `listRecentManualInboxPdfs`).
- `CM.Invoices.prepareManualDriveImport` + `importManualInvoiceFromDrive` acepta URL; valida `looksLikePdf`.
- Docs OPERATIONS / PROVIDERS / SETUP; unit tests parse/prepare. Sin CAPTCHA bypass · sin clasp-push PROD.

## 2026-11-04 — Ecogas session curls follow-up (CAS-26)

- Endpoints post-login documentados: `index?s=p`, `panel_detalle_fact.php?d&c&t` (cuenta `20259678`). **Sin URL PDF** en el capture.
- Sonda: SID incompleto → 302 login; detalle sin sesión → body vacío. Cookies **no** en repo.
- Parser puro `extractDetailDownloadCandidates` + fixture; `setEcogasSessionCookie` / `probeEcogasSession` / `probeEcogasInvoiceDetail` (Script Properties). Manual Drive sigue primario.

## 2026-11-04 — Ecogas Imprimir form (CAS-26)

- DOM: `POST …/res/tra/reimp/impresion_jano.php` (`enviar` → `#fdocdeu`+`#impresion`); fields `p,d,c,t=cuy,i=FA,logreimp,m,pp,form_pp`.
- Helpers: `padAccountNumber`, `parseCompoundInvoiceId`, `buildPrintFormPayload`, `probePrintPdf` / `probeEcogasPrintPdf`.
- Outcome `pdf_magic_seen` ≠ auto menú; **esperar confirmación fetch de Franco**. Drive UX primario. Sin cookies en repo.
