# Arquitectura — CasitasManager

## Principios

- Runtime: **Google Apps Script** (V8).
- Datos: **Google Sheets** + archivos en **Google Drive**.
- Notificaciones: **Gmail** + **Telegram Bot API** (si hay token).
- Automatización: triggers time-driven (días 1, 10, 20, 28).
- Zona horaria: `America/Argentina/Buenos_Aires`.
- **Prohibido:** AWS, Docker, Postgres, Redis, servidor permanente, agente AI continuo.

## Propiedad

Manzana 6, Casa 1 — Barrio Natania XV — Rivadavia, San Juan, Argentina.

Servicios: Naturgy (luz), Ecogas (gas), OSSE (agua), Municipalidad Rivadavia (inactivo sin catastro).

Multi-inquilino y multi-propietario: contactos en hoja **Contacts** (`role`: `owner` | `tenant`, email, telegram).

Solo el **propietario** paga. Inquilinos reciben avisos informativos (montos + PDF).

## Estructura del repo

```
src/
  app/           main, scheduler, setup
  config/        settings, catálogo de servicios
  providers/     interface + ecogas, osse, naturgy, municipalidad
  services/      drive, sheets, invoices, payments, email, telegram, notifications
  utils/         dates, hashes, logging, pdf
  tests/         tests ejecutables en el editor GAS
docs/            documentación en español
scripts/         clasp seguro, setup local, build
tests/           unit/integration en Node
```

Namespace JS: objeto global `CM.*`. Entry points globales para el editor/triggers (`setupEnvironment`, `runDailyCheck`, `sendMonthlyReport`, …).

## Separación DEV / PROD

| Recurso | DEV | PROD |
|---------|-----|------|
| Proyecto Apps Script | CasitasManager DEV | CasitasManager PROD |
| `.clasp.*.json` | `.clasp.dev.json` | `.clasp.prod.json` |
| Carpeta Drive | `CasitasManager-DEV` | `CasitasManager-PROD` |
| Spreadsheet | `… (DEV)` | `… (PROD)` |
| Salida mail/Telegram | Solo contactos **owner** | Tenants+owners (tras aprobación) |
| `DRY_RUN` | `true` por defecto | `true` hasta aprobación Franco |

`npm run push:dev` **nunca** usa el Script ID de prod (`scripts/safe-clasp.js`).

## Hojas (schema)

Properties, **Contacts**, Services, Invoices, Payments, Configuration, ExecutionLog.

Ver columnas en `src/services/sheets.js`.

## Flujo mensual

1. Trigger / `runDailyCheck` → `runAllProviders` (independientes, con lock).
2. Adapters reportan outcome honesto (captcha, SPA, DNS, disabled…).
3. Facturas reales se upsert-ean con identidad estable (sin inventar datos).
4. Owner recibe avisos (email + Telegram si hay chat_id).
5. `generateMonthlyReport` / `previewMonthlyReport` — sin envío.
6. Owner aprueba período (`approveMonthlyReport` o `/approve_report YYYY-MM`).
7. `sendMonthlyReport` envía solo si el período está aprobado.

## Seguridad

- Secretos en Script Properties (`TELEGRAM_BOT_TOKEN`, etc.) — nunca en git.
- No inferir `paid` porque el portal no muestre deuda.
- No bypassear CAPTCHA/auth.
- Carpetas Drive no públicas.
