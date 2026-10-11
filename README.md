# Banco 4.0 · Scorecard de personas jurídicas

Simulador de decisión de crédito por fases. Cada fase se desbloquea al completar la anterior:
**Solicitud → Integración → Riesgo → Predicción → Protección → Decisión**.

- Carga un PDF, Word, Excel o CSV y un OCR extrae los 15 campos de la Sección 1 de la guía del Score Card.
- Calcula 10 indicadores, un score 0–999 (alto < 600, moderado 600–750, bajo > 750), monto sugerido, tasa referencial y 6 controles de consistencia.

> **Aviso:** los pesos del score, la probabilidad de incumplimiento y la tasa son **referenciales**: la guía define las variables y los rangos, no la fórmula del modelo real. No constituye preaprobación ni oferta de crédito.

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

El sitio necesita el servidor Node porque la clave del OCR no puede ir en el navegador. **GitHub Pages no sirve** para la versión completa (solo aloja archivos estáticos).

Opciones sencillas: Render, Railway, Fly.io o cualquier host con Docker.

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
| `index.html`, `styles.css`, `app.js` | Interfaz y lógica del scorecard por fases |
| `extractor.js` | Convierte la salida del OCR en los 15 campos |
| `server.js` | Sirve el sitio y hace de proxy seguro hacia el OCR |
