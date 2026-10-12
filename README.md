# Banco 4.0 · Scorecard de personas jurídicas

Simulador de decisión de crédito por fases. Cada fase se desbloquea al completar la anterior:
**Solicitud → Integración → Riesgo → Predicción → Protección → Decisión**.

- Carga un PDF, Word, Excel o CSV y un OCR extrae los 15 campos de la Sección 1 de la guía del Score Card.
- Calcula 10 indicadores, un score 0–999 (alto < 600, moderado 600–750, bajo > 750), monto sugerido, tasa referencial y 6 controles de consistencia.

> **Aviso:** los pesos del score, la probabilidad de incumplimiento y la tasa son **referenciales**: la guía define las variables y los rangos, no la fórmula del modelo real. No constituye preaprobación ni oferta de crédito.

## IA (Workers AI)

La IA sigue el flujo del Banco 4.0 (integra → predice → personaliza → detecta fraude → recomienda), pero con una regla fija: **la IA propone dentro de topes y el analista decide**. El score, el monto, la tasa, los 6 controles y la decisión de las reglas no cambian. Si la IA falla o no está disponible, el simulador funciona igual y lo indica.

| Fase | Qué hace la IA | Cómo se protege |
|---|---|---|
| 01→02 Integración | Al cargar un documento, completa los campos que el extractor por reglas no halló. | Solo acepta un valor si su evidencia es una cita literal del documento y contiene la cifra. Aparece marcado «IA · verifícalo». |
| 02 Integración | Integra el comportamiento financiero del cliente y el contexto del documento (garantías, litigios, concentración, notas…). | El comportamiento solo usa cifras del expediente; cada dato de contexto lleva una cita literal del documento. Sin documento no hay contexto. |
| 05 Protección | Señales de **posible fraude** o de consistencia que las 6 reglas no cubren, y una **propuesta de monto y tasa** con condiciones. | El monto propuesto nunca supera el tope de las reglas y la tasa debe estar dentro de un rango; lo que se sale se ignora. Se descartan señales que citan cifras ajenas al expediente. |
| 06 Decisión | **Recomienda** (aprobar, aprobar con condiciones, reducir monto o rechazar) con confianza, motivos y memo. | Nunca es más permisiva que las reglas: si lo es, se sube al nivel de las reglas y se avisa. Si es más estricta, se marca para revisión. |

- **Modelo por defecto:** `@cf/zai-org/glm-4.7-flash`: gratuito en el plan Workers Free (10.000 Neurons al día; una llamada típica gasta entre ~50 y ~150 Neurons según cuánto razone el modelo, así que alcanza para decenas de análisis completos al día; un documento largo gasta más), 131.072 tokens de contexto y multilingüe. Para uno más potente, como `@cf/zai-org/glm-5.3-flash` (1M de contexto, requiere Workers Paid o créditos de AI Gateway), define `AI_MODEL` en `wrangler.jsonc` > `vars`; las variables puestas solo en el panel se pierden en el siguiente deploy. Por fase: `AI_MODEL_INTEGRACION`, `AI_MODEL_PROTECCION` y `AI_MODEL_DECISION`.
- **Binding:** `"ai": { "binding": "AI" }` en `wrangler.jsonc`. No necesita clave de API. `AI_REASONING_EFFORT` (por defecto `low`; vacío lo desactiva).
- **Cambiar de proveedor** (por ejemplo, para comparar con un modelo de frontera): `AI_PROVIDER=openai` más `AI_BASE_URL`, `AI_API_KEY` y `AI_MODEL`, contra cualquier endpoint compatible con `/chat/completions`. La clave va como secreto del Worker.
- **Solo en el Worker:** `server.js` (Node local) no incluye la IA. Para probarla en local usa `npx wrangler dev`, que llama a Workers AI en remoto y pide iniciar sesión en Cloudflare.
- **Privacidad:** el texto del documento y los datos del expediente se envían al proveedor de IA. No cargues lo que no puedas compartir con un tercero.
- **Pruebas:** `npm test` valida los validadores, el extractor con estados financieros reales, el Worker (contraseña, rutas, subida de archivos de 30 KB a 20 MB y presupuesto de CPU) y el cambio de proveedor con un modelo simulado. No mide la calidad real de ningún modelo ni del OCR.
- **Prueba en vivo:** `BASE_URL=https://tu-worker.workers.dev ACCESS_PASSWORD=... npm run smoke` comprueba el sitio desplegado y cada tarea de IA con el modelo real.

## Operación y límites conocidos

Lo que conviene saber antes de depender del sistema (verificado, no supuesto):

- **Protege el sitio.** Sin el secreto `ACCESS_PASSWORD`, cualquiera que abra la URL puede gastar tu cuota de IA y de OCR. `npm run smoke` avisa si el sitio responde sin contraseña.
- **La IA nunca decide sola.** Si falla, el simulador sigue con las reglas. Cuando la salida del modelo no sirve (vacía, sin JSON o con cifras ajenas), se reintenta una vez en modo estricto y, si vuelve a fallar, se muestra solo lo determinista.
- **Plan Workers Free:** 10.000 Neurons/día, 50 subpeticiones y **10 ms de CPU por solicitud** (superarlo da el error 1102). El sondeo del OCR usa espera progresiva (~30 subpeticiones); el archivo se recibe con una sola copia en memoria y el texto del OCR se reenvía como flujo; la validación de IA con un documento de 200 KB gasta ~2 ms. Medido: un estado de 24–200 KB cabe de sobra; documentos de decenas de MB o de cientos de páginas pueden acercarse al límite en el plan gratuito (en el de pago no hay problema). Si agotas la cuota diaria de Neurons, la IA responde error hasta las 00:00 UTC; un análisis con un documento de ~100 KB gasta unos 400–600 Neurons (≈ 15–25 análisis al día).
- **Tamaño de archivo:** hasta 20 MB (se rechaza antes de leerlo entero, también sin `Content-Length`). La IA recibe como máximo los primeros 200.000 caracteres del texto; el extractor por reglas lee el documento completo.
- **Comprobar el OCR real en tu despliegue:** `BASE_URL=https://tu-worker.workers.dev ACCESS_PASSWORD=... npm run smoke -- --file test/fixtures/estados-financieros.pdf` sube el archivo, mide cuánto tarda el OCR y compara los 15 campos extraídos con la verdad conocida (hay también `.docx`, `.xlsx`, `.csv` y un PDF escaneado, solo imagen, que depende por completo del OCR). Con tus propios archivos muestra qué leyó, sin comparar.
- **Edición manual de cifras:** el punto es separador de miles y la coma, decimal. Los centavos se descartan. «1234.56» y «1,234.56» pegados desde Excel también se entienden.
- **Seguridad:** el Worker envía CSP (solo scripts propios), `X-Frame-Options`, `nosniff` y `Referrer-Policy` en todas las respuestas. No hay límite de intentos de contraseña (Basic): usa una contraseña larga.
- **Extractor por reglas (heurístico):** de todas las filas candidatas elige la correcta (ventas de 4 periodos de la tabla comparativa, «Total patrimonio» sobre los subtotales, el total de la deuda o la suma de corto y largo plazo), ignora porcentajes, razones (`Margen EBITDA`, `Deuda / EBITDA`, `por acción`), la columna «Nota», años sueltos y el efectivo del flujo de efectivo, entiende `(85.000)`, `−85.000`, `85.000-` y «Pérdida neta» como negativos, y lee CSV con `;`. Medido con estados financieros sintéticos de 47–388 KB: 105 de 105 campos exactos, y sin la solicitud todo lo que encuentra es correcto. Los datos de la solicitud (instituciones con deuda, vencidos de accionistas, deuda con el banco y deuda solicitada) no existen en un estado financiero: se completan con la IA (si el documento los cita) o a mano. Sigue siendo un apoyo: **revisa cada valor**, sobre todo si el documento está en miles o millones (el extractor avisa y no convierte la escala).
- **EBITDA, patrimonio y utilidad neta pueden ser negativos** (el motor los evalúa con la peor puntuación); el resto de montos no.
- **Etiquetas de periodo fijas:** las ventas se etiquetan `dic-24 … dic-21` como en la guía. Si cambia el ejercicio, hay que actualizar `index.html`, `app.js` y `extractor.js`.
- **OCR:** usa la API v1 de LlamaParse (`/api/parsing`). Si LlamaIndex la retira, solo falla la carga de archivos; el simulador y la entrada manual siguen funcionando.
- **Privacidad:** el documento va a LlamaParse (OCR) y, junto con el expediente, al proveedor de IA. La página carga tipografías de Google Fonts.
- **Defecto visual conocido:** en móvil (≤ 400 px) la barra de pasos superior desborda unos 70 px; ya existía y no afecta a las funciones.
- **Pruebas:** `npm test` (Node ≥ 22.7 para las del Worker; en versiones anteriores se omiten). Hay integración continua en cada PR (`.github/workflows/test.yml`).

## Ejecutar en local

Requiere Node.js 18 o superior. No tiene dependencias.

```bash
cp .env.example .env      # y completa LLAMA_CLOUD_API_KEY
node server.js            # abre http://localhost:3000
```

En Windows también sirve `iniciar.bat`.

Sin clave el simulador funciona con entrada manual y casos de ejemplo; solo la carga de archivos con OCR requiere `LLAMA_CLOUD_API_KEY` (LlamaParse / LlamaCloud).

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `LLAMA_CLOUD_API_KEY` | Para el OCR | Clave de LlamaCloud. Vive solo en el servidor. |
| `PORT` | No | Puerto (por defecto 3000). |
| `HOST` | No | `127.0.0.1` en local; `0.0.0.0` en un hosting. |
| `ACCESS_PASSWORD` | Recomendada al publicar | Si se define, el sitio y el OCR piden contraseña (HTTP Basic). |

## Desplegar

El sitio necesita un backend porque la clave del OCR no puede ir en el navegador. **GitHub Pages no sirve** para la versión completa (solo aloja archivos estáticos).

### Cloudflare Workers (configuración incluida)

`wrangler.jsonc` y `worker.js` despliegan el sitio (carpeta `public/`) y el proxy del OCR en un Worker.

1. En Cloudflare: Workers & Pages → Create → conecta este repo. Comando de compilación: vacío. Comando de implementación: `npx wrangler deploy`.
2. El nombre del Worker en Cloudflare debe coincidir con `"name"` de `wrangler.jsonc` (`banco`).
3. En Settings → Variables and secrets del Worker, crea como **secretos** `LLAMA_CLOUD_API_KEY` y `ACCESS_PASSWORD`.

Cada push a `main` vuelve a desplegar. Prueba local del Worker: `npx wrangler dev` (pon las claves en un archivo `.dev.vars`, que no se sube a git).

### Otros hosts (Node)

Render, Railway, Fly.io o cualquier host con Docker.

- **Sin Docker:** comando de inicio `npm start`, variables `HOST=0.0.0.0`, `LLAMA_CLOUD_API_KEY`, `ACCESS_PASSWORD`.
- **Con Docker:**

```bash
docker build -t banco-4-0 .
docker run -p 3000:3000 -e LLAMA_CLOUD_API_KEY=... -e ACCESS_PASSWORD=... banco-4-0
```

Si lo publicas en Internet **define siempre `ACCESS_PASSWORD`**: sin ella, cualquiera podría gastar tus créditos de OCR.

## Privacidad

Los archivos que se cargan se envían a LlamaParse para leerlos. No cargues documentos que no puedas compartir con un tercero.

## Estructura

| Archivo | Función |
|---|---|
| `public/index.html`, `public/styles.css`, `public/app.js` | Interfaz y lógica del scorecard por fases |
| `public/extractor.js` | Convierte la salida del OCR en los 15 campos |
| `server.js` | Servidor Node (local, Docker, otros hosts): sirve `public/` y hace de proxy seguro hacia el OCR (sin IA) |
| `worker.js`, `wrangler.jsonc` | Lo mismo para Cloudflare Workers, con IA, contraseña y cabeceras de seguridad |
| `ai.mjs` | Capa de IA: proveedores intercambiables, validadores y reintento estricto |
| `ocr.mjs` | Espera progresiva del sondeo a LlamaParse |
| `test/` | `npm test` (85 pruebas); `test/fixtures/` tiene estados financieros sintéticos de más de 24 KB con verdad conocida |
| `scripts/smoke.mjs` | Prueba en vivo contra un despliegue (sitio, IA y OCR) |
| `.github/workflows/test.yml` | Corre las pruebas en cada PR |
