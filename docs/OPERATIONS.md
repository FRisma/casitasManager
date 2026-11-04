# Operaciones — CasitasManager

## Funciones útiles (editor Apps Script)

| Función | Descripción |
|---------|-------------|
| `getSystemStatus()` | Entorno, dry-run, providers, approval |
| `setupDevEnvironment()` | Crea Drive/Sheets DEV (idempotente) |
| `setupProdEnvironment()` | Crea recursos PROD con DRY_RUN=true |
| `runDailyCheck()` | Chequeo completo + recordatorios |
| `runAllProviders()` / `runProvider('ecogas')` | Providers |
| `probeEcogas()` / `probeOsse()` / `probeNaturgy()` / `probeMunicipalidad()` | Diagnóstico HTTP |
| `generateMonthlyReport('2026-11')` | Genera sin enviar |
| `previewMonthlyReport('2026-11')` | Preview email/Telegram |
| `approveMonthlyReport('2026-11')` | Aprobación owner |
| `sendMonthlyReport('2026-11')` | Envía solo si aprobado |
| `registerPayment({invoice_id, amount, payment_date})` | Marca pagado + audit |
| `setDryRunMode(true\|false)` | Toggle dry-run |
| `setTelegramBotToken(token)` | Guarda token |
| `setupTriggers()` / `removeTriggers()` | Scheduler |
| `telegramOwnerCommand('approve_report','2026-11')` | Ops Telegram |

## Informe mensual (flujo seguro)

1. `runDailyCheck()` o carga manual de PDFs en Drive + filas Invoices.
2. `previewMonthlyReport('YYYY-MM')` — revisar montos/links.
3. Owner: `approveMonthlyReport('YYYY-MM')` (o comando Telegram).
4. `sendMonthlyReport('YYYY-MM')`.
5. En DEV: destinos = **solo owners**. Nunca tenants reales.

## Registrar un pago

```javascript
registerPayment({
  invoice_id: 'inv|…',
  payment_date: '2026-11-02',
  amount: 15000.5,
  payment_method: 'transferencia',
  confirmation_source: 'manual',
  notes: '',
});
```

Adjuntar comprobante: subir a `Payment-Receipts/` y pasar `receipt_file_id` / `receipt_file_url`.

## Agregar contacto (multi-tenant / multi-owner)

Hoja **Contacts**: `contact_id`, `property_id`, `role` (`owner`|`tenant`), `name`, `email`, `telegram`, `active`.

## Activar Municipalidad

Cuando exista el número catastral:

1. Hoja **Services** → fila `municipalidad`.
2. Completar `cadastral_number`.
3. `enabled` = `TRUE`.
4. Sin redeploy de código obligatorio (el adapter lee Sheets).

## Checklist producción (Phase 8) — NO ejecutar sin Franco

- [ ] Script ID PROD en `.clasp.prod.json`
- [ ] `npm run push:prod`
- [ ] `setupProdEnvironment()` ejecutado
- [ ] Contacts PROD con emails/telegram correctos
- [ ] Revisar `docs/PROVIDERS.md` limitaciones
- [ ] Dry-run E2E en DEV OK
- [ ] **Aprobación explícita Franco** para:
  - [ ] `setDryRunMode(false)` en PROD
  - [ ] `setupTriggers()` en PROD
  - [ ] Primer `sendMonthlyReport` a inquilinos reales

## Recuperar ejecución fallida

1. Hoja **ExecutionLog** → filtrar `status=error`.
2. `probeProvider('…')` del servicio afectado.
3. `runProvider('…')` manual.
4. Si lock trabado: esperar ~30s o nueva ejecución.
