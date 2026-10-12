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
  // Dentro de una tabla o CSV, «6 337 000» es una sola cifra (miles con espacio). En texto corrido no: «640 520» serían dos columnas.
  const NUM_RE_SPACED = /(?<![A-Za-z\d\-])\(?-?\s?\$?\s?(?:\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|\d[\d.,]*)\)?/g;
  // Un número seguido de % (margen, variación) no es una cifra del estado financiero.
  function numberTokens(input) {
    // Signo menos tipográfico (−) y guion largo pegado a la cifra (–150.000) son negativos; con espacio detrás el guion es un separador.
    const text = input.replace(/\u2212/g, '-').replace(/(^|[\s|($])[\u2013\u2014](?=\$?\d)/g, '$1-');
    const pct = /\s*%/y;
    const trailing = /-(?=\s|\||$)/y;
    const out = [];
    for (const m of text.matchAll(/[|;\t]/.test(text) ? NUM_RE_SPACED : NUM_RE)) {
      const end = m.index + m[0].length;
      pct.lastIndex = end;
      if (pct.test(text)) continue;
      let value = parseNumber(m[0]);
      trailing.lastIndex = end;
      if (value > 0 && trailing.test(text)) value = -value;   // «150.000-»
      if (isFinite(value)) out.push({ raw: m[0].replace(/[()$\s-]/g, ''), value });
    }
    return out;
  }
  const numbersIn = (text) => numberTokens(text).map((t) => t.value);
  // Un año suelto («Ventas del año 2024: 6.337.000 … en 2023») no es una cifra; y un entero de 1–2 dígitos delante de cifras mucho mayores
  // («Ventas | 5 | 6.337.000», «Efectivo | 4 | 800») es el número de nota, no un dato.
  function cleanTokens(tokens, int) {
    let list = int ? tokens : tokens.filter((x) => !/^(19|20)\d{2}$/.test(x.raw));
    if (list.length > 1 && /^\d{1,2}$/.test(list[0].raw) && list.slice(1).some((x) => Math.abs(x.value) >= Math.max(50, Number(list[0].raw) * 8))) list = list.slice(1);
    return list;
  }
  const dropNoteColumn = (tokens) => cleanTokens(tokens, false);
  // Las ventas anuales no cambian 100 veces de un año a otro: una columna de variación o de «% del total» sin el signo % se descarta.
  const dropOutliers = (nums) => { const max = Math.max(...nums.map(Math.abs)); return nums.filter((n) => Math.abs(n) >= max / 100); };
  // Razones y márgenes («Margen EBITDA», «Utilidad neta / ventas», «Deuda / EBITDA») no son el dato que buscamos.
  const RATIO = /\b(margen|ratio|cobertura|apalancamiento|veces|multiplo|rentabilidad|rotacion|indice|sobre|por accion|porcentaje)\b|\//;

  function splitLine(raw) {
    const line = raw.replace(/\*\*|__|`/g, '').trim();
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (!cells.length || cells.every((c) => /^[-:\s]+$/.test(c))) return null;
      return { label: cells[0], rest: cells.slice(1).join(' | '), raw: line };
    }
    if (/[;\t]/.test(line)) {
      const cells = line.split(/[;\t]/).map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) return { label: cells[0], rest: cells.slice(1).join(' | '), raw: line };
    }
    const colon = line.match(/^([^:：]*[A-Za-zÁÉÍÓÚáéíóúñÑ][^:：]*?)\s*[:：]\s*(.*)$/);
    if (colon) return { label: colon[1], rest: colon[2], raw: line };
    const m = line.match(/^(.*?)(?:\s*[:：]\s*|\s{2,}|\s(?=[$(\-]?\s?\d))(.*)$/);
    return m ? { label: m[1], rest: m[2], raw: line } : { label: line, rest: '', raw: line };
  }

  const MONTHS = /(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*[-\s/.]*'?(\d{2,4})/g;
  function yearsOf(line) {
    const text = norm(line);
    const years = [];
    let m;
    MONTHS.lastIndex = 0;
    while ((m = MONTHS.exec(text))) years.push(Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]));
    if (years.length < 2) { (text.match(/\b20\d{2}\b/g) || []).forEach((y) => years.push(Number(y))); }
    return years;
  }
  // Por línea: ¿los periodos van de más antiguo a más reciente? Cada tabla trae su encabezado; antes del primero rige el primero del documento.
  function ascendingMap(lines) {
    const heads = lines.map((l) => (/[|;\t]|\s{2,}/.test(l) ? yearsOf(l) : []));   // una frase con dos años no es un encabezado
    const first = heads.find((y) => y.length >= 2);
    let cur = first ? first[0] < first[first.length - 1] : false;
    return heads.map((y) => { if (y.length >= 2) cur = y[0] < y[y.length - 1]; return cur; });
  }

  const FIELDS = [
    { id: 'sales', multi: 4, keepRatios: true, patterns: [/^(total )?ventas( netas| anuales| totales)?\b/, /^ingresos (por )?(ventas|operacionales|ordinarios|de actividades)/, /^ventas\b/, /^ingresos\b/] },
    { id: 'ebitda', patterns: [/\bebitda\b/] },
    { id: 'finExp', abs: true, patterns: [/gastos? financieros?/, /intereses (pagados|por pagar|financieros|generados)/, /costos? financieros?/] },
    { id: 'cash', exclude: /inicio|aumento|disminucion|variacion|generado|utilizado|actividades|neto de|restringid|comprometid|gravad/, patterns: [/efectivo.*(certificados|equivalentes)/, /^efectivo\b/, /caja y bancos/, /^disponible/] },
    { id: 'employees', int: true, keepRatios: true, patterns: [/n(u|ú)mero de empleados/, /^empleados/, /^personal\b/, /^n(o|°|º)\.? de empleados/] },
    { id: 'netIncome', patterns: [/utilidad neta/, /resultado neto/, /ganancia neta/, /utilidad del ejercicio/, /perdida neta/, /resultado del (periodo|ejercicio)/] },
    { id: 'equity', patterns: [/^total patrimonio( neto| contable)?\b/, /^patrimonio( neto| contable)?\b/], exclude: /pasivo|atribuible|controlador|minoritari|participacion/ },
    { id: 'institutions', int: true, keepRatios: true, patterns: [/instituciones financieras/, /n(u|ú)mero de (bancos|instituciones)/, /cantidad de instituciones/] },
    { id: 'overdue', text: true, patterns: [/vencidos/] },
    { id: 'requested', patterns: [/deuda solicitada/, /incremento (en )?(el )?riesgo/, /monto solicitado/, /^solicitud\b/] },
    { id: 'bbDebt', patterns: [/^deuda actual/, /exposicion actual/] },
    { id: 'debt', exclude: /\bneta\b|\bneto\b/, patterns: [/deuda en el sistema financiero/, /^total (obligaciones|deuda|pasivos?) financier/, /deuda (financiera )?total/, /total deuda financiera/, /^obligaciones financieras/, /^deuda\b/] }
  ];

  function extract(markdown) {
    const rawLines = String(markdown || '').split(/\r?\n/);
    const ascAt = ascendingMap(rawLines);
    const parsed = rawLines.map(splitLine);
    const used = new Set();
    const out = {};
    const evidence = {};
    const warnings = [];

    const setValue = (id, value, ev) => { out[id] = value; evidence[id] = ev; };
    const pickAt = (nums, i) => (ascAt[i] ? nums[nums.length - 1] : nums[0]);

    FIELDS.forEach((field) => {
      for (const pattern of field.patterns) {
        for (let i = 0; i < parsed.length; i += 1) {
          const p = parsed[i];
          if (!p || used.has(i)) continue;
          const label = norm(p.label);
          if (field.multi) continue;   // las ventas se resuelven abajo, comparando todas las filas candidatas
          if (!pattern.test(label) || (field.exclude && field.exclude.test(label)) || (!field.keepRatios && RATIO.test(label))) continue;
          if (field.text) continue;   // «vencidos» se resuelve abajo: solo cuenta una respuesta explícita sobre accionistas
          let nums = cleanTokens(numberTokens(p.rest), field.int).map((x) => x.value);
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
          const v = pickAt(nums, i);
          const loss = field.id === 'netIncome' && /^perdida/.test(label) && v > 0;   // «Pérdida neta | 85.000» es -85.000
          setValue(field.id, field.int ? Math.round(v) : field.abs ? Math.abs(v) : loss ? -v : v, p.raw);
          return;
        }
      }
    });

    // Ventas: un estado de resultados trae 2 años y la tabla comparativa 4. Se elige la fila con más periodos;
    // una etiqueta exacta («Ventas netas») gana a «Ventas por región» o «Ingresos financieros».
    {
      const field = FIELDS[0];
      const EXACT = /^(total )?(ventas|ingresos)( netas| totales| anuales| ordinarios| operacionales| de actividades ordinarias)?:?$/;
      const NOT_SALES = /financier|no operacional|otros ingresos|interes|dividendo/;
      for (const exactOnly of [true, false]) {
        let best = null;
        for (const pattern of field.patterns) {
          parsed.forEach((p, i) => {
            if (!p || used.has(i)) return;
            const label = norm(p.label);
            if (!pattern.test(label) || NOT_SALES.test(label) || (exactOnly && !EXACT.test(label))) return;
            const nums = dropOutliers(dropNoteColumn(numberTokens(p.rest)).map((x) => x.value));
            if (nums.length && (!best || Math.min(nums.length, 4) > Math.min(best.nums.length, 4))) best = { i, nums, p };
          });
          if (best) break;
        }
        if (best) {
          used.add(best.i);
          const ordered = ascAt[best.i] ? [...best.nums].reverse() : best.nums;
          ['sales24', 'sales23', 'sales22', 'sales21'].forEach((k, idx) => { if (ordered[idx] !== undefined) setValue(k, ordered[idx], best.p.raw); });
          break;
        }
      }
    }

    // ¿Algún accionista reportó vencidos? Solo se acepta una respuesta explícita («Sí»/«No», sin más texto) en una fila que hable de accionistas,
    // socios o la Central de Riesgos; «Cuentas por cobrar vencidos: No» o «no se dispone de información» no responden esa pregunta.
    {
      const answers = [];
      parsed.forEach((p, i) => {
        if (!p || used.has(i)) return;
        const label = norm(p.label);
        if (!/vencidos/.test(label) || !/accionist|socio|propietari|vinculad|\bcdr\b|central de riesgos/.test(label)) return;
        const answer = norm(p.rest).replace(/[|*_.¿?!\s]+/g, ' ').trim();
        if (answer === 'si' || answer === 'no') answers.push({ i, value: answer, p });
      });
      const pick = answers.find((a) => a.value === 'si') || answers[0];   // si hay respuestas distintas, manda el riesgo
      if (pick) { used.add(pick.i); setValue('overdue', pick.value, pick.p.raw); }
    }

    // Deuda leída de un solo tramo («Obligaciones financieras a corto plazo»): se suman corto y largo plazo si ambos existen.
    if (out.debt !== undefined && /corto plazo|largo plazo|corriente/.test(norm(evidence.debt))) {
      const at = (re) => parsed.findIndex((p) => p && re.test(norm(p.label)) && !RATIO.test(norm(p.label)) && dropNoteColumn(numberTokens(p.rest)).length);
      const st = at(/^obligaciones financieras.*(corto plazo|(?<!no )corriente)/);
      const lt = at(/^obligaciones financieras.*(largo plazo|no corriente)/);
      const val = (i) => pickAt(dropNoteColumn(numberTokens(parsed[i].rest)).map((x) => x.value), i);
      if (st !== -1 && lt !== -1) setValue('debt', val(st) + val(lt), `Calculado: ${parsed[st].raw} + ${parsed[lt].raw}`);
      else warnings.push('La deuda se leyó de un solo tramo (corto o largo plazo): verifica el total.');
    }

    // Empleados dichos en una frase («la Compañía mantiene 112 empleados»).
    if (out.employees === undefined) {
      for (const line of rawLines) {
        const m = norm(line).match(/(mantiene|mantuvo|cuenta con|tiene|emplea|posee|nomina de|dotacion de)\s+(\d{1,6})\s+(empleados|trabajadores|colaboradores)(?!\s+(clave|directivos|ejecutivos|gerenciales))/);
        if (m) { setValue('employees', Number(m[2]), line.trim().slice(0, 200)); break; }
      }
    }

    // EBITDA calculado cuando el documento solo trae utilidad operativa y depreciación
    if (out.ebitda === undefined) {
      const find = (re) => parsed.findIndex((p, i) => p && !used.has(i) && re.test(norm(p.label)) && numbersIn(p.rest).length);
      const op = find(/utilidad (operativa|operacional)|resultado operacional|resultado operativo/);
      const dep = find(/depreciacion|amortizacion/);
      if (op !== -1 && dep !== -1) {
        setValue('ebitda', pickAt(numbersIn(parsed[op].rest), op) + pickAt(numbersIn(parsed[dep].rest), dep), `Calculado: ${parsed[op].raw} + ${parsed[dep].raw}`);
      }
    }

    // Escala: «en miles», «cifras en millones de USD», «(miles)», «USD miles», «US$ 000», «MUSD»…
    if (/(cifras|valores|montos|importes|expresad[oa]s?|presentad[oa]s?|\ben)\s+(\w+\s+){0,3}(miles|millones)\b|\b(miles|millones) de (usd|dolares|us\$|\$)|\((miles|millones|000)\)|\b(usd|us\$)\s*(miles|millones|000)\b|\bmusd\b/.test(norm(markdown))) {
      warnings.push('El documento parece expresado en miles o millones: verifica la escala de las cifras antes de analizar.');
    }
    if (out.sales24 !== undefined && out.sales23 === undefined) warnings.push('Solo se encontró un periodo de ventas; completa los demás manualmente.');
    return { values: out, evidence, warnings };
  }

  const api = { extract, parseNumber, numbersIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Extractor = api;
})(typeof window !== 'undefined' ? window : globalThis);
