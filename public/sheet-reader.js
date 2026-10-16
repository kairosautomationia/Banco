/* Lector de hojas de cálculo en el navegador: convierte un .xlsx o un .csv en el mismo markdown de tablas que el extractor ya entiende.
   Así Excel y CSV no pasan por el OCR (más rápido, sin cuota de OCR y sin enviar el archivo a un tercero).
   Un .xlsx es un zip de XML: se lee el directorio central, se descomprime con DecompressionStream y se interpretan las celdas. */
(function (root) {
  const MAX_ROWS = 20000;
  const MAX_CHARS = 2000000;

  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir el archivo Excel');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Directorio central del zip: nombre -> { method, size, offset }.
  function zipEntries(buffer) {
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i -= 1) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('El archivo no parece un Excel (.xlsx) válido');
    const count = u16(view, eocd + 10);
    let p = u32(view, eocd + 16);
    const entries = new Map();
    const decoder = new TextDecoder();
    for (let n = 0; n < count; n += 1) {
      if (u32(view, p) !== 0x02014b50) throw new Error('El archivo Excel está dañado');
      const nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32);
      const name = decoder.decode(new Uint8Array(buffer, p + 46, nameLen));
      entries.set(name, { method: u16(view, p + 10), compressed: u32(view, p + 20), offset: u32(view, p + 42) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function readEntry(buffer, entries, name) {
    const e = entries.get(name);
    if (!e) return null;
    const view = new DataView(buffer);
    const start = e.offset + 30 + u16(view, e.offset + 26) + u16(view, e.offset + 28);
    const data = new Uint8Array(buffer, start, e.compressed);
    if (e.method === 0) return new TextDecoder().decode(data);
    if (e.method !== 8) throw new Error('El archivo Excel usa una compresión no admitida');
    return new TextDecoder().decode(await inflateRaw(data));
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, k) => {
    if (k[0] === '#') return String.fromCodePoint(k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
    return ENTITIES[k.toLowerCase()];
  });
  // Texto de un <si> o <is>: une los <t> de cada tramo e ignora la fonética (<rPh>).
  const textOf = (xml) => unxml([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

  const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

  // Formatos de fecha de Excel (incorporados y personalizados).
  const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function dateStyles(stylesXml) {
    const custom = new Map();
    for (const m of (stylesXml.match(/<numFmts\b[\s\S]*?<\/numFmts>/) || [''])[0].matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), unxml(m[2]));
    const isDate = (id) => BUILTIN_DATES.has(id) || (custom.has(id) && /[dmyhs]/i.test(custom.get(id).replace(/\[[^\]]*\]|"[^"]*"|\\./g, '')));
    const xfs = (stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
    return [...xfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map((m) => isDate(Number(m[1])));
  }
  const serialToIso = (serial) => new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);

  // Números sin ambigüedad de separadores: enteros sin puntos y decimales con punto (máx. 2).
  const fmtNumber = (v) => {
    if (!isFinite(v)) return String(v);
    const s = (Math.round(v * 100) / 100).toFixed(2);
    return s.replace(/\.?0+$/, '');
  };

  function parseSheet(xml, shared, dates) {
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const c of (row[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = (attrs.match(/\sr="([A-Z]+\d+)"/) || [])[1];
        if (!ref || c[2] === undefined) continue;
        const type = (attrs.match(/\st="(\w+)"/) || [])[1] || 'n';
        const style = Number((attrs.match(/\ss="(\d+)"/) || [])[1] || 0);
        const raw = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = null;
        if (type === 's') value = raw === undefined ? null : shared[Number(raw)];
        else if (type === 'inlineStr') value = textOf(c[2]);
        else if (type === 'str') value = raw === undefined ? null : unxml(raw);
        else if (type === 'b') value = raw === '1' ? 'Sí' : 'No';
        else if (type === 'n' && raw !== undefined && raw !== '') value = dates[style] ? serialToIso(Number(raw)) : fmtNumber(Number(raw));
        if (value !== null && value !== undefined && String(value).trim() !== '') cells[colIndex(ref)] = String(value).replace(/\s+/g, ' ').trim();
      }
      if (cells.some((v) => v !== undefined)) rows.push(cells);
      if (rows.length > MAX_ROWS) throw new Error('La hoja tiene demasiadas filas');
    }
    return rows;
  }

  // Una fila del markdown: desde la primera hasta la última celda con dato; los huecos intermedios llevan «n.d.» para no desalinear los periodos.
  function rowToMarkdown(cells) {
    const first = cells.findIndex((v) => v !== undefined);
    let last = cells.length - 1;
    while (last > first && cells[last] === undefined) last -= 1;
    const out = [];
    for (let i = first; i <= last; i += 1) out.push(cells[i] === undefined ? 'n.d.' : cells[i].replace(/\|/g, '/'));
    return `| ${out.join(' | ')} |`;
  }

  async function xlsxToMarkdown(buffer) {
    const entries = zipEntries(buffer);
    const wb = await readEntry(buffer, entries, 'xl/workbook.xml');
    if (!wb) throw new Error('El archivo no parece un Excel (.xlsx) válido');
    const rels = (await readEntry(buffer, entries, 'xl/_rels/workbook.xml.rels')) || '';
    const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [(m[0].match(/\sId="([^"]*)"/) || [])[1], (m[0].match(/\sTarget="([^"]*)"/) || [])[1]]));
    const sharedXml = (await readEntry(buffer, entries, 'xl/sharedStrings.xml')) || '';
    const shared = [...sharedXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] || ''));
    const dates = dateStyles((await readEntry(buffer, entries, 'xl/styles.xml')) || '');
    const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m, i) => ({
      name: unxml((m[0].match(/\sname="([^"]*)"/) || [])[1] || `Hoja ${i + 1}`),
      path: (() => { const t = target.get((m[0].match(/\sr:id="([^"]*)"/) || [])[1]) || `worksheets/sheet${i + 1}.xml`; return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`; })()
    }));
    const parts = [];
    let chars = 0;
    for (const sheet of sheets) {
      const xml = await readEntry(buffer, entries, sheet.path);
      if (!xml) continue;
      const rows = parseSheet(xml, shared, dates);
      if (!rows.length) continue;
      const text = rows.map(rowToMarkdown).join('\n');
      chars += text.length;
      if (chars > MAX_CHARS) throw new Error('La hoja de cálculo es demasiado grande');
      parts.push(sheets.length > 1 ? `## Hoja: ${sheet.name}\n${text}` : text);
    }
    return parts.join('\n\n');
  }

  // CSV (RFC 4180) con separador «,», «;» o tabulación detectado en la primera línea con datos.
  function csvToMarkdown(text) {
    const src = String(text || '').replace(/^﻿/, '');
    const head = src.split(/\r?\n/).find((l) => l.trim()) || '';
    const count = (ch) => (head.match(new RegExp(ch === '\t' ? '\t' : `\\${ch}`, 'g')) || []).length;
    const sep = [';', '\t', ','].map((ch) => [ch, count(ch)]).sort((a, b) => b[1] - a[1])[0];
    const delimiter = sep[1] ? sep[0] : ',';
    const rows = [];
    let row = [], cell = '', quoted = false;
    const endCell = () => { row.push(cell); cell = ''; };
    const endRow = () => { endCell(); if (row.some((c) => c.trim())) rows.push(row.map((c) => (c.trim() === '' ? undefined : c.replace(/\s+/g, ' ').trim()))); row = []; };
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delimiter) endCell();
      else if (ch === '\n') endRow();
      else if (ch !== '\r') cell += ch;
      if (rows.length > MAX_ROWS) throw new Error('El CSV tiene demasiadas filas');
    }
    if (cell !== '' || row.length) endRow();
    return rows.map(rowToMarkdown).join('\n');
  }

  // Bytes de un CSV a texto: UTF-8 y, si no lo es, Windows-1252 (Excel en español).
  function decodeCsv(buffer) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return new TextDecoder('windows-1252').decode(buffer); }
  }

  const api = { xlsxToMarkdown, csvToMarkdown, decodeCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SheetReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
