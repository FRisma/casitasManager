# AGENTS.md — CasitasManager

Guidance for coding agents working in this repo.

## What this is

**CasitasManager** manages utility invoices for property **Natania XV** (Manzana 6, Casa 1, Rivadavia, San Juan) on **Google Apps Script** (clasp) + Sheets + Drive + Gmail + Telegram.

- Owner pays bills; tenants get **informational** notices; owners get **ops** copy.
- Providers: Ecogas (gas), OSSE (water), Naturgy San Juan (electricity), DECSA Caucete (luz+agua), Municipalidad Rivadavia (tax).
- **Never invent** amounts, cadastral IDs, or payment status. **Never bypass** reCAPTCHA/Turnstile. **Never commit** secrets (tokens, passwords, JWTs).

## Goals

1. Reliable monthly invoice fetch → Drive PDF + Invoices sheet (dedupe).
2. Safe DEV sandbox (dry-run, owner-only sends) before PROD.
3. Honest outcomes when portals block automation (`auth_or_captcha_required`, etc.).

## How to run

```bash
npm install
npm test                 # unit (Node) — required green before merge
npm run test:integration # light live probes where allowed
npm run push:dev         # clasp → DEV Script ID only
npm run push:prod        # only with PROD ID + Franco OK
```

Apps Script editor (after `push:dev`):

1. `setupDevEnvironment()`
2. Contacts sheet + optional `setTelegramBotToken`
3. `installCasitasManagerMenu()` / reopen Sheet
4. Menú **CasitasManager** → descargar por proveedor / marcar pagada / **Agregar propiedad…** / tests de envío

**DEV** = sandbox. **PROD** = real routing — no triggers / dry-run off without Franco.

Propiedades nuevas: menú **Agregar propiedad…** o `addProperty({…})` (no editar seed). Contacts son por `property_id` (multi-owner / multi-tenant por casa). Municipalidad auto = Rivadavia only; Caucete → `unsupported_municipio` hasta portal discovery (import manual OK).

### Owner Telegram ops bot

- Module: `src/services/telegram-bot.js` + helpers en `telegram.js`.
- **Entrada default:** polling 1 min — `startTelegramOwnerBot()` → trigger → `pollTelegramUpdates` (`getUpdates` + offset). `doPost` webhook opcional / no usado.
- Auth: Contacts `role=owner` + `active` + matching `telegram` chat_id. Unknown → «No tenés acceso».
- **Multi-casa:** Inicio → Mis casas (saltear si hay una) → hub de esa casa. Descargas / Ecogas / mes / marcar pagada scoped a la casa (`resolveService(propertyId, provider)`). Inicio: Pagos pendientes (todas) + Agregar propiedad (global).
- Copy: español amigable («casa», no `property_id`). Sesión (casa + flujo) + offset en Script Properties.
- Setup: tras `push:dev`, correr `startTelegramOwnerBot()` una vez. Ver [docs/OPERATIONS.md](docs/OPERATIONS.md). No trigger PROD sin Franco.

## Docs (in-repo)

| Path | Use |
|------|-----|
| [README.md](README.md) | Overview + common commands |
| [docs/SETUP.md](docs/SETUP.md) | clasp / env setup |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Day-to-day menu + Naturgy credentials |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Portal limitations & API notes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module layout |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Toolchain / auth state |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common failures |
| [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) | Phase log |

Project Agent Store (coordinator context, not always in git): ops asks / curl notes under the CasitasManager store `docs/` and `internal/`.

## Layout

```
src/app/          main, menu, setup, scheduler
src/providers/    ecogas, osse, naturgy, decsa, municipalidad + interface
src/services/     sheets, drive, invoices, notifications, …
src/config/       settings (Script Properties keys), services seed
tests/            run-unit.js + fixtures/
scripts/          clasp safe push, build, preflight
```

## Per-provider integration notes

### OSSE (agua) — auto

- Host: `facturaweb.osse.com.ar` API `UnidadByUnidadAlt` → `UltimasFacturas` → `ImprimirFactura` PDF.
- Account digits from Services (14 digits). Menu: `menuDescargarOsse` / `runProvider('osse')`.
- Tests: `tests/run-unit.js` OSSE section + mocked HTTP.

### Municipalidad Rivadavia — auto ASP.NET

- HTTP portal `deudavencida/deuda_total.aspx`. Catastro seed `322047490000`.
- Flow: GET → `rbTipoInm` → BUSCAR → `btnBoleta`+checkbox → PDF.
- Menu: `menuDescargarMunicipalidad`. Fixtures: `tests/fixtures/municipalidad/`.
- Other municipios (Caucete, etc.): Service row OK; auto-download returns `unsupported_municipio` until a real portal adapter exists.

### Ecogas (gas) — comprobante print + Drive fallback

- Login has **Google reCAPTCHA** → UrlFetch cannot auto-login (no bypass).
- **Auto PDF:** menú **Descargar Ecogas por comprobante…** → prompt nº de comprobante (ej. `0401B60797913A`) → maps to form field `pp` → cookie-free `POST impresion_jano.php` → Drive + Invoices. Editor: `setEcogasPrintPp` / `downloadEcogasSessionInvoice`.
- **Fallback:** **Importar PDF Ecogas desde Drive** (browser download → Inbox-Manual / fileId).
- Listing/discovery of comprobante still needs human login. Never invent amounts. Fixtures: `tests/fixtures/ecogas/`.

### Naturgy San Juan (luz) — listing + login PDF

- API: `https://utilitygo.widergy.com/` (`Utility-ID: 23`, `Channel: web`). SPA origin is **not** the API.
- **Listing (no auth):** `GET /api/v1/accounts/complete_debts?client_number=&gateway=mercadopago` → 202 job → `debts[]`.
- **PDF (auth):** Script Properties `NATURGY_EMAIL` + `NATURGY_PASSWORD` → `POST /api/v1/users/sessions` → JWT → `GET /api/v1/bills/printed_bill?client_number=&external_id=<document_number>` (not `17-…` compound) + `Authorization: <JWT>` (no Bearer) → 202 job → `{base64}` → PDF → Drive.
- Ops: `setNaturgyCredentials(email, password)` then `menuDescargarNaturgy`. Never commit/log password. Rotate if exposed.
- Fixtures: `tests/fixtures/naturgy/`. Fallback: `menuImportarPdfNaturgy`.

### DECSA Caucete (luz+agua) — session hub

- Portal: `https://www.cooponlineweb.com.ar/DECSA/` (no public unauth debt/PDF API).
- **Auth:** Script Properties `DECSA_EMAIL` + `DECSA_PASSWORD` → GET/POST Login (antiforgery) → cookie jar → GET Facturas.
- **PDF:** `handler=Descarga` returns **JSON URL** → follow `api.cooponlineweb.com.ar` → S3 PDF (not raw PDF from Descarga).
- Sheets: `account_number`←newKey/`codSum`, `secondary_identifier`←newAccount/titular.
- Ops: `setDecsaCredentials` → `menuDescargarDecsa` / `runProvider('decsa')`. Fixtures: `tests/fixtures/decsa/`.
- Never commit/log password. No CAPTCHA bypass. Hub AddAccount multi-casa can be phase-2.

## Agent rules of thumb

- Prefer extending existing adapters/menus over new frameworks.
- Outcomes: use `CM.ProviderInterface.OUTCOME_*` honestly; empty list ≠ “no bill this month” if the portal failed.
- Secrets only in Script Properties; tests use fixture placeholders only.
- Do not `clasp push` PROD or enable PROD triggers unless Franco explicitly asks.
- Branch naming for cloud agents: `cursor/<name>-bc92` (or the run’s suffix). PRs via the repo’s PR workflow; squash-merge when asked.
