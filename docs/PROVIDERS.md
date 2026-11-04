# Proveedores — investigación y limitaciones

Fecha de sonda HTTP (Cloud Agent): **2026-11-04**.  
Orden de prioridad: Ecogas → OSSE → Naturgy → Municipalidad.

## Resumen ejecutivo

| Proveedor | Automatizable con UrlFetchApp hoy | Outcome típico | Acción owner |
|-----------|-----------------------------------|----------------|--------------|
| Ecogas | **No** (reCAPTCHA) | `auth_or_captcha_required` | Carga manual PDF / captura asistida |
| OSSE | **Pendiente** (DNS falló en cloud; re-probar en GAS) | `portal_inaccessible` o `not_implemented` | `probeOsse()` tras auth |
| Naturgy | **No** (SPA React sin API pública hallada) | `not_implemented` / structure | Mapear XHR en browser |
| Municipalidad | **Inactivo** (sin catastro) | `missing_property_info` / `disabled` | Proveer catastro en Sheets |

**Ningún adapter inventa facturas, montos ni estados de pago.**

---

## Ecogas (gas)

- Portal: https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p  
- Cuenta: `20259678`
- HTML 200 con `input[name=cliente]`, token hidden, **Google reCAPTCHA**.
- Apps Script no puede resolver captcha (política del proyecto: no bypassear).
- Alternativa nativa: owner descarga PDF → Drive `Invoices/YYYY/MM/` → fila en Invoices (o helper futuro de “import manual”).

## OSSE (agua)

- Portal declarado: https://facturaweb.osse.ar  
- Cuenta: `119 0080934 000 1` · Catastro: `023220474900000` · SISA: `60358`
- Desde la VM cloud: **DNS ENOTFOUND** para `facturaweb.osse.ar` y `osse.com.ar`.
- En runtime GAS la red puede diferir → ejecutar `probeOsse()` y actualizar este doc.
- Hasta mapear endpoint de factura/PDF: no reportar lista vacía como “sin facturas”; usar `portal_inaccessible` / `not_implemented`.

## Naturgy San Juan (luz)

- Portal: https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta  
- Suministro: `20004193466` · Medidor: `0142679`
- Shell React (`/static/js/*.chunk.js`); sin form SSR.
- Probes de `/api/...` tentativos incluidos en adapter; sin JSON usable en la sonda.
- Siguiente paso: Franco abre DevTools → Network al consultar suministro → compartir path API (sin credenciales en git).

## Municipalidad de Rivadavia

- Portal: http://181.209.107.110:83/deudavencida/deuda_total.aspx  
- Formulario ASP.NET: `__VIEWSTATE`, `txtIndice` (índice/catastro), `btnBuscar`.
- **Catastro: no disponible** → servicio seed con `enabled=false`, `cadastral_number` vacío.
- Activación: completar catastro en hoja Services + `enabled=TRUE` (sin inventar número).

---

## Outcomes del interface

Ver `src/providers/provider-interface.js`:  
`invoice_not_available_yet`, `available_not_downloadable`, `downloaded_ok`, `portal_inaccessible`, `portal_structure_changed`, `missing_property_info`, `auth_or_captcha_required`, `disabled`, `not_implemented`, `error`.

Regla: **no** tratar todo fallo HTTP como “no hay facturas este mes”.
