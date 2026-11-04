# Setup — CasitasManager

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

```bash
npm run push:dev
```

Abrí el editor del proyecto DEV → ejecutar función **`setupDevEnvironment`** (autorizar Sheets/Drive/Gmail/UrlFetch).

Resultado esperado (objeto en log):

- `spreadsheetUrl`
- `drive.rootUrl` / `propertyUrl`
- `dryRun: true`

Completar en hoja **Contacts** los emails/telegram reales de owners (prueba) y tenants (solo se usan en PROD).

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
