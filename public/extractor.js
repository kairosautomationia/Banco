/* Extrae los 15 campos de la Sección 1 del scorecard desde el texto/markdown que devuelve el OCR.
   Reglas por etiqueta: es un apoyo, no una verdad; el usuario revisa y corrige cada valor. */
(function (root) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // "$ 6.337.000,00" · "6,337,000.00" · "(5.000)" · "-1 200"
  function parseNumber(token) {
    let t = token.trim();
    const negative = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/^\(|\$|\s/g, '')) ;
    t = t.replace(/[()$\s-]/g, '');
    if (!/\d/.test(t)) return NaN;
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    let decimalSep = null;
    if (lastDot !== -1 && lastComma !== -1) decimalSep = lastDot > lastComma ? '.' : ',';
    else if (lastComma !== -1) decimalSep = (t.match(/,/g).length === 1 && t.length - lastComma - 1 !== 3) ? ',' : null;
    else if (lastDot !== -1) decimalSep = (t.match(/\./g).length === 1 && t.length - lastDot - 1 !== 3) ? '.' : null;
    let cleaned = decimalSep ? t.replace(new RegExp(decimalSep === '.' ? ',' : '\\.', 'g'), '').replace(decimalSep, '.') : t.replace(/[.,]/g, '');
    const n = Number(cleaned);
    return isFinite(n) ? (negative ? -n : n) : NaN;
  }

  const NUM_RE = /(?<![A-Za-z\d\-])\(?-?\s?\$?\s?\d[\d.,]*\)?/g;
  // Un número seguido de % (margen, variación) no es una cifra del estado financiero.
  function numberTokens(text) {
    const pct = /\s*%/y;
    const out = [];
    for (const m of text.matchAll(NUM_RE)) {
      pct.lastIndex = m.index + m[0].length;
      if (pct.test(text)) continue;
      const value = parseNumber(m[0]);
      if (isFinite(value)) out.push({ raw: m[0].replace(/[()$\s-]/g, ''), value });
    }
    return out;
  }
  const numbersIn = (text) => numberTokens(text).map((t) => t.value);
  // «Ventas | 5 | 6.337.000 | …»: un entero de 1–2 dígitos antes de cifras grandes es el número de nota, no un dato.
  const dropNoteColumn = (tokens) => (tokens.length > 1 && /^\d{1,2}$/.test(tokens[0].raw) && tokens.slice(1).some((x) => Math.abs(x.value) >= 1000) ? tokens.slice(1) : tokens);
  // Razones y márgenes («Margen EBITDA», «Utilidad neta / ventas», «Deuda / EBITDA») no son el dato que buscamos.
  const RATIO = /\b(margen|ratio|cobertura|apalancamiento|veces|multiplo|rentabilidad|rotacion|indice)\b|\//;

  function splitLine(raw) {
    const line = raw.replace(/\*\*|__|`/g, '').trim();
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (!cells.length || cells.every((c) => /^[-:\s]+$/.test(c))) return null;
      return { label: cells[0], rest: cells.slice(1).join(' | '), raw: line };
    }
    const m = line.match(/^(.*?)(?:\s*[:：]\s*|\s{2,}|\s(?=[$(\-]?\s?\d))(.*)$/);
    return m ? { label: m[1], rest: m[2], raw: line } : { label: line, rest: '', raw: line };
  }

  const MONTHS = /(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*[-\s/.]*'?(\d{2,4})/g;
  function detectAscending(lines) {
    for (const line of lines) {
      const text = norm(line);
      const years = [];
      let m;
      MONTHS.lastIndex = 0;
      while ((m = MONTHS.exec(text))) years.push(Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]));
      if (years.length < 2) { (text.match(/\b20\d{2}\b/g) || []).forEach((y) => years.push(Number(y))); }
      if (years.length >= 2) return years[0] < years[years.length - 1];
    }
    return false;
  }

  const FIELDS = [
    { id: 'sales', multi: 4, keepRatios: true, patterns: [/^(total )?ventas( netas| anuales| totales)?\b/, /^ingresos (por )?(ventas|operacionales|ordinarios|de actividades)/, /^ventas\b/, /^ingresos\b/] },
    { id: 'ebitda', patterns: [/\bebitda\b/] },
    { id: 'finExp', abs: true, patterns: [/gastos? financieros?/, /intereses (pagados|por pagar|financieros|generados)/, /costos? financieros?/] },
    { id: 'cash', patterns: [/efectivo.*(certificados|equivalentes)/, /^efectivo\b/, /caja y bancos/, /^disponible/] },
    { id: 'employees', int: true, keepRatios: true, patterns: [/n(u|ú)mero de empleados/, /^empleados/, /^personal\b/, /^n(o|°|º)\.? de empleados/] },
    { id: 'netIncome', patterns: [/utilidad neta/, /resultado neto/, /ganancia neta/, /utilidad del ejercicio/, /perdida neta/, /resultado del (periodo|ejercicio)/] },
    { id: 'equity', patterns: [/^(total )?patrimonio( neto| contable)?\b/], exclude: /pasivo/ },
    { id: 'institutions', int: true, keepRatios: true, patterns: [/instituciones financieras/, /n(u|ú)mero de (bancos|instituciones)/, /cantidad de instituciones/] },
    { id: 'overdue', text: true, patterns: [/vencidos/] },
    { id: 'requested', patterns: [/deuda solicitada/, /incremento (en )?(el )?riesgo/, /monto solicitado/, /^solicitud\b/] },
    { id: 'bbDebt', patterns: [/^deuda actual/, /exposicion actual/] },
    { id: 'debt', patterns: [/deuda en el sistema financiero/, /deuda (financiera )?total/, /total deuda financiera/, /^obligaciones financieras/, /^deuda\b/] }
  ];

  function extract(markdown) {
    const rawLines = String(markdown || '').split(/\r?\n/);
    const asc = detectAscending(rawLines);
    const parsed = rawLines.map(splitLine);
    const used = new Set();
    const out = {};
    const evidence = {};
    const warnings = [];

    const setValue = (id, value, ev) => { out[id] = value; evidence[id] = ev; };
    const pick = (nums) => (asc ? nums[nums.length - 1] : nums[0]);

    FIELDS.forEach((field) => {
      for (const pattern of field.patterns) {
        for (let i = 0; i < parsed.length; i += 1) {
          const p = parsed[i];
          if (!p || used.has(i)) continue;
          const label = norm(p.label);
          if (!pattern.test(label) || (field.exclude && field.exclude.test(label)) || (!field.keepRatios && RATIO.test(label))) continue;
          if (field.text) {
            const m = norm(p.rest || p.label).match(/\b(si|no)\b\s*$/) || norm(p.rest).match(/\b(si|no)\b/);
            if (!m) continue;
            used.add(i);
            setValue('overdue', m[1], p.raw);
            return;
          }
          let nums = (field.int ? numberTokens(p.rest) : dropNoteColumn(numberTokens(p.rest))).map((x) => x.value);
          if (!nums.length && /^[\s|$]*[-–—][\s|$-]*$/.test(p.rest)) nums = [0];
          if (!nums.length) {
            // valores en la fila siguiente sin etiqueta (encabezado de periodos arriba)
            for (let j = i + 1; j <= i + 2 && j < parsed.length; j += 1) {
              const q = parsed[j];
              if (!q || used.has(j) || /[a-z]/i.test(q.label)) continue;
              const next = numbersIn(q.raw);
              if (next.length) { nums = next; used.add(j); break; }
            }
          }
          if (!nums.length) continue;
          used.add(i);
          if (field.multi) {
            const ordered = asc ? [...nums].reverse() : nums;
            ['sales24', 'sales23', 'sales22', 'sales21'].forEach((k, idx) => { if (ordered[idx] !== undefined) setValue(k, ordered[idx], p.raw); });
          } else {
            const v = pick(nums);
            setValue(field.id, field.int ? Math.round(v) : field.abs ? Math.abs(v) : v, p.raw);
          }
          return;
        }
      }
    });

    // EBITDA calculado cuando el documento solo trae utilidad operativa y depreciación
    if (out.ebitda === undefined) {
      const find = (re) => parsed.findIndex((p, i) => p && !used.has(i) && re.test(norm(p.label)) && numbersIn(p.rest).length);
      const op = find(/utilidad (operativa|operacional)|resultado operacional|resultado operativo/);
      const dep = find(/depreciacion|amortizacion/);
      if (op !== -1 && dep !== -1) {
        setValue('ebitda', pick(numbersIn(parsed[op].rest)) + pick(numbersIn(parsed[dep].rest)), `Calculado: ${parsed[op].raw} + ${parsed[dep].raw}`);
      }
    }

    if (/en miles|miles de (usd|d[oó]lares|us\$)|\(000\)/i.test(norm(markdown))) warnings.push('El documento parece expresado en miles: verifica la escala de las cifras antes de analizar.');
    if (out.sales24 !== undefined && out.sales23 === undefined) warnings.push('Solo se encontró un periodo de ventas; completa los demás manualmente.');
    return { values: out, evidence, warnings };
  }

  const api = { extract, parseNumber, numbersIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Extractor = api;
})(typeof window !== 'undefined' ? window : globalThis);
