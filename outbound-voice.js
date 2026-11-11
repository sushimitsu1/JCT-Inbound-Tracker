/**
 * Pure parser: spoken transcript → outbound shipment fields.
 * No DOM, network, or storage. Unmentioned fields stay null.
 * A field is listed in `ambiguous` when the words tried to set it
 * but the value was missing, conflicting, or not safe to guess.
 * Ambiguous fields are always null — callers keep any existing value.
 *
 * @typedef {{
 *   customer: string|null,
 *   reference: string|null,
 *   shipDate: string|null,
 *   method: 'pickup'|'delivery'|null,
 *   carrier: string|null,
 *   cartons: string|null,
 *   skus: string|null,
 *   note: string|null,
 *   tag: string|null,
 * }} OutboundFields
 */

export const OUTBOUND_VOICE_FIELDS = [
  'customer', 'reference', 'shipDate', 'method', 'carrier', 'cartons', 'skus', 'note', 'tag',
];

const ONES = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
};

const TENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};

const HUNDREDS = {
  hundred: 100, cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

const NUM_WORDS = new Set([
  ...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(HUNDREDS),
  'and', 'y', 'thousand', 'mil', 'dozen', 'docena',
]);

const ZH_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
const ZH_NUM_RE = '[零〇一二两三四五六七八九十百千万]';

const MONTHS = {
  january: 1, jan: 1, febrero: 2, february: 2, feb: 2, marzo: 3, march: 3, mar: 3,
  abril: 4, april: 4, apr: 4, mayo: 5, may: 5, junio: 6, june: 6, jun: 6,
  julio: 7, july: 7, jul: 7, agosto: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, september: 9, sep: 9, sept: 9,
  octubre: 10, october: 10, oct: 10, noviembre: 11, november: 11, nov: 11,
  diciembre: 12, december: 12, dec: 12, enero: 1,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const CARTON_UNITS = new Set(['carton', 'cartons', 'caja', 'cajas', 'carton', 'cartones', '纸箱', '盒子', '箱']);
const PALLET_UNITS = new Set(['pallet', 'pallets', 'plt', 'plts', 'skid', 'skids', 'tarima', 'tarimas', 'paleta', 'paletas', 'palet', 'palets', '托盘', '栈板']);

const CARRIERS = [
  ['old dominion freight', 'Old Dominion'],
  ['old dominion', 'Old Dominion'],
  ['fed ex', 'FedEx'],
  ['fedex', 'FedEx'],
  ['ups freight', 'UPS'],
  ['usps', 'USPS'],
  ['ups', 'UPS'],
  ['dhl', 'DHL'],
  ['xpo logistics', 'XPO'],
  ['xpo', 'XPO'],
  ['estes', 'Estes'],
  ['saia', 'Saia'],
  ['abf freight', 'ABF'],
  ['abf', 'ABF'],
  ['schneider', 'Schneider'],
  ['j b hunt', 'J.B. Hunt'],
  ['jb hunt', 'J.B. Hunt'],
  ['werner', 'Werner'],
  ['swift', 'Swift'],
  ['t force', 'TForce'],
  ['tforce', 'TForce'],
  ['aaa cooper', 'AAA Cooper'],
  ['central transport', 'Central Transport'],
  ['southeastern freight', 'Southeastern'],
  ['averitt', 'Averitt'],
  ['dayton freight', 'Dayton Freight'],
  ['pitt ohio', 'Pitt Ohio'],
  ['oak harbor', 'Oak Harbor'],
  ['maersk', 'Maersk'],
  ['ontrac', 'OnTrac'],
  ['lasership', 'LaserShip'],
  ['r l carriers', 'R+L Carriers'],
  ['rl carriers', 'R+L Carriers'],
  ['yrc', 'YRC'],
].sort((a, b) => b[0].length - a[0].length);

const AMBIGUOUS_NAME = /^(?:tbd|tba|unknown|unsure|n\/?a|idk|not sure|no se|nose|不知道|不确定|未定|待定)$/i;

const KEYWORDS = [
  'purchase order', 'order number', 'bill of lading', 'pick up', 'will call', 'company delivery',
  'delivery date', 'ship date', 'shipping date', 'fecha de entrega', 'fecha de envio', 'fecha de embarque',
  'tomorrow', 'today', 'manana', 'hoy', 'pallets', 'pallet', 'tarimas', 'tarima', 'paletas', 'paleta',
  'cartons', 'carton', 'cajas', 'caja', 'cartones', 'skus', 'sku', 'codigos', 'codigo',
  'carrier', 'transportista', 'customer', 'cliente', 'pickup', 'delivery', 'deliver',   'recoger', 'recogida',
  'recoleccion', 'entrega', 'reparto', 'bol', 'tag', 'guia', 'pedido', 'orden', 'order', 'po', 'note', 'nota',
  'notes', 'notas', 'next week', 'proxima semana',
  '订单号', '采购单号', '采购单', '订单', '提单号', '提单', '标签', '承运商', '快递', '卡车',
  '客户', '托盘', '栈板', '纸箱', '盒子', '今天', '明天', '今日', '明日', '自提', '提货', '送货', '配送',
  '备注', '注释', '箱', '下周',
].map(fold).sort((a, b) => b.length - a.length);

/**
 * @param {string} transcript
 * @param {{ customers?: string[], now?: Date, aliases?: Record<string, string> }} [options]
 * aliases maps a nickname to the official customer name. Nothing is stored; pass a map when you have one.
 */
export function parseOutboundTranscript(transcript, options = {}) {
  const now = options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
  const customers = dedupeCustomers(options.customers || []);
  const aliases = options.aliases && typeof options.aliases === 'object' ? options.aliases : {};
  const fields = blankFields();
  const ambiguous = new Set();

  const original = String(transcript ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  if (!original) return pack(fields, ambiguous);

  let work = original;
  const noted = takeNote(work);
  work = noted.text;
  if (noted.ambiguous) ambiguous.add('note');
  else if (noted.value) fields.note = noted.value;

  const customerSpan = takeExplicitCustomer(work);
  if (customerSpan) work = customerSpan.text;

  // Drop accents without turning commas into spaces, so "guía" and "mañana"
  // match while "30 cajas, 4 tarimas" stays two quantities.
  work = deaccent(work);
  work = stripDateLabels(work);

  const dated = takeDates(work, now);
  work = dated.text;
  if (dated.ambiguous) ambiguous.add('shipDate');
  else if (dated.value) fields.shipDate = dated.value;

  const qty = takeQuantities(work);
  work = qty.text;
  if (qty.ambiguous) ambiguous.add('cartons');
  else if (qty.value) fields.cartons = qty.value;

  const sku = takeSkus(work);
  work = sku.text;
  if (sku.ambiguous) ambiguous.add('skus');
  else if (sku.value) fields.skus = sku.value;

  const ref = takeLabeledNumber(work, REF_LABELS);
  work = ref.text;
  if (ref.ambiguous) ambiguous.add('reference');
  else if (ref.value) fields.reference = ref.value;

  const tag = takeLabeledNumber(work, TAG_LABELS);
  work = tag.text;
  if (tag.ambiguous) ambiguous.add('tag');
  else if (tag.value) fields.tag = tag.value;

  const carrier = takeCarrier(work);
  work = carrier.text;
  if (carrier.ambiguous) ambiguous.add('carrier');
  else if (carrier.value) fields.carrier = carrier.value;

  const method = takeMethod(work);
  work = method.text;
  if (method.ambiguous) ambiguous.add('method');
  else if (method.value) fields.method = method.value;

  const customer = resolveCustomer(customerSpan?.span || '', work, customers, aliases);
  const review = new Set();
  if (customer.ambiguous) ambiguous.add('customer');
  else if (customer.value) {
    fields.customer = customer.value;
    if (customer.review) review.add('customer');
  }

  if (!fields.reference && !ambiguous.has('reference') && (fields.customer || customer.ambiguous || customer.review || customerSpan)) {
    const bare = takeBareReference(work);
    if (bare.ambiguous) ambiguous.add('reference');
    else if (bare.value) fields.reference = bare.value;
  }

  return pack(fields, ambiguous, review, { customer: customer.suggestions || [] });
}

function blankFields() {
  return {
    customer: null, reference: null, shipDate: null, method: null,
    carrier: null, cartons: null, skus: null, note: null, tag: null,
  };
}

function pack(fields, ambiguous, review = new Set(), suggestions = { customer: [] }) {
  for (const key of ambiguous) fields[key] = null;
  return {
    fields,
    filled: OUTBOUND_VOICE_FIELDS.filter(k => fields[k] != null && fields[k] !== ''),
    ambiguous: OUTBOUND_VOICE_FIELDS.filter(k => ambiguous.has(k)),
    review: OUTBOUND_VOICE_FIELDS.filter(k => review.has(k) && !ambiguous.has(k)),
    suggestions,
  };
}

export function voiceFillSummary(parsed) {
  const filled = (parsed && parsed.filled) || [];
  const checks = new Set([...(parsed && parsed.ambiguous || []), ...(parsed && parsed.review || [])]);
  const n = filled.length;
  const c = checks.size;
  const fieldsWord = `${n} field${n === 1 ? '' : 's'}`;
  if (!c) return `Filled ${fieldsWord}`;
  return `Filled ${fieldsWord}, ${c} ${c === 1 ? 'needs' : 'need'} a check`;
}

/** Append the raw transcript without removing a note the worker already typed. */
export function appendVoiceNote(existing, transcript) {
  const said = String(transcript ?? '').replace(/\s+/g, ' ').trim();
  const prior = String(existing ?? '').replace(/\s+$/g, '');
  if (!said) return prior;
  const line = `Voice: ${said}`;
  if (!prior.trim()) return line;
  return `${prior}\n${line}`;
}

/** Summary after a capture. The voice line in Note is not counted as a parsed field. */
export function voiceCaptureSummary(parsed) {
  const filled = ((parsed && parsed.filled) || []).filter(key => key !== 'note');
  const review = (parsed && parsed.review) || [];
  if (!filled.length && !review.length) return "Couldn't pick out fields, check the note";
  return voiceFillSummary({
    filled,
    ambiguous: (parsed && parsed.ambiguous) || [],
    review,
  });
}

export function fold(s) {
  return deaccent(String(s ?? ''))
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,!?;:()[\]{}"“”'‘’`，。！？、；：#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deaccent(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
}

function dedupeCustomers(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const f = fold(name);
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(name);
  }
  return out;
}

function phraseIn(hay, phrase) {
  if (!phrase) return false;
  return ` ${hay} `.includes(` ${phrase} `);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startsWithKeyword(original) {
  const f = fold(original);
  if (!f) return false;
  for (const k of KEYWORDS) {
    if (f === k || f.startsWith(`${k} `)) return true;
    // Chinese keywords have no word boundary; a following CJK char can continue a different word.
    if (/[^\x00-\x7f]/.test(k) && f.startsWith(k)) {
      const next = f.slice(k.length);
      if (!next || !/[a-z0-9]/.test(next[0])) return true;
    }
  }
  return false;
}

function readNameTokens(rest, maxWords = 5) {
  const words = [];
  let left = rest;
  while (left && words.length < maxWords) {
    left = left.replace(/^\s+/, '');
    if (!left || /^[,.，。;；]/.test(left)) break;
    if (looksLikeQuantity(left)) break;
    if (startsWithKeyword(left)) break;
    const m = left.match(/^[\u3400-\u9fff]|[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/);
    if (!m) break;
    words.push(m[0]);
    left = left.slice(m[0].length);
  }
  let value = '';
  for (const w of words) {
    const cjk = /[\u3400-\u9fff]/.test(w);
    const prevCjk = /[\u3400-\u9fff]$/.test(value);
    if (value && !(cjk && prevCjk)) value += ' ';
    value += w;
  }
  return value.trim();
}

function takeExplicitCustomer(text) {
  const re = /(?:\bcustomer\b|\bcliente\b|客户)\s*(?:is\b|es\b|是)?\s*[:：]?\s*/i;
  const m = re.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length);
  const span = readNameTokens(after);
  const consumedLen = span
    ? after.indexOf(span) + span.length
    : 0;
  // indexOf can fail if span was joined with spaces that differ — measure by walking tokens again.
  let end = 0;
  if (span) {
    let left = after;
    let built = '';
    const parts = span.split(' ');
    for (const part of parts) {
      const idx = left.indexOf(part);
      if (idx < 0) break;
      built += left.slice(0, idx + part.length);
      left = left.slice(idx + part.length);
      end = built.length;
    }
  }
  const textOut = (text.slice(0, m.index) + ' ' + after.slice(end)).replace(/\s+/g, ' ').trim();
  return { span, text: textOut };
}

function isTokenBoundary(text, i) {
  if (i <= 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  if (/[\s,，.。;；]/.test(prev)) return true;
  if (/[\u3400-\u9fff]/.test(cur)) return true;
  if (/[\u3400-\u9fff]/.test(prev) && /[A-Za-z0-9]/.test(cur)) return true;
  return false;
}

/** Where the note ends so the next labeled field, including its number, stays in the text. */
function noteCutIndex(probe) {
  for (let i = 0; i < probe.length; i++) {
    if (!isTokenBoundary(probe, i)) continue;
    const raw = probe.slice(i);
    const slice = raw.replace(/^[\s,，.。;；]+/, '');
    if (!slice) break;
    const at = i + (raw.length - slice.length);
    if (keywordAt(slice) && !isNoteKeyword(slice)) return at;
    const zhLead = slice.match(new RegExp(`^(?:${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*个?(?=\\s*(?:skus?|SKU|库存单位|纸箱|盒子|托盘|栈板|箱))`, 'i'));
    if (zhLead) return at;
    const spoken = slice.match(/^([A-Za-z]+(?:\s+(?:and|y)\s+[A-Za-z]+|\s+[A-Za-z]+){0,5})\s+(?=\S)/i);
    if (spoken && fold(spoken[1]) === leadingNumberTokens(spoken[1]).join(' ')) {
      const afterNum = slice.slice(spoken[0].length);
      if (keywordAt(afterNum) && !isNoteKeyword(afterNum)) return at;
    }
  }
  return probe.length;
}

function keywordAt(slice) {
  return startsWithKeyword(slice);
}

function isNoteKeyword(slice) {
  const f = fold(slice);
  return f.startsWith('note') || f.startsWith('nota') || slice.startsWith('备注') || slice.startsWith('注释');
}

function takeNote(text) {
  const re = /备注|注释|\bnotes?\b|\bnotas?\b/gi;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return { value: null, ambiguous: false, text };
  if (matches.length > 1) {
    let stripped = text;
    for (const m of matches) stripped = stripOnce(stripped, m[0]);
    return { value: null, ambiguous: true, text: stripped };
  }
  const m = matches[0];
  let rest = text.slice(m.index + m[0].length).replace(/^[\s:：,，\-]+/, '').replace(/^(?:is|es|是)\s+/i, '');
  const cutAt = noteCutIndex(rest);
  const rawNote = rest.slice(0, cutAt).replace(/[\s,，.。;；:：\-]+$/g, '').trim();
  const before = text.slice(0, m.index);
  const after = rest.slice(cutAt);
  const textOut = `${before} ${after}`.replace(/\s+/g, ' ').trim();
  if (!rawNote) return { value: null, ambiguous: true, text: textOut };
  return { value: rawNote, ambiguous: false, text: textOut };
}

function stripOnce(text, token) {
  const i = text.toLowerCase().indexOf(token.toLowerCase());
  if (i < 0) return text;
  return `${text.slice(0, i)} ${text.slice(i + token.length)}`.replace(/\s+/g, ' ').trim();
}

function stripDateLabels(text) {
  return text
    .replace(/\bdelivery date\b/gi, ' ')
    .replace(/\bshipping date\b/gi, ' ')
    .replace(/\bship date\b/gi, ' ')
    .replace(/\bfecha de entrega\b/gi, ' ')
    .replace(/\bfecha de env[ií]o\b/gi, ' ')
    .replace(/\bfecha de embarque\b/gi, ' ')
    .replace(/送货日期|发货日期|出货日期/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isoFromParts(year, month, day) {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayIso(now) {
  return isoFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function addDaysIso(now, days) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + days);
  return isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function blankRanges(text, ranges) {
  const chars = [...text];
  for (const [start, end] of ranges) {
    for (let i = start; i < end && i < chars.length; i++) chars[i] = ' ';
  }
  return chars.join('').replace(/今天|今日|明天|明日/g, ' ')
    .replace(/20\d{2}年\d{1,2}月\d{1,2}日/g, ' ')
    .replace(/\d{1,2}月\d{1,2}日/g, ' ')
    .replace(new RegExp(`${ZH_NUM_RE}{1,3}月${ZH_NUM_RE}{1,3}日`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function takeDates(text, now) {
  /** @type {string[]} */
  const found = [];
  let bad = false;
  const ranges = [];

  const rel = [
    [/\btoday\b/gi, 0], [/\btomorrow\b/gi, 1], [/\bhoy\b/gi, 0], [/\bmanana\b/gi, 1],
  ];
  for (const [re, days] of rel) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      found.push(addDaysIso(now, days));
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  for (const [token, days] of [['今天', 0], ['今日', 0], ['明天', 1], ['明日', 1]]) {
    let from = 0;
    while (from < text.length) {
      const i = text.indexOf(token, from);
      if (i < 0) break;
      found.push(addDaysIso(now, days));
      ranges.push([i, i + token.length]);
      from = i + token.length;
    }
  }

  const consider = (year, month, day, index, len, explicitYear) => {
    const iso = isoFromParts(explicitYear ? year : now.getFullYear(), month, day);
    if (!iso) { bad = true; if (index != null) ranges.push([index, index + len]); return; }
    if (!explicitYear && iso < todayIso(now)) { bad = true; if (index != null) ranges.push([index, index + len]); return; }
    found.push(iso);
    if (index != null) ranges.push([index, index + len]);
  };

  let m;
  const isoRe = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = isoRe.exec(text))) {
    consider(+m[1], +m[2], +m[3], m.index, m[0].length, true);
  }
  const slashRe = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
  while ((m = slashRe.exec(text))) {
    let year = +m[3];
    if (year < 100) year += 2000;
    consider(year, +m[1], +m[2], m.index, m[0].length, true);
  }
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+)?(${MONTH_ALT})(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`, 'gi');
  while ((m = dayMonth.exec(text))) {
    consider(m[3] ? +m[3] : now.getFullYear(), MONTHS[m[2].toLowerCase()], +m[1], m.index, m[0].length, !!m[3]);
  }
  const monthDay = new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'gi');
  while ((m = monthDay.exec(text))) {
    consider(m[3] ? +m[3] : now.getFullYear(), MONTHS[m[1].toLowerCase()], +m[2], m.index, m[0].length, !!m[3]);
  }
  const zhRe = /(20\d{2})年(\d{1,2})月(\d{1,2})日|(\d{1,2})月(\d{1,2})日/g;
  while ((m = zhRe.exec(text))) {
    if (m[1]) consider(+m[1], +m[2], +m[3], m.index, m[0].length, true);
    else consider(now.getFullYear(), +m[4], +m[5], m.index, m[0].length, false);
  }
  const zhMonthWord = new RegExp(`(${ZH_NUM_RE}{1,3})月(${ZH_NUM_RE}{1,3})日`, 'g');
  while ((m = zhMonthWord.exec(text))) {
    const month = parseZhNumber(m[1]);
    const day = parseZhNumber(m[2]);
    if (month == null || day == null) { bad = true; ranges.push([m.index, m.index + m[0].length]); continue; }
    consider(now.getFullYear(), month, day, m.index, m[0].length, false);
  }

  const vague = /\b(?:next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo|proxima semana)\b|下周|周[一二三四五六日天]|星期[一二三四五六日天]/gi;
  const hasVague = vague.test(text);
  vague.lastIndex = 0;
  let vm;
  while ((vm = vague.exec(text))) ranges.push([vm.index, vm.index + vm[0].length]);

  const out = blankRanges(text, ranges);
  const unique = [...new Set(found)];
  if (bad || unique.length > 1) return { value: null, ambiguous: true, text: out };
  if (unique.length === 1) return { value: unique[0], ambiguous: false, text: out };
  if (hasVague) return { value: null, ambiguous: true, text: out };
  return { value: null, ambiguous: false, text: out };
}

function parseZhNumber(s) {
  if (!s || ![...s].every(ch => ch in ZH_DIGIT || ch in ZH_UNIT)) return null;
  let total = 0;
  let section = 0;
  let num = 0;
  let seen = false;
  for (const ch of s) {
    if (ch in ZH_DIGIT) {
      num = ZH_DIGIT[ch];
      seen = true;
    } else {
      const u = ZH_UNIT[ch];
      seen = true;
      if (u === 10000) {
        section = (section + num) * u;
        total += section;
        section = 0;
        num = 0;
      } else {
        section += (num || 1) * u;
        num = 0;
      }
    }
  }
  if (!seen) return null;
  return total + section + num;
}

function parseNumberTokens(tokens) {
  if (!tokens.length) return null;
  if (tokens.length === 1 && /^\d+$/.test(tokens[0])) {
    const n = String(parseInt(tokens[0], 10));
    return { kind: 'cardinal', text: n, cardinal: Number(n) };
  }
  if (tokens.some(t => /^\d+$/.test(t))) return null;
  let total = 0;
  let current = 0;
  let saw = false;
  let single = true;
  let digits = '';
  for (const token of tokens) {
    if (token === 'and' || token === 'y') continue;
    if (token === 'dozen' || token === 'docena') {
      single = false;
      current += 12;
      saw = true;
      continue;
    }
    if (token === 'thousand' || token === 'mil') {
      single = false;
      current = (current || 1) * 1000;
      total += current;
      current = 0;
      saw = true;
      continue;
    }
    if (token in HUNDREDS) {
      single = false;
      const h = HUNDREDS[token];
      if (token === 'hundred' || token === 'cien' || token === 'ciento') current = (current || 1) * 100;
      else current += h;
      saw = true;
      continue;
    }
    if (token in TENS) {
      const v = TENS[token];
      if (v >= 10) single = false;
      else digits += String(v);
      current += v;
      saw = true;
      continue;
    }
    if (token in ONES) {
      const v = ONES[token];
      digits += String(v);
      current += v;
      saw = true;
      continue;
    }
    return null;
  }
  if (!saw) return null;
  const cardinal = total + current;
  if (single && digits.length >= 2) return { kind: 'digits', text: digits, cardinal };
  return { kind: 'cardinal', text: String(cardinal), cardinal };
}

function trailingNumberTokens(before) {
  const tokens = fold(before).split(' ').filter(Boolean);
  const picked = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (NUM_WORDS.has(t) || /^\d+$/.test(t)) picked.push(t);
    else break;
  }
  picked.reverse();
  while (picked[0] === 'and' || picked[0] === 'y') picked.shift();
  return picked;
}

function leadingNumberTokens(after) {
  const tokens = fold(after).split(' ').filter(Boolean);
  const picked = [];
  for (const t of tokens) {
    if (NUM_WORDS.has(t) || /^\d+$/.test(t)) picked.push(t);
    else if ((t === 'and' || t === 'y') && picked.length) picked.push(t);
    else break;
  }
  while (picked[0] === 'and' || picked[0] === 'y') picked.shift();
  while (picked.length && (picked[picked.length - 1] === 'and' || picked[picked.length - 1] === 'y')) picked.pop();
  return picked;
}

function unitKind(unit) {
  const u = fold(unit);
  if (CARTON_UNITS.has(u)) return 'carton';
  if (PALLET_UNITS.has(u)) return 'pallet';
  return null;
}

function formatQty(carton, pallet) {
  const parts = [];
  if (carton != null) parts.push(`${carton} ${carton === 1 ? 'carton' : 'cartons'}`);
  if (pallet != null) parts.push(`${pallet} ${pallet === 1 ? 'pallet' : 'pallets'}`);
  return parts.join(', ');
}

function looksLikeQuantity(text) {
  const phrase = numberPhraseSource();
  const latin = new RegExp(`^(?:${phrase})\\s+(?:cartons?|cajas?|cartones|pallets?|plts?|skids?|tarimas?|paletas?|palets?|skus?|codigos?)\\b`, 'i');
  if (latin.test(text)) return true;
  const zh = new RegExp(`^(?:${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*个?\\s*(?:纸箱|盒子|托盘|栈板|箱|skus?|库存单位)`, 'i');
  return zh.test(text);
}

function numberPhraseSource() {
  // A quantity is one spoken cardinal ("thirty", "one hundred forty five",
  // "treinta y dos") OR one digit group. A second digit group is a separate
  // id ("PO 48213, 20 tarimas") and must not be swallowed with the quantity.
  const words = [...NUM_WORDS].filter(w => w !== 'and' && w !== 'y').sort((a, b) => b.length - a.length).map(escapeRe);
  const word = words.join('|');
  const spoken = `(?:${word})(?:\\s+(?:and|y)\\s+(?:${word})|\\s+(?:${word})){0,5}`;
  return `(?:${spoken}|\\d{1,6})`;
}

function takeQuantities(text) {
  const phrase = numberPhraseSource();
  const latinUnitAlt = 'cartons?|cajas?|cartones|pallets?|plts?|skids?|tarimas?|paletas?|palets?|palet';
  const zhUnitAlt = '纸箱|盒子|托盘|栈板|箱';
  let src = text;
  let ambiguous = false;
  const values = { carton: new Set(), pallet: new Set() };

  const mark = (kind, parsed) => {
    if (!kind) return;
    if (!parsed || parsed.kind === 'digits') { ambiguous = true; return; }
    values[kind].add(parsed.cardinal);
  };
  const parseQtyToken = (num) => {
    if (/^\d+$/.test(num)) {
      const n = parseInt(num, 10);
      return { kind: 'cardinal', text: String(n), cardinal: n };
    }
    if (new RegExp(`^${ZH_NUM_RE}+$`).test(num)) {
      const n = parseZhNumber(num);
      return n == null ? null : { kind: 'cardinal', text: String(n), cardinal: n };
    }
    return parseNumberTokens(leadingNumberTokens(num));
  };

  const zhOr = new RegExp(`(${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*(?:或者|或)\\s*(${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*个?\\s*(${zhUnitAlt})`, 'g');
  src = src.replace(zhOr, () => { ambiguous = true; return ' '; });
  const orLatin = new RegExp(`\\b(?:${phrase})\\s+(?:or|\\bo\\b)\\s+(?:${phrase})\\s+(?:${latinUnitAlt})\\b`, 'gi');
  src = src.replace(orLatin, (full) => { ambiguous = true; return ' '; });
  const approx = new RegExp(`\\b(?:about|around|roughly|approximately|aproximadamente|unos|unas|como)\\s+(?:${phrase})\\s+(?:${latinUnitAlt})\\b|(?:大概|大约)\\s*(?:${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*个?\\s*(?:${zhUnitAlt})|(?:${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*个?\\s*(?:${zhUnitAlt})\\s*左右`, 'gi');
  src = src.replace(approx, () => { ambiguous = true; return ' '; });

  const zhQty = new RegExp(`(${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*个?\\s*(${zhUnitAlt})`, 'g');
  src = src.replace(zhQty, (full, num, unit) => {
    mark(unitKind(unit), parseQtyToken(num));
    return ' ';
  });
  const latinQty = new RegExp(`\\b(${phrase})\\s+(${latinUnitAlt})\\b`, 'gi');
  src = src.replace(latinQty, (full, numPart, unit) => {
    mark(unitKind(unit), parseQtyToken(numPart));
    return ' ';
  });
  const unitFirst = new RegExp(`\\b(${latinUnitAlt})\\s+(?:of\\s+)?(${phrase})\\b`, 'gi');
  src = src.replace(unitFirst, (full, unit, numPart) => {
    mark(unitKind(unit), parseQtyToken(numPart));
    return ' ';
  });

  if (new RegExp(`\\b(?:${latinUnitAlt})\\b|${zhUnitAlt}`, 'i').test(src)) ambiguous = true;
  src = src.replace(/\s+/g, ' ').trim();
  if (ambiguous) return { value: null, ambiguous: true, text: src };
  if (values.carton.size > 1 || values.pallet.size > 1) return { value: null, ambiguous: true, text: src };
  const carton = values.carton.size ? [...values.carton][0] : null;
  const pallet = values.pallet.size ? [...values.pallet][0] : null;
  if (carton == null && pallet == null) return { value: null, ambiguous: false, text: src };
  return { value: formatQty(carton, pallet), ambiguous: false, text: src };
}

function takeSkus(text) {
  const phrase = numberPhraseSource();
  const hits = [];
  let src = text;
  const mentioned = /(?:\bskus?\b|\bcodigos?\b|库存单位)/i.test(src);
  const patterns = [
    new RegExp(`(${ZH_NUM_RE}{1,12}|\\d{1,6})\\s*个?\\s*(?:skus?|库存单位)`, 'gi'),
    new RegExp(`(?:\\bskus?\\b|\\bcodigos?\\b|库存单位)\\s*(?:count|number|no|num|is|es|是)?\\s*[:：]?\\s*(${ZH_NUM_RE}{1,12}|\\d{1,6})`, 'gi'),
    new RegExp(`\\b(${phrase})\\s+(?:skus?|codigos?)\\b`, 'gi'),
    new RegExp(`(?:\\bskus?\\b|\\bcodigos?\\b)\\s*(?:count|number|no|num|is|es|是)?\\s*[:：]?\\s*(${phrase})\\b`, 'gi'),
  ];

  const consumeNumber = (raw) => {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10));
    if (new RegExp(`^${ZH_NUM_RE}+$`).test(trimmed)) {
      const n = parseZhNumber(trimmed);
      return n == null ? null : String(n);
    }
    const tokens = leadingNumberTokens(trimmed);
    if (!tokens.length || tokens.join(' ') !== fold(trimmed)) return null;
    const parsed = parseNumberTokens(tokens);
    if (!parsed || parsed.kind === 'digits') return null;
    return parsed.text;
  };

  let guard = 0;
  let changed = true;
  while (changed && guard < 8) {
    changed = false;
    guard++;
    for (const re of patterns) {
      re.lastIndex = 0;
      const m = re.exec(src);
      if (!m) continue;
      const n = consumeNumber(m[1]);
      hits.push(n);
      src = `${src.slice(0, m.index)} ${src.slice(m.index + m[0].length)}`;
      changed = true;
      break;
    }
  }

  const good = hits.filter(h => h != null);
  const bad = hits.some(h => h == null);
  const unique = [...new Set(good)];
  if (bad || unique.length > 1) return { value: null, ambiguous: true, text: src };
  if (unique.length === 1) return { value: unique[0], ambiguous: false, text: src };
  if (mentioned) return { value: null, ambiguous: true, text: src };
  return { value: null, ambiguous: false, text: src };
}

const REF_LABELS = [
  { re: /\bpurchase order\b|\bp\s+o\b|\bpo\b/gi, prefix: 'PO' },
  { re: /\border number\b|\border no\b|\border num\b/gi, prefix: null },
  // "order 48213" counts. Bare "order" inside "in order to" has no number, so it is weak and ignored.
  { re: /\border\b/gi, prefix: null, weak: true },
  { re: /\borden de compra\b|\bnumero de orden\b|\bnumero de pedido\b/gi, prefix: null },
  { re: /\bpedido\b|\borden\b/gi, prefix: null },
  { re: /采购单号|订单号|采购单|订单/g, prefix: null },
];

const TAG_LABELS = [
  { re: /\bbill of lading\b|\bb\s+o\s+l\b|\bbol\b/gi, prefix: 'BOL' },
  { re: /\bconocimiento de embarque\b|\bguia\b/gi, prefix: 'BOL' },
  { re: /提单号|提单/g, prefix: 'BOL' },
  { re: /\btag number\b|\btag no\b|\btag\b|\betiqueta\b/gi, prefix: null },
  { re: /标签号|标签/g, prefix: null },
];

function readLabeledValue(after) {
  let rest = after.replace(/^[\s:：#\-]+/, '').replace(/^(?:number|no|num|is|es|是|of|the|el|la)\b\s*/i, '');
  rest = rest.replace(/^(?:number|no|num)\b\s*/i, '');
  if (!rest) return { value: null, length: 0, missing: true };
  if (startsWithKeyword(rest) && !/^\d/.test(fold(rest))) {
    // A following field starts immediately — label had no value.
    // Exception: value itself can start with digits before a unit; handled below.
  }
  const zh = rest.match(new RegExp(`^(${ZH_NUM_RE}{2,})`));
  if (zh && parseZhNumber(zh[1]) != null && zh[1].length >= 2) {
    const next = rest.slice(zh[1].length);
    if (next && /^个?\s*(纸箱|盒子|托盘|栈板|箱)/.test(next)) return { value: null, length: 0, missing: true };
    return { value: String(parseZhNumber(zh[1])), length: consumedLength(after, zh[1]), missing: false };
  }
  const code = rest.match(/^([A-Za-z]*\d[A-Za-z0-9-]*)/);
  if (code) {
    const token = code[1];
    const next = rest.slice(token.length);
    if (/^\s*(?:skus?|codigos?|cartons?|cajas?|pallets?|tarimas?|paletas?)\b/i.test(next)) {
      return { value: null, length: 0, missing: true };
    }
    return { value: token, length: consumedLength(after, token), missing: false };
  }
  const tokens = leadingNumberTokens(rest);
  if (tokens.length) {
    const parsed = parseNumberTokens(tokens);
    const phrase = tokens.join(' ');
    const nextFold = fold(rest).slice(phrase.length).trim();
    if (nextFold && /^(?:skus?|codigos?|cartons?|cajas?|cartones|pallets?|plts?|tarimas?|paletas?|palets?|箱|托盘)/.test(nextFold)) {
      return { value: null, length: 0, missing: true };
    }
    if (parsed) return { value: parsed.text, length: consumedLength(after, phrase), missing: false };
  }
  return { value: null, length: 0, missing: true };
}

function consumedLength(after, phraseFold) {
  // Walk the original tail until its fold equals the phrase or starts with it and a boundary.
  let acc = '';
  const target = fold(phraseFold);
  for (let i = 0; i < after.length; i++) {
    acc += after[i];
    const f = fold(acc);
    if (f === target) return acc.length;
    if (f.length > target.length + 1) break;
  }
  return fold(after).startsWith(target) ? after.length : phraseFold.length;
}

function normalizeCode(prefix, raw) {
  let v = String(raw).toUpperCase().replace(/\s+/g, '');
  v = v.replace(/^(?:PO|BOL)-?/, '');
  v = v.replace(/^-+/, '');
  if (!v) return null;
  if (prefix) return `${prefix}-${v}`;
  return v;
}

function takeLabeledNumber(text, labels) {
  const found = [];
  let missing = false;
  let src = text;
  const ranges = [];
  for (const label of labels) {
    const re = new RegExp(label.re.source, label.re.flags);
    let m;
    while ((m = re.exec(src))) {
      const after = src.slice(m.index + m[0].length);
      const read = readLabeledValue(after);
      const end = m.index + m[0].length + (read.length || 0);
      if (read.missing || !read.value) {
        if (!label.weak) {
          ranges.push([m.index, Math.max(end, m.index + m[0].length)]);
          missing = true;
        }
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      } else {
        ranges.push([m.index, Math.max(end, m.index + m[0].length)]);
        const norm = normalizeCode(label.prefix, read.value);
        if (norm) found.push(norm);
        else missing = true;
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  // Overlapping labels (e.g. "order" inside a longer match) — drop ranges contained in a longer one.
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = src;
  const used = [];
  const sorted = [...ranges].sort((a, b) => b[0] - a[0]);
  for (const [a, b] of sorted) {
    if (used.some(([c, d]) => a >= c && b <= d)) continue;
    used.push([a, b]);
    out = `${out.slice(0, a)} ${out.slice(b)}`;
  }
  out = out.replace(/\s+/g, ' ').trim();
  const unique = [...new Set(found)];
  if (unique.length > 1) return { value: null, ambiguous: true, text: out };
  if (unique.length === 1 && missing) return { value: null, ambiguous: true, text: out };
  if (unique.length === 1) return { value: unique[0], ambiguous: false, text: out };
  if (missing || ranges.length) return { value: null, ambiguous: true, text: out };
  return { value: null, ambiguous: false, text: out };
}

function takeBareReference(text) {
  const nums = [...String(text || '').matchAll(/\b(\d{5,})\b/g)].map(m => m[1]);
  const unique = [...new Set(nums)];
  if (unique.length > 1) return { value: null, ambiguous: true };
  if (unique.length === 1) return { value: unique[0], ambiguous: false };
  return { value: null, ambiguous: false };
}

function stripPhrase(text, phrase) {
  const words = String(phrase || '').trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return text;
  const re = new RegExp(`(^|[^A-Za-z0-9])(?:${words.join('\\s+')})(?=$|[^A-Za-z0-9])`, 'gi');
  return text.replace(re, '$1 ');
}

function takeCarrier(text) {
  const folded = fold(text);
  const hits = [];
  const foundPhrases = [];
  let src = ` ${folded} `;
  for (const [phrase, display] of CARRIERS) {
    const token = ` ${phrase} `;
    if (src.includes(token)) {
      hits.push(display);
      foundPhrases.push(phrase);
      src = src.split(token).join(' ');
    }
  }
  const unique = [...new Set(hits)];

  const labelRe = /(?:\bcarrier\b|\btransportista\b|承运商|快递|卡车)/i;
  const labelMatch = labelRe.exec(text);
  let labeled = null;
  let labelAmbiguous = false;
  let out = text;
  if (labelMatch) {
    const after = text.slice(labelMatch.index + labelMatch[0].length);
    const cleaned = after.replace(/^[\s:：]+/, '').replace(/^(?:is|es|是)\s+/i, '');
    const name = readNameTokens(cleaned, 4);
    const f = fold(name);
    const methodNext = /^(?:pickup|pick\s*up|delivery|deliver|will\s*call|recoger|recogida|entrega|自提|送货|配送)\b/i.test(cleaned);
    if (!name) {
      // "carrier pickup" is the method. A bare "carrier" with no name is unclear.
      if (!methodNext && unique.length === 0) labelAmbiguous = true;
    } else if (methodNext && /^(?:pickup|pick up|delivery|deliver|will call|recoger|recogida|entrega|自提|送货|配送)$/.test(f)) {
      labeled = null;
    } else if (AMBIGUOUS_NAME.test(f) || /\bor\b|\bo\b|或者|或/.test(` ${f} `) || /或者|或/.test(name)) {
      labelAmbiguous = true;
    } else {
      const known = CARRIERS.find(([phrase]) => phrase === f);
      labeled = known ? known[1] : name;
    }
    out = `${text.slice(0, labelMatch.index)} ${after}`.replace(/\s+/g, ' ').trim();
    if (name) out = out.replace(name, ' ');
  }

  let cleaned = out;
  for (const phrase of foundPhrases) cleaned = stripPhrase(cleaned, phrase);
  if (labeled) cleaned = stripPhrase(cleaned, labeled);
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  const done = (value, ambiguous) => ({ value, ambiguous, text: cleaned });
  if (labelAmbiguous) return done(null, true);
  if (unique.length > 1) return done(null, true);
  if (labeled && unique.length === 1 && labeled !== unique[0]) return done(null, true);
  if (labeled) return done(labeled, false);
  if (unique.length === 1) return done(unique[0], false);
  if (labelMatch && !labeled) return done(null, false);
  return done(null, false);
}

function takeMethod(text) {
  const f = fold(text);
  const pickup = /\bpick\s*-?\s*up\b|\bwill\s*-?\s*call\b|\brecoger\b|\brecogida\b|\brecojo\b|\brecoge\b|\brecoleccion\b|\ba recoger\b/.test(f)
    || /自提|提货|上门提/.test(text);
  const delivery = /\bdeliver(?:y|ies|ed)?\b|\bentrega(?:r|mos|n)?\b|\breparto\b/.test(f)
    || /送货|配送|公司送/.test(text);
  let out = text
    .replace(/\bpick\s*-?\s*up\b/gi, ' ')
    .replace(/\bwill\s*-?\s*call\b/gi, ' ')
    .replace(/\brecoger\b|\brecogida\b|\brecojo\b|\brecoge\b|\brecolecci[oó]n\b|\ba recoger\b/gi, ' ')
    .replace(/\bdeliver(?:y|ies|ed)?\b|\bentrega(?:r|mos|n)?\b|\breparto\b/gi, ' ')
    .replace(/自提|提货|上门提|送货|配送|公司送/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (pickup && delivery) return { value: null, ambiguous: true, text: out };
  if (pickup) return { value: 'pickup', ambiguous: false, text: out };
  if (delivery) return { value: 'delivery', ambiguous: false, text: out };
  return { value: null, ambiguous: false, text: out };
}

const LETTER_NAMES = {
  a: 'a', ay: 'a', bee: 'b', see: 'c', sea: 'c', cee: 'c', dee: 'd', ee: 'e',
  eff: 'f', gee: 'g', aitch: 'h', haitch: 'h', eye: 'i', aye: 'i', jay: 'j',
  kay: 'k', ell: 'l', el: 'l', em: 'm', en: 'n', oh: 'o', owe: 'o', pee: 'p',
  cue: 'q', queue: 'q', kew: 'q', are: 'r', arr: 'r', ess: 's', tee: 't', tea: 't',
  you: 'u', yu: 'u', vee: 'v', ex: 'x', why: 'y', wye: 'y', zee: 'z', zed: 'z',
};

function phoneticToken(token) {
  let s = String(token || '');
  s = s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/y/g, 'i');
  s = s.replace(/(.)\1+/g, '$1');
  return s;
}

function customerTokens(phrase) {
  const raw = fold(phrase).split(' ').filter(Boolean);
  const mapped = [];
  let letters = '';
  const flush = () => { if (letters) { mapped.push(letters); letters = ''; } };
  for (const tok of raw) {
    const letter = tok.length === 1 ? tok : LETTER_NAMES[tok];
    if (letter && letter.length === 1) letters += letter;
    else { flush(); mapped.push(tok); }
  }
  flush();
  return mapped;
}

function compactForm(phrase) {
  return customerTokens(phrase).map(phoneticToken).join('');
}

function similarity(heard, candidate) {
  const hTok = customerTokens(heard);
  const cTok = customerTokens(candidate);
  if (!hTok.length || !cTok.length) return 0;
  const hComp = hTok.map(phoneticToken).join('');
  const cComp = cTok.map(phoneticToken).join('');
  if (hComp === cComp) return 1;
  const hRaw = fold(heard).replace(/[^a-z0-9]/g, '');
  const cRaw = fold(candidate).replace(/[^a-z0-9]/g, '');
  if (hRaw && hRaw === cRaw) return 1;
  let prefix = 0;
  if (hTok.length <= cTok.length) {
    let ok = true;
    for (let i = 0; i < hTok.length; i++) {
      const a = phoneticToken(hTok[i]);
      const b = phoneticToken(cTok[i]);
      if (a !== b && levenshtein(a, b) > (Math.min(a.length, b.length) >= 5 ? 1 : 0)) ok = false;
    }
    if (ok && hComp.length >= 5) prefix = 0.9 + 0.08 * (hComp.length / Math.max(cComp.length, 1));
  }
  let compactPrefix = 0;
  if (hComp.length >= 4 && cComp.startsWith(hComp)) {
    compactPrefix = 0.88 + 0.1 * (hComp.length / cComp.length);
  }
  const dist = levenshtein(hComp, cComp);
  const edit = 1 - dist / Math.max(hComp.length, cComp.length, 1);
  const setH = new Set(hTok.map(phoneticToken));
  const setC = new Set(cTok.map(phoneticToken));
  let inter = 0;
  for (const t of setH) if (setC.has(t)) inter++;
  const jaccard = inter / (setH.size + setC.size - inter || 1);
  return Math.max(prefix, compactPrefix, edit * 0.7 + jaccard * 0.3);
}

/**
 * Compare a heard phrase to known customers.
 * aliases is an optional nickname → official name map. It is not stored.
 * @returns {{ best: string|null, confident: boolean, bestScore: number, suggestions: string[] }}
 */
export function matchCustomerPhrase(heard, customers, options = {}) {
  const aliases = options && options.aliases && typeof options.aliases === 'object' ? options.aliases : {};
  const groups = new Map();
  for (const name of customers || []) {
    if (!name || typeof name !== 'string') continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(name);
  }
  for (const [nick, official] of Object.entries(aliases)) {
    if (!official || typeof official !== 'string') continue;
    if (!groups.has(official)) groups.set(official, [official]);
    groups.get(official).push(String(nick));
  }
  const tokens = fold(heard).split(' ').filter(Boolean);
  const spans = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let len = 1; len <= Math.min(6, tokens.length - i); len++) {
      const span = tokens.slice(i, i + len).join(' ');
      if (span.replace(/\s/g, '').length >= 4) spans.push(span);
    }
  }
  if (!spans.length && fold(heard)) spans.push(fold(heard));
  const ranked = [];
  for (const [official, phrases] of groups) {
    let score = 0;
    for (const span of spans) {
      for (const phrase of phrases) score = Math.max(score, similarity(span, phrase));
    }
    ranked.push({ name: official, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const best = ranked[0];
  const second = ranked[1];
  const bestScore = best ? best.score : 0;
  const gap = second ? bestScore - second.score : 1;
  const confident = !!best && bestScore >= 0.86 && gap >= 0.08;
  let suggestions = ranked.filter(r => r.score >= 0.5).slice(0, 3).map(r => r.name);
  if (confident && best && !suggestions.includes(best.name)) suggestions = [best.name, ...suggestions].slice(0, 3);
  return { best: confident ? best.name : null, confident, bestScore, suggestions };
}

function leadingNamePhrase(text) {
  const stop = new Set(['po', 'order', 'pickup', 'delivery', 'deliver', 'ship', 'tomorrow', 'today', 'hoy', 'manana', 'bol', 'sku', 'skus', 'carrier', 'note', 'nota', 'recoger', 'recogida', 'entrega', 'pallet', 'pallets', 'carton', 'cartons', 'caja', 'cajas', 'tarima', 'tarimas', 'the', 'a', 'an', 'please', 'um', 'uh', 'for', 'and', 'or']);
  const lead = [];
  for (const tok of fold(text).split(' ').filter(Boolean)) {
    if (stop.has(tok) || /^\d+$/.test(tok)) break;
    lead.push(tok);
    if (lead.length >= 5) break;
  }
  return lead.join(' ');
}

function decideCustomer(phrase, customers, aliases, explicit) {
  const heard = String(phrase || '').trim();
  const m = matchCustomerPhrase(heard, customers, { aliases });
  if (m.best && m.confident) return { value: m.best, ambiguous: false, review: false, suggestions: m.suggestions };
  if (m.bestScore >= 0.64) return { value: null, ambiguous: true, review: false, suggestions: m.suggestions };
  if (explicit && heard && /[A-Za-z\u3400-\u9fff]/.test(heard) && !AMBIGUOUS_NAME.test(heard)) {
    return { value: heard, ambiguous: false, review: true, suggestions: m.suggestions };
  }
  return { value: null, ambiguous: false, review: false, suggestions: [] };
}

function resolveCustomer(span, rest, customers, aliases) {
  const empty = { value: null, ambiguous: false, review: false, suggestions: [] };
  if (span) return decideCustomer(span, customers, aliases, true);
  const contained = [];
  const hay = fold(rest);
  for (const name of customers) {
    const f = fold(name);
    if (f.length >= 3 && phraseIn(hay, f)) contained.push(name);
  }
  const kept = [];
  let h = ` ${hay} `;
  for (const name of [...contained].sort((a, b) => fold(b).length - fold(a).length)) {
    const p = ` ${fold(name)} `;
    if (h.includes(p)) { kept.push(name); h = h.split(p).join(' '); }
  }
  if (kept.length > 1) return { value: null, ambiguous: true, review: false, suggestions: kept.slice(0, 3) };
  if (kept.length === 1) {
    const more = matchCustomerPhrase(kept[0], customers, { aliases }).suggestions;
    const suggestions = [...new Set([kept[0], ...more])].slice(0, 3);
    return { value: kept[0], ambiguous: false, review: false, suggestions };
  }
  const lead = leadingNamePhrase(rest);
  if (!lead) return empty;
  return decideCustomer(lead, customers, aliases, false);
}

function matchKnown(text, customers) {
  const hay = fold(text);
  if (!hay) return null;
  const full = [];
  for (const name of customers) {
    const f = fold(name);
    if (f.length < 3) continue;
    if (phraseIn(hay, f)) full.push(name);
  }
  if (full.length) return disambiguateContained(full, hay);

  const prefixHits = [];
  for (const name of customers) {
    const tokens = fold(name).split(' ').filter(Boolean);
    for (let n = tokens.length - 1; n >= 1; n--) {
      const phrase = tokens.slice(0, n).join(' ');
      const strong = phrase.replace(/\s/g, '').length >= 5 && (n >= 2 || tokens[0].length >= 5);
      if (!strong) continue;
      if (phraseIn(hay, phrase)) {
        prefixHits.push({ name, score: phrase.length });
        break;
      }
    }
  }
  if (!prefixHits.length) return null;
  const best = Math.max(...prefixHits.map(p => p.score));
  const top = [...new Set(prefixHits.filter(p => p.score === best).map(p => p.name))];
  if (top.length === 1) return { value: top[0] };
  return { ambiguous: true };
}

function disambiguateContained(names, hay) {
  const sorted = [...names].sort((a, b) => fold(b).length - fold(a).length);
  let h = ` ${hay} `;
  const kept = [];
  for (const name of sorted) {
    const p = ` ${fold(name)} `;
    if (h.includes(p)) {
      kept.push(name);
      h = h.split(p).join(' ');
    }
  }
  if (kept.length === 1) return { value: kept[0] };
  if (kept.length > 1) return { ambiguous: true };
  return null;
}

function fuzzyCustomer(span, customers) {
  const f = fold(span);
  if (f.length < 6) return null;
  const hits = [];
  for (const name of customers) {
    const n = fold(name);
    if (n.length < 6) continue;
    if (levenshtein(f, n) <= 1) hits.push(name);
  }
  if (hits.length === 1) return { value: hits[0] };
  if (hits.length > 1) return { ambiguous: true };
  return null;
}

/**
 * Join a SpeechRecognition result list into one transcript.
 * Interim text counts — iOS often never sets isFinal.
 * Consecutive duplicates and cumulative repeats ("hello" then "hello world")
 * are collapsed so Android Chrome doesn't fill the form twice.
 * @param {{ transcript?: string, isFinal?: boolean }[]} results
 */
export function mergeSpeechResults(previous, incoming) {
  const prev = Array.isArray(previous) ? previous : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const prevText = collectSpeechTranscript(prev);
  const nextText = collectSpeechTranscript(next);
  if (!nextText) return prev.map(r => ({ ...r }));
  if (!prevText) return next.map(r => ({ ...r }));
  if (nextText.length >= prevText.length && (nextText.startsWith(prevText) || nextText.includes(prevText))) return next.map(r => ({ ...r }));
  if (prevText.includes(nextText)) return prev.map(r => ({ ...r }));
  return prev.concat(next.map(r => ({ transcript: r.transcript, isFinal: true })));
}

export function collectSpeechTranscript(results) {
  const finals = [];
  let interim = '';
  for (const raw of Array.isArray(results) ? results : []) {
    const t = String(raw && raw.transcript || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (raw.isFinal) {
      const prev = finals[finals.length - 1];
      if (prev && (t === prev || prev.startsWith(t))) continue;
      if (prev && t.startsWith(prev)) finals[finals.length - 1] = t;
      else finals.push(t);
      interim = '';
    } else {
      interim = t;
    }
  }
  if (interim) {
    const prev = finals[finals.length - 1];
    if (prev && (interim === prev || prev.startsWith(interim))) interim = '';
    else if (prev && interim.startsWith(prev)) {
      finals[finals.length - 1] = interim;
      interim = '';
    }
  }
  return [finals.join(' '), interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function createSpeechSession() {
  return {
    results: [],
    ended: false,
    applied: false,
    error: '',
    stopRequested: false,
    graceElapsed: false,
  };
}

const FATAL_SPEECH_ERRORS = new Set([
  'not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported', 'insecure-context',
]);

/**
 * One speech-session event. Actions:
 * listen — keep the mic open (text is the live line)
 * wait — onend/stop happened with nothing final yet; caller should wait briefly for a late result
 * apply — fill the form with text (interim counts)
 * message — show describeVoiceError(code)
 * ignore — already finished, or an abort we discarded
 */
export function reduceSpeechSession(session, event) {
  if (!session || session.applied) return { session, action: 'ignore', text: '', code: '' };
  const next = {
    results: session.results.slice(),
    ended: session.ended,
    applied: false,
    error: session.error,
    stopRequested: session.stopRequested,
    graceElapsed: session.graceElapsed,
  };
  const type = event && event.type;
  if (type === 'result') {
    const incoming = (event.results || []).map(r => ({
      transcript: String(r && r.transcript || ''),
      isFinal: !!(r && r.isFinal),
    }));
    // Never replace a longer transcript with an empty or shorter trailing event.
    // iOS stop() sometimes emits that, which used to wipe the words before fill.
    next.results = mergeSpeechResults(session.results, incoming);
  } else if (type === 'end') next.ended = true;
  else if (type === 'stop') next.stopRequested = true;
  else if (type === 'grace') next.graceElapsed = true;
  else if (type === 'error') {
    const code = String(event.code || '');
    if (code && code !== 'aborted') next.error = code;
  } else {
    return { session, action: 'listen', text: collectSpeechTranscript(session.results), code: '' };
  }

  const text = collectSpeechTranscript(next.results);
  const fatal = FATAL_SPEECH_ERRORS.has(next.error);
  // Tap-to-stop applies immediately. Waiting for onend drops the words on iOS,
  // where stop() often never ends the session and later events reset the timer.
  if (text && (next.ended || next.stopRequested || next.graceElapsed || fatal)) {
    next.applied = true;
    return { session: next, action: 'apply', text, code: next.error };
  }
  if (fatal) {
    next.applied = true;
    return { session: next, action: 'message', text: '', code: next.error };
  }
  if ((next.ended || next.stopRequested) && !next.graceElapsed) {
    return { session: next, action: 'wait', text, code: next.error };
  }
  if (next.graceElapsed && !text) {
    next.applied = true;
    return { session: next, action: 'message', text: '', code: next.error || 'no-speech' };
  }
  return { session: next, action: 'listen', text, code: next.error };
}

export function describeVoiceError(code, options = {}) {
  const ios = !!(options && options.ios);
  const known = {
    'not-allowed': 'Microphone permission is off. Allow the mic for this site in the browser settings, then tap the mic again. You can also type the shipment below.',
    'audio-capture': 'No microphone is available. Close other apps using the mic, or type the shipment below.',
    'service-not-allowed': ios
      ? 'Speech recognition is turned off on this iPhone. Turn on Siri (Settings → Siri & Search) and Dictation (Settings → General → Keyboard → Enable Dictation), then tap the mic again. You can also type the shipment below.'
      : 'This browser blocked speech recognition. You can type the shipment below.',
    'network': 'Voice needs an internet connection. Check the signal and tap the mic again, or type the shipment below.',
    'no-speech': "Didn't catch any speech. Tap the mic and try again, or type the shipment.",
    'language-not-supported': "This browser can't listen in that language. Try English, or type the shipment below.",
    'not-supported': "Voice input isn't available in this browser. Type the shipment below — that still works.",
    'insecure-context': 'Voice only works on a secure https page. Type the shipment below.',
  };
  const key = String(code || '');
  return { text: known[key] || "Voice didn't work this time. You can type the shipment below, or tap the mic to try again.", code: key };
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 1) return 2;
    prev = cur;
  }
  return prev[n];
}
