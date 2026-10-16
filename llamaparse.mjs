// Parse API v2 de LlamaParse. La v1 (/api/parsing) responde 410 en las cuentas nuevas.
// Flujo: POST /upload (archivo + configuration) -> GET /{id} hasta COMPLETED -> GET /{id}?expand=markdown.
// Lo comparten el Worker, el servidor local y el script de prueba en vivo (scripts/smoke.mjs).
export const BASE = 'https://api.cloud.llamaindex.ai/api/v2/parse';
export const DEFAULT_TIER = 'cost_effective';   // cost_effective | agentic | agentic_plus (LLAMA_PARSE_TIER)

export const configuration = (tier) => JSON.stringify({ tier: tier || DEFAULT_TIER, version: 'latest' });

export const jobIdOf = (r) => String((r && (r.id || (r.job && r.job.id))) || '');
export const statusOf = (r) => String((r && ((r.job && r.job.status) || r.status)) || '').toUpperCase();
export const isDone = (status) => status === 'COMPLETED' || status === 'SUCCESS';
export const isFailed = (status) => ['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(status);

// Texto del documento, venga como `markdown` (cadena), `markdown_full` o `markdown.pages[].markdown`.
export function markdownOf(r) {
  if (!r || typeof r !== 'object') return '';
  if (typeof r.markdown === 'string') return r.markdown;
  if (typeof r.markdown_full === 'string') return r.markdown_full;
  const pages = r.markdown && Array.isArray(r.markdown.pages) ? r.markdown.pages : [];
  return pages.map((p) => (typeof p === 'string' ? p : (p && (p.markdown || p.text)) || '')).filter(Boolean).join('\n\n');
}
