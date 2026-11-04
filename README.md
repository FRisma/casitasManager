# CasitasManager

Gestión de servicios de la propiedad **Natania XV (Manzana 6, Casa 1, Rivadavia, San Juan)** con **Google Apps Script + clasp + Sheets + Drive + Gmail + Telegram**.

Solo el propietario paga las facturas. Inquilinos (uno o varios) y propietarios reciben avisos **informativos** (montos + PDF) por email y Telegram si está configurado.

## Comandos frecuentes

```bash
npm install
npm test
npm run setup
npm run clasp:login          # Franco — OAuth Google
npm run clasp:status
npm run push:dev             # nunca toca PROD
npm run pull:dev
npm run push:prod            # solo con Script ID PROD configurado
```

En el editor Apps Script (DEV), tras el push:

1. `setupDevEnvironment()`
2. Completar hoja **Contacts**
3. (Opcional) `setTelegramBotToken('…')`
4. `setupTriggers()` — solo DEV hasta aprobación
5. `previewMonthlyReport('YYYY-MM')` → `approveMonthlyReport('YYYY-MM')` → `sendMonthlyReport('YYYY-MM')`

## Documentación (español)

| Doc | Contenido |
|-----|-----------|
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Toolchain y estado de auth |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diseño y schema |
| [docs/SETUP.md](docs/SETUP.md) | Instalación paso a paso |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Día a día + checklist PROD |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Limitaciones de portales |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Fallas comunes |
| [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) | Log por fase |

## Estado actual

- Código y tests unitarios locales: **listos**
- `clasp login`, Script IDs, Drive/Sheets reales, Telegram token, activación PROD: **pendiente de Franco**

Stack prohibido (no usado): AWS, Docker, Postgres, servidores permanentes.
