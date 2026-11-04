# Troubleshooting — CasitasManager

## clasp

| Problema | Qué hacer |
|----------|-----------|
| `scriptId pendiente` | Completar `.clasp.dev.json` / `.clasp.prod.json` |
| `push:dev` usa prod | No debería — `safe-clasp.js` aborta si IDs coinciden |
| Auth error | `npm run clasp:login` de nuevo |
| API disabled | Activar Apps Script API en settings de usuario |

## Setup Drive/Sheets

| Problema | Qué hacer |
|----------|-----------|
| `SPREADSHEET_ID no configurado` | Ejecutar `setupEnvironment()` |
| Permisos OAuth | Re-autorizar al correr la función en el editor |
| Carpetas duplicadas | Setup es idempotente por nombre; no borrar a mano sin backup |

## Notificaciones

| Problema | Qué hacer |
|----------|-----------|
| `approval_required` | `approveMonthlyReport('YYYY-MM')` |
| Sin destinatarios | Completar email/telegram en Contacts (owners para DEV) |
| Telegram `not_configured` | `setTelegramBotToken` |
| Mail no llega en dry-run | Esperado — mirar ExecutionLog / Logger preview |

## Providers

| Problema | Qué hacer |
|----------|-----------|
| Ecogas `auth_or_captcha_required` | Esperado — carga manual PDF o captura asistida |
| Naturgy SPA | Mapear API desde DevTools del browser del owner |
| OSSE DNS | Probar `probeOsse()` desde GAS (red Google); verificar dominio |
| Municipalidad disabled | Falta catastro — no es error de código |

## Scheduler

| Problema | Qué hacer |
|----------|-----------|
| Triggers duplicados | `removeTriggers()` luego `setupTriggers()` |
| `lock` skip | Otra ejecución en curso — reintentar |
| Cuota GAS | Espaciar `runProvider`; revisar quotas Google |

## Datos

- Nunca marcar `paid` solo porque el portal no muestra deuda.
- Si hay duplicados de factura: revisar `invoice_id` (identidad provider+cuenta+número+período).
- **`previewMonthlyReport` con `items:0` pero ves filas en Invoices:** Sheets a veces guarda `billing_period` como **Date**. El código normaliza Date→`yyyy-MM` al leer. Workaround inmediato: columna `billing_period` → Formato → **Texto sin formato**, reescribir `2026-11`. Luego `push:dev` con el fix y volver a correr preview.
