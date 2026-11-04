# Operaciones — CasitasManager

## DEV vs PROD (recordatorio)

- **DEV** = sandbox seguro: dry-run por defecto, `sendMonthlyReport` solo a **owners**, probes y menú de prueba.
- **PROD** = routing real (owners + tenants) cuando Contacts son reales; no activar triggers ni `setDryRunMode(false)` sin OK de Franco.

## Menú CasitasManager (interfaz simple)

Al abrir el Sheet bound (o tras `installCasitasManagerMenu` / `installOnOpenMenuTrigger`):

| Ítem | Función | Qué hace |
|------|---------|----------|
| Descargar factura Ecogas | `menuDescargarEcogas` | Probe/fetch; si no hay PDF auto → Logger + camino `importManual*` |
| Descargar factura OSSE | `menuDescargarOsse` | **Auto:** API facturaweb.osse.com.ar → PDF Drive + Invoices |
| Descargar factura Naturgy | `menuDescargarNaturgy` | idem |
| Descargar factura Municipalidad | `menuDescargarMunicipalidad` | idem |
| Probar envío solo a propietario | `menuProbarEnvioOwner` | Soft confirm → REAL solo owners (copy ops) |
| Probar envío solo a inquilino | `menuProbarEnvioTenant` | Soft confirm / YES → REAL solo tenants (copy informativa) |

**OSSE** entrega PDF automático vía API pública (sin CAPTCHA en esos GET). Ecogas/Naturgy/Municipalidad siguen sin PDF auto (captcha/SPA/catastro); el menú es honesto y apunta a `importManual*`.

Desde el editor (sin menú): las mismas `menu*` zero-arg, o `sendTestNotifyOwnersOnly()` / `sendTestNotifyTenantsOnly(period, 'YES_SEND_TO_TENANTS')`.

## Funciones útiles (editor Apps Script)

| Función | Descripción |
|---------|-------------|
| `getSystemStatus()` | Entorno, dry-run, providers, approval |
| `setupDevEnvironment()` | Crea Drive/Sheets DEV (idempotente) |
| `setupProdEnvironment()` | Crea recursos PROD con DRY_RUN=true |
| `installCasitasManagerMenu()` / `installOnOpenMenuTrigger()` | Menú operador |
| `menuDescargarEcogas` / `Osse` / `Naturgy` / `Municipalidad` | Descarga/probe por proveedor |
| `menuProbarEnvioOwner` / `menuProbarEnvioTenant` | Tests de envío por rol |
| `runDailyCheck()` | Chequeo completo + recordatorios |
| `runAllProviders()` / `runProvider('ecogas')` | Providers |
| `probeEcogas()` / `probeOsse()` / `probeNaturgy()` / `probeMunicipalidad()` | Diagnóstico HTTP |
| `generateMonthlyReport('2026-11')` | Genera sin enviar |
| `previewMonthlyReport('2026-11')` | Preview email/Telegram |
| `approveMonthlyReport('2026-11')` | Aprobación owner |
| `sendMonthlyReport('2026-11')` | Envía solo si aprobado (DEV→solo owners) |
| `sendTestNotifyOwnersOnly(period?)` | Test REAL solo owners (ops) |
| `sendTestNotifyTenantsOnly(period?, 'YES_SEND_TO_TENANTS')` | Test REAL solo tenants (gate) |
| `sendTestNotifyAllConfiguredContacts(period?, 'YES_SEND_TO_TENANTS')` | Test REAL owners+tenants (gate) |
| `setAllowTestTenantSend(true)` / `clearAllowTestTenantSend()` | Flag Script Property del test tenant |
| `registerPayment({invoice_id, amount, payment_date})` | Marca pagado + audit |
| `getManualInvoiceTemplate()` | Campos para carga manual |
| `importManualInvoice({…})` | Alta metadata_only (sin PDF) |
| `importManualInvoiceFromDrive(fileId, {…})` | Alta con PDF desde Drive |
| `setDryRunMode(true\|false)` | Toggle dry-run |
| `setTelegramBotToken(token)` | Guarda token |
| `setupTriggers()` / `removeTriggers()` | Scheduler |
| `telegramOwnerCommand('approve_report','2026-11')` | Ops Telegram |

## Carga automática OSSE

```javascript
menuDescargarOsse();          // o downloadProviderInvoice('osse')
runProvider('osse');          // scheduler / manual — lista + PDF período actual
probeOsse();                  // diagnóstico API
```

Requiere `account_number` en Services (formato hoja OK: `119 0080934 000 1`). No activa triggers PROD.

## Carga manual de facturas (Ecogas / Naturgy / Municipalidad; OSSE fallback)

Si el auto OSSE falla, o para providers con reCAPTCHA / SPA / sin catastro. Flujo owner:

### A) Solo montos / metadata (sin PDF todavía)

```javascript
importManualInvoice({
  provider: 'ecogas',          // o naturgy | osse
  billingPeriod: '2026-11',
  invoiceNumber: '…',          // si existe en la boleta
  amount: 12345.67,            // número real de la boleta; vacío si aún no se sabe
  dueDate: '15/11/2026',
  payment_status: 'pending',   // unknown | pending | paid
  notes: 'cargado a mano',
});
```

`invoice_status` queda en `metadata_only`. No inventar importes.

### B) Con PDF descargado del portal en el browser

1. Descargar la factura PDF desde el portal (sesión humana).
2. Subir el PDF a Google Drive (cualquier carpeta tuya).
3. Copiar el **fileId** del archivo (URL `…/d/FILE_ID/…` o detalle del archivo).
4. Ejecutar:

```javascript
importManualInvoiceFromDrive('FILE_ID', {
  provider: 'naturgy',
  billingPeriod: '2026-11',
  invoiceNumber: '…',
  amount: 12345.67,
  dueDate: '20/11/2026',
  payment_status: 'pending',
});
```

El helper valida magic PDF, lo guarda bajo `Invoices/YYYY/MM-Month/` y hace upsert dedupe.

Plantilla de campos: `getManualInvoiceTemplate()`.

## Informe mensual (flujo seguro)

1. `runDailyCheck()` y/o carga manual (`importManualInvoice` / `FromDrive`).
2. `previewMonthlyReport('YYYY-MM')` — revisar montos/links.
3. Owner: `approveMonthlyReport('YYYY-MM')` (o comando Telegram).
4. `sendMonthlyReport('YYYY-MM')`.
5. En DEV: destinos = **solo owners**. Nunca tenants reales.

## Tests de envío (owner / tenant / dual)

`sendMonthlyReport` en DEV **sigue** yendo solo a owners (copy **ops**). Para pruebas reales a Contacts de test:

```javascript
// Solo propietario (copy ops) — menú o:
sendTestNotifyOwnersOnly(); // o '2026-11'

// Solo inquilino (copy informativa) — requiere gate
setAllowTestTenantSend(true);
sendTestNotifyTenantsOnly();
clearAllowTestTenantSend();
// o: sendTestNotifyTenantsOnly('2026-11', 'YES_SEND_TO_TENANTS');

// Dual (ambos roles)
sendTestNotifyAllConfiguredContacts('2026-11', 'YES_SEND_TO_TENANTS');
```

Cada rol recibe un cuerpo distinto:

| Rol | Email / Telegram |
|-----|------------------|
| **tenant** | Texto informativo ES (“únicamente informativo”; abonado por el propietario) |
| **owner** | Copy ops: `payment_status`, vencimientos, totales, link Sheet/PDF, nota de aviso a inquilinos |

Requisitos: Contacts con email/telegram; `TELEGRAM_BOT_TOKEN` si querés Telegram. Revisá el Execution log (lista de destinatarios + subjects). Después de cualquier test tenant, **siempre** `clearAllowTestTenantSend()`.

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
