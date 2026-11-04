# Entorno de desarrollo — CasitasManager

Fecha de inspección: **2026-11-04** (Cloud Agent VM).

## Resumen

| Herramienta | Estado | Notas |
|-------------|--------|-------|
| SO | Linux 6.12 (x86_64) | Cloud Agent |
| Node.js | v22.23.4 | OK (≥18) |
| npm | 10.9.9 | OK |
| Git | Disponible | Repo `FRisma/casitasManager` |
| GitHub CLI (`gh`) | Autenticado | Push remoto OK |
| `@google/clasp` | **2.5.0** (devDependency local) | `npx clasp` / `npm run clasp:version` |
| `clasp login` | **Pendiente** | No existe `~/.clasprc.json` |
| Script IDs DEV/PROD | **Placeholders** | Ver `.clasp.dev.json` / `.clasp.prod.json` |
| Google Drive / Sheets | **DEV creados** (2026-11-04) | Ver `docs/DEV_RESOURCES.md` |
| Navegador / automatización | Limitado | Sin perfil persistente; no se usa para bypassear captchas |

## Red hacia portales (sonda 2026-11-04)

| Portal | Resultado |
|--------|-----------|
| Ecogas autogestión | HTTP 200 — HTML con form `cliente` + **reCAPTCHA** |
| Naturgy oficina virtual | HTTP 200 — **SPA React** (chunks JS) |
| Municipalidad Rivadavia (`181.209.107.110:83`) | HTTP 200 — formulario ASP.NET (`txtIndice`) |
| OSSE `facturaweb.osse.ar` | **DNS no resuelve** desde esta VM |

## Conclusión Phase 1

Toolchain local listo. Bloqueo restante: **autorización Google de Franco** (`clasp login`, creación de proyectos Apps Script, Script IDs, ejecución de `setupEnvironment()`).

Comandos:

```bash
cd /agent/repos/casitasManager   # o clone local
npm install
npm run clasp:login              # Franco — abre navegador OAuth
# Crear proyectos "CasitasManager DEV" y "CasitasManager PROD" en script.google.com
# Pegar Script IDs en .clasp.dev.json y .clasp.prod.json
npm run push:dev
# En editor Apps Script DEV → ejecutar setupDevEnvironment
```
