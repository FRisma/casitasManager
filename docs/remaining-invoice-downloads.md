# Plan: descargas restantes (Ecogas, Naturgy, Municipalidad)

Fecha: **2026-11-04** · Tras OSSE auto en `main` (PR #1)  
Fuentes: [`provider-fetch-feasibility.md`](./provider-fetch-feasibility.md), adapters `src/providers/{ecogas,naturgy,municipalidad}.js`, `docs/OPERATIONS.md`  
Reglas: **sin bypass de CAPTCHA/Turnstile** · no inventar montos/catastro · no activar PROD sin OK.

Helpers ya listos: `importManualInvoice` / `importManualInvoiceFromDrive` / `getManualInvoiceTemplate` / menú `menuDescargar*`.

---

## Resumen rápido

| Proveedor | ¿Por qué falla el auto hoy? | Mejor próximo camino | Esfuerzo |
|-----------|----------------------------|----------------------|----------|
| **Ecogas** | reCAPTCHA en el login | Mejorar import manual Drive (+ bookmarklet opcional) | **S** (UX) / **M** (semi-cookie) |
| **Naturgy** | SPA + token de sesión / Turnstile | Manual Drive, o semi-auto con token que Franco pega tras login humano | **S** (UX) / **M** (token) |
| **Municipalidad** | Sin catastro + parser ASP.NET no cableado | Confirmar catastro → POST + boleta | **M** |

**Prioridad sugerida post-OSSE:** (1) UX de import manual compartido Ecogas+Naturgy → (2) Municipalidad cuando haya catastro → (3) semi-auto Naturgy con token solo si Franco quiere menos fricción mensual.

---

## 1. Ecogas (gas)

### Por qué el auto falla hoy

- Portal: `https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p`
- Adapter (`ecogas.js`): el GET al login ve form `#form_login_po` + **Google reCAPTCHA** → outcome `auth_or_captcha_required`.
- Sin sesión humana no hay lista ni PDF. Apps Script **no puede** resolver reCAPTCHA; no se bypasea.
- Cuenta en seed: `20259678`.

### Mejor próximo enfoque

**Recomendado: mejorar el flujo manual Drive** (ya existe el camino honesto).

Alternativas, en orden de preferencia:

1. **UX manual Drive (recomendado)** — Franco descarga PDF en el browser (él resuelve el captcha), sube a Drive, importa. Reducir fricción del `fileId` + menú/prompt.
2. **Bookmarklet en el browser** — tras bajar el PDF (o con el blob en la página), un bookmarklet ayuda a subir/abrir Drive o copiar metadatos; **no** resuelve captcha.
3. **Semi-auto con cookies de sesión** — Franco inicia sesión a mano, pega cookies en Script Properties; GAS reusa la sesión **solo si** las APIs post-login no piden captcha de nuevo. Frágil (expiran, dependen del portal). **No** inventar `g-recaptcha-response`.
4. Full auto — **no viable** mientras el login exija reCAPTCHA.

### Pasos concretos si elige uno

**A) UX import manual (S)**

1. Menú `CasitasManager` → ítem tipo “Importar PDF desde Drive…” que pide `fileId` / URL + provider + período + monto (Ui.prompt o sidebar mínima).
2. Validar PDF con `looksLikePdf` (mismo path que OSSE) → `importManualInvoiceFromDrive`.
3. Prefijar `provider:'ecogas'` y `billingPeriod` del mes actual.
4. Doc corta en OPERATIONS + hint del menú ya existente.
5. (Opcional) carpeta Drive fija `Inbox-Manual/` + helper que lista PDFs recientes sin fileId a mano.

**B) Bookmarklet (S)**

1. Bookmarklet que, en la página de factura Ecogas o sobre un PDF abierto, copie al clipboard un snippet listo:
   `importManualInvoiceFromDrive('…', { provider:'ecogas', billingPeriod:'YYYY-MM', … })`.
2. Guardar el snippet en `docs/` o Sheet “Ops snippets”; sin tocar el portal.

**C) Cookies post-login (M) — solo si A no alcanza**

1. Franco loguea en browser, DevTools → copiar Cookie header **por canal privado** (no chat público).
2. Guardar en Script Property `ECOGAS_SESSION_COOKIE` (rotación manual).
3. Probe: GET/POST a endpoints de factura **con** esa cookie; si HTML=login/captcha → abortar con `auth_or_captcha_required`.
4. Si responde lista/PDF: mapear a `fetchInvoices` / `downloadInvoice` como OSSE.
5. Tests unitarios con fixtures HTML/PDF; nunca hardcodear captcha.

### Esfuerzo

| Opción | Tamaño |
|--------|--------|
| UX menú + Inbox Drive | **S** |
| Bookmarklet | **S** |
| Sesión por cookies | **M** (y puede morir con el próximo cambio de portal) |

---

## 2. Naturgy San Juan (luz)

### Por qué el auto falla hoy

- Portal: `https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta`
- Shell React (Widergy); UrlFetch sin token recibe HTML shell, no JSON/PDF.
- APIs en bundle: `/api/v1/bills/public_pdf`, `bill_detail`, `accounts/payment_information` — llevan **token** de sesión.
- Señales Cloudflare **Turnstile** → no bypassear.
- Adapter (`naturgy.js`): probes anónimos → `auth_or_captcha_required` + `manualImport: true`.
- Suministro / medidor: `20004193466` / `0142679`.

### Mejor próximo enfoque

**Corto plazo: mismo UX manual Drive que Ecogas** (compartir código).

**Mediano (si Franco acepta pegar un token):** semi-auto legítimo — él entra al portal, copia el `token` de una XHR real (Network), lo pega en Script Properties; GAS llama solo a las APIs Widergy con ese token. Si Turnstile bloquea de nuevo → outcome honesto, sin bypass.

Bookmarklet útil para extraer URL `public_pdf?token=…` desde Network o para armar el import manual.

### Pasos concretos si elige uno

**A) UX manual compartido (S)** — igual que Ecogas §A, con `provider:'naturgy'`.

**B) Mapa XHR + token pegado (M)**

1. Franco (browser, sesión humana): consulta/descarga una boleta → DevTools Network.
2. Anotar URL, query (`token`, `supply`), headers mínimos, content-type del PDF.
3. Guardar token en Property `NATURGY_SESSION_TOKEN` (privado; rotación al expirar).
4. Extender adapter:
   - `fetchInvoices`: `bill_detail` / payment_information con token.
   - `downloadInvoice`: `public_pdf` → blob `%PDF` → `persistProviderFetch`.
5. Si respuesta HTML/401/Turnstile → `auth_or_captcha_required` (mensaje: “renová el token”).
6. Menú: “Descargar Naturgy (sesión)” solo si hay Property seteada.
7. Unit tests con fixtures JSON/PDF; **cero** tokens reales en el repo.

**C) Bookmarklet (S)**

1. Bookmarklet que lea el último link `public_pdf` de performance entries / o pida pegar la URL, y genere el snippet `importManualInvoiceFromDrive` o abra el PDF para bajar a Drive.

### Esfuerzo

| Opción | Tamaño |
|--------|--------|
| UX manual compartido | **S** (junto con Ecogas) |
| Bookmarklet | **S** |
| Adapter con token pegado | **M** |

---

## 3. Municipalidad de Rivadavia

### Por qué el auto falla hoy

- Portal: `http://181.209.107.110:83/deudavencida/deuda_total.aspx` (ASP.NET clásico).
- Form reachable: `__VIEWSTATE`, `__EVENTVALIDATION`, `txtIndice` (catastro, máx 16), radios, `btnBuscar`, `btnBoleta`.
- Seed: `enabled=false`, `cadastral_number` vacío → adapter responde `disabled` / `missing_property_info`.
- Con catastro presente el código aún dice **`not_implemented`** (POST + parser de grilla/boleta no cableados).
- **No inventar catastro.**

Nota: el seed de OSSE ya trae catastro de propiedad `023220474900000`. **Puede** ser el mismo índice municipal — Franco debe **confirmar** en el portal (o boleta) antes de escribirlo en Services. No asumir.

### Mejor próximo enfoque

**Esperar / confirmar catastro → full auto ASP.NET** (único de los tres con camino claro a automatización sin captcha conocido).

Hasta entonces: import manual si ya tiene boleta PDF.

### Pasos concretos si elige uno

**A) Activar con catastro real (bloqueo humano, luego M de código)**

1. Franco confirma nomenclatura/catastro (probar `023220474900000` en el form si corresponde).
2. Hoja **Services** fila municipalidad: `cadastral_number=…`, `enabled=TRUE` (sin redeploy obligatorio para el enable).
3. `probeMunicipalidad()` en DEV — GET form OK.
4. Implementar en `municipalidad.js`:
   - GET → capturar VIEWSTATE / EVENTVALIDATION.
   - POST `btnBuscar` con `txtIndice` + radio Inmueble.
   - Parsear grilla (período, monto, vencimiento) → `fetchInvoices`.
   - POST/GET `btnBoleta` o link de impresión → PDF o HTML imprimible; si solo HTML, decidir PDF vía conversión o marcar `available_not_downloadable` + manual.
5. Cablear `menuDescargarMunicipalidad` / `runProvider('municipalidad')` al mismo `persistProviderFetch` que OSSE.
6. Tests con fixtures HTML de respuesta (sin IP live obligatoria en CI).
7. Outcomes honestos: HTTP/IP caído → `portal_inaccessible`; form distinto → `portal_structure_changed`; sin filas del período → `invoice_not_available_yet`.

**B) Mientras tanto — manual (S / ya existe)**

1. Bajar boleta del portal a mano (con el catastro que Franco conozca).
2. `importManualInvoiceFromDrive` con `provider:'municipalidad'`.

### Esfuerzo

| Opción | Tamaño |
|--------|--------|
| Solo cargar catastro en Sheet | **S** (humano; 0 código) |
| POST + parser + PDF/boleta | **M** |
| Import manual mientras tanto | **S** (ya listo) |

---

## Recomendación de implementación (orden)

1. **S — UX import manual unificado** (menú/prompt + opcional Inbox Drive) para Ecogas y Naturgy. Valor inmediato cada mes.
2. **S — Bookmarklet opcional** si Franco usa mucho el browser.
3. **M — Municipalidad auto** en cuanto confirme catastro (candidato a verificar: `023220474900000`).
4. **M — Naturgy con token pegado** solo si el manual sigue molestando y el XHR es estable.
5. **Ecogas cookies** — último recurso; el captcha de login hace que el ROI sea peor que Naturgy.

### Qué no hacer

- Resolver o simular reCAPTCHA / Turnstile.
- Pegar cookies/tokens en Issues, PRs o chat público.
- Marcar `enabled=TRUE` en Municipalidad sin catastro real.
- Tratar fallo de portal como “no hay factura este mes”.

### Criterio de éxito por proveedor

| Proveedor | Éxito |
|-----------|--------|
| Ecogas / Naturgy (manual+) | Franco carga PDF en &lt;2 min vía menú; fila Invoices + Drive + notify owner OK |
| Naturgy (token) | `menuDescargarNaturgy` con Property → PDF auto hasta que expire el token |
| Municipalidad | Tras catastro: `runProvider('municipalidad')` → PDF/boleta o metadata honesta + Drive |

---

## Referencias en repo

- Adapters: `src/providers/ecogas.js`, `naturgy.js`, `municipalidad.js`, `osse.js` (patrón a copiar)
- Manual: `src/app/main.js` (`importManual*`), `src/services/invoices.js`
- Ops: `docs/OPERATIONS.md`, `docs/PROVIDERS.md`
- Viabilidad previa: `docs/provider-fetch-feasibility.md`
