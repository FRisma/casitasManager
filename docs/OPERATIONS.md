# Operaciones — CasitasManager

## DEV vs PROD (recordatorio)

- **DEV** = sandbox seguro: dry-run por defecto, `sendMonthlyReport` solo a **owners**, probes y menú de prueba.
- **PROD** = routing real (owners + tenants) cuando Contacts son reales; no activar triggers ni `setDryRunMode(false)` sin OK de Franco.

## Menú CasitasManager (interfaz simple)

Al abrir el Sheet bound (o tras `installCasitasManagerMenu` / `installOnOpenMenuTrigger`):

| Ítem | Función | Qué hace |
|------|---------|----------|
| Descargar Ecogas por comprobante… | `menuDescargarEcogasPorComprobante` | Prompt nº de comprobante → PDF Imprimir (sin cookie) → Drive |
| Descargar factura OSSE | `menuDescargarOsse` | **Auto:** API facturaweb.osse.com.ar → PDF Drive + Invoices |
| Descargar factura Naturgy | `menuDescargarNaturgy` | Listado `complete_debts` + PDF auto si hay `setNaturgyCredentials` |
| Descargar factura Municipalidad | `menuDescargarMunicipalidad` | **Auto:** ASP.NET boleta PDF → Drive + Invoices |
| Importar PDF Ecogas desde Drive | `menuImportarPdfEcogas` | Fallback sin comprobante: fileId/URL o Inbox-Manual |
| Importar PDF Naturgy desde Drive | `menuImportarPdfNaturgy` | fileId/URL o Inbox-Manual → Invoices |
| Importar PDF desde Drive… | `menuImportarPdfDesdeDrive` | Igual, elige provider |
| Probar envío solo a propietario | `menuProbarEnvioOwner` | Soft confirm → REAL solo owners (copy ops) |
| Probar envío solo a inquilino | `menuProbarEnvioTenant` | Soft confirm / YES → REAL solo tenants (copy informativa) |

**OSSE**, **Municipalidad**, **Naturgy** (con credenciales) y **Ecogas** (con nº de comprobante) entregan PDF automático. Sin comprobante Ecogas → Drive import (reCAPTCHA bloquea listing).
Desde el editor (sin menú): las mismas `menu*` zero-arg, o `sendTestNotifyOwnersOnly()` / `sendTestNotifyTenantsOnly(period, 'YES_SEND_TO_TENANTS')`.

## Funciones útiles (editor Apps Script)

| Función | Descripción |
|---------|-------------|
| `getSystemStatus()` | Entorno, dry-run, providers, approval |
| `setupDevEnvironment()` | Crea Drive/Sheets DEV (idempotente) |
| `setupProdEnvironment()` | Crea recursos PROD con DRY_RUN=true |
| `installCasitasManagerMenu()` / `installOnOpenMenuTrigger()` | Menú operador |
| `menuDescargarEcogasPorComprobante` / `Osse` / `Naturgy` / `Municipalidad` | Descarga/probe por proveedor |
| `menuImportarPdfEcogas` | Fallback Drive Ecogas |
| `menuProbarEnvioOwner` / `menuProbarEnvioTenant` | Tests de envío por rol |
| `runDailyCheck()` | Chequeo completo + recordatorios |
| `runAllProviders()` / `runProvider('ecogas')` | Providers |
| `probeEcogas()` / `probeOsse()` / `probeNaturgy()` / `probeMunicipalidad()` | Diagnóstico HTTP |
| `setEcogasPrintPp(comprobante)` / `downloadEcogasSessionInvoice()` | Ecogas PDF por comprobante (sin cookie) |
| `setNaturgyCredentials(email, password)` / `clearNaturgyCredentials()` | Login portal (Script Properties; **nunca commit/log password**) |
| `setNaturgySessionToken(token)` / `clearNaturgySessionToken()` | Cache JWT opcional |
| `getNaturgyAuthStatus()` | ¿hay email/password/JWT? (sin revelar valores) |
| `downloadNaturgySessionInvoice()` | Listado + login + printed_bill → Drive |
| `ensureManualInboxFolder()` / `listManualInboxPdfs()` | Inbox-Manual Drive |
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

## Naturgy (listado sin auth + PDF con login)

**Una vez por entorno (DEV y/o PROD)** — editor Apps Script, sin commitear:

```javascript
setNaturgyCredentials('tu@email', 'tu-password'); // solo Script Properties
getNaturgyAuthStatus(); // { emailSet, passwordSet, canAutoPdf } — no muestra secretos
menuDescargarNaturgy(); // o downloadNaturgySessionInvoice()
```

Flujo: `complete_debts` (sin auth) → `POST /users/sessions` → `printed_bill` + job base64 → Drive.  
Si expusiste la password en chat, **rotála** en el portal y volvé a `setNaturgyCredentials`.  
Fallback: `menuImportarPdfNaturgy()` / Inbox-Manual. `clearNaturgyCredentials()` borra props.
## Ecogas (PDF por comprobante)

El login tiene reCAPTCHA (no bypassear). Si conocés el **número de comprobante** (UI Ecogas; form field interno `pp`):

```javascript
setEcogasPrintPp('0401B60797913A');
downloadEcogasSessionInvoice(); // o menú Descargar Ecogas por comprobante…
```

Cookie **no** requerida para `POST impresion_jano.php`. Descubrir el comprobante sigue necesitando login humano.  
Sin comprobante: menú **Importar PDF Ecogas desde Drive**.

Tras el PDF, CasitasManager intenta leer **amount / issue_date / due_date** del texto embebido del PDF (`IMPORTE` / `Total a pagar hasta el …` / `Fecha de emisión`). No inventa montos. Si el parse falla, el menú pide el monto.

### Backfill fila Invoices con monto vacío (mismo comprobante)

Si ya hay fila `provider=ecogas`, `status=downloaded`, PDF en Drive, pero amount/fechas vacíos:

1. `push:prod` con este fix (Franco OK).
2. Re-ejecutar menú **Descargar Ecogas por comprobante…** con el **mismo** nº (ej. `0401B60797913A`) **o** en el editor:
   ```javascript
   setEcogasPrintPp('0401B60797913A');
   downloadEcogasSessionInvoice();
   ```
3. El upsert usa el mismo `invoice_id` (`provider|account|invoiceNumber|billingPeriod`) → actualiza la fila (no duplica). Monto esperado de muestra ~`336.56`.

Sin re-descargar (solo metadata):

```javascript
importManualInvoice({
  provider: 'ecogas',
  billingPeriod: '2026-11', // el mismo período de la fila PROD
  invoiceNumber: '0401B60797913A',
  amount: 336.56,
  issueDate: '14/10/2026',
  dueDate: '26/10/2026',
  invoice_status: 'downloaded',
});
```

## Carga manual de facturas (fallback)

Si el auto OSSE/Municipalidad/Ecogas-comprobante falla, o Naturgy sin credenciales. Flujo owner:

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

## Municipalidad (auto boleta)

Nomenclatura seed: `322047490000`. Tras `clasp push` + `setupDevEnvironment` / `seedIfEmpty`:

1. `probeMunicipalidad()` → formulario ASP.NET OK.
2. `menuDescargarMunicipalidad()` o `runProvider('municipalidad')` → PDF en Drive Invoices/{year}/{month} + fila Invoices.
3. Si la hoja Services quedó con catastro vacío de un seed viejo, re-correr `seedIfEmpty` (repara a `322047490000` + `enabled=TRUE`).

**Notas:** portal es **HTTP** (no HTTPS). El postback `rbTipoInm` es obligatorio antes de BUSCAR. Si el markup/VIEWSTATE cambia → outcome `portal_structure_changed` (sin inventar montos).

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
