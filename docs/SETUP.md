# Setup — CasitasManager

## DEV vs PROD (qué es cada uno)

| | **DEV** | **PROD** |
|---|---------|----------|
| Para qué | Sandbox seguro para probar | Routing real cuando Contacts son reales |
| Script | CasitasManager DEV | CasitasManager PROD |
| Dry-run | `DRY_RUN=true` por defecto | Empieza en dry-run; live solo con OK de Franco |
| `sendMonthlyReport` | Solo **owners** (copy ops) | Owners (ops) + **tenants** (informativo) tras aprobación |
| Triggers | OK en DEV para practicar | **No** `setupTriggers` sin aprobación |
| Menú operador | Descargar por proveedor + probar envío owner/tenant | Mismo código; usá Contacts reales con cuidado |

**DEV no es “un entorno menor de PROD”**: es el lugar donde podés romper cosas, hacer dry-run y mandar tests a tus mails/Telegram de prueba. PROD es cuando los Contacts (sobre todo tenants) son personas reales.

## 1. Clonar e instalar

```bash
git clone https://github.com/FRisma/casitasManager.git
cd casitasManager
npm install
npm run setup          # verifica Node/clasp/auth
npm test               # unit tests locales
```

## 2. Autenticación Google (Franco)

```bash
npm run clasp:login
```

Autorizá el acceso en el navegador. Debe crearse `~/.clasprc.json` (no se versiona).

Habilitá si hace falta:

- [Google Apps Script API](https://script.google.com/home/usersettings) → “Google Apps Script API” ON.

## 3. Crear proyectos Apps Script

1. https://script.google.com → Nuevo proyecto → renombrar **CasitasManager DEV**.
2. Copiar **Project Settings → Script ID** → pegar en `.clasp.dev.json` (reemplazar `REPLACE_WITH_DEV_SCRIPT_ID`).
3. Repetir para **CasitasManager PROD** → `.clasp.prod.json`.

Verificar:

```bash
npm run clasp:status
```

## 4. Push código (DEV)

Antes del push (o automáticamente dentro de `push:dev`):

```bash
npm run clasp:files          # lista archivos relativos a rootDir=src
npm run push:preflight       # falla si < 10 archivos
npm run push:dev             # preflight + clasp push
```

Esperado: **~26 archivos** (25 `.js` + `appsscript.json`), no 1.  
Si aparece `Pushed 1 file`, el `.claspignore` está desalineado con `rootDir: src` (los paths son `app/main.js`, no `src/app/main.js`).

Abrí el editor del proyecto DEV → ejecutar función **`setupDevEnvironment`** (autorizar Sheets/Drive/Gmail/UrlFetch).

Resultado esperado (objeto en log):

- `spreadsheetUrl`
- `drive.rootUrl` / `propertyUrl`
- `dryRun: true`

Completar en hoja **Contacts** los emails/telegram de **prueba** (owners y, si querés testear copy tenant, un mail tuyo como tenant). En DEV el envío normal sigue yendo solo a owners; el menú “Probar envío solo a inquilino” es un test explícito gated.

### Menú operador (opcional pero recomendado)

1. Si el script está **bound** al Sheet DEV → reabrí el Sheet: menú **CasitasManager**.
2. Si es **standalone**: `installCasitasManagerMenu()` o `installOnOpenMenuTrigger()` (usa `SPREADSHEET_ID`), o corré `menuDescargarEcogas` / `menuProbarEnvioOwner` / etc. desde el editor.

Ver `docs/OPERATIONS.md` § Menú CasitasManager.

## 5. Telegram (opcional)

1. Crear bot con @BotFather → token.
2. En Apps Script DEV: `setTelegramBotToken('…')`.
3. Obtener `chat_id` del owner (escribirle al bot) → columna `telegram` en Contacts.

## 6. Triggers (solo DEV hasta aprobación)

```
setupTriggers()   // días 1,10,20,28 08:00 Argentina
```

**No** ejecutar `setupTriggers` en PROD sin aprobación explícita de Franco.

## 7. PROD (checklist — no activar aún)

Ver `docs/OPERATIONS.md`. Resumen:

```bash
npm run push:prod          # pide Script ID real
# En editor PROD: setupProdEnvironment()  → deja DRY_RUN=true
# NO setupTriggers / NO setDryRunMode(false) sin OK de Franco
```

## Comandos frecuentes

| Comando | Efecto |
|---------|--------|
| `npm run push:dev` | Sube a DEV |
| `npm run pull:dev` | Baja desde DEV |
| `npm run push:prod` | Sube a PROD (separado) |
| `npm run deploy:prod` | Requiere `CONFIRM_PROD=yes` |
| `npm test` | Unit tests Node |
| `npm run test:integration` | Build + unit + probes HTTP |
