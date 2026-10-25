/*
 * Menu import + meal optimiser for the Aziz Cut Tracker (Food tab card "Plan my day from a menu").
 * Upload a restaurant or meal-prep menu (PDF, screenshot or pasted text), read each item's printed
 * kcal / protein / carbs / fat, let Aziz confirm anything uncertain, then pick the best
 * 2 meals + 2 snacks + Adonis around 2,000 kcal and 160-170 g protein with the NutreezePicker engine.
 *
 * Plain JS, no imports, no network of its own. Works as a browser global (window.MenuImport) or CommonJS.
 * The host passes in what needs the outside world:
 *   - pdf.js (`loadPdf()` resolves window.pdfjsLib; the host loads it from cdnjs on first use),
 *   - the Artifact `sample` capability (screenshots and scanned PDFs, which have no text layer),
 *   - the picker engine (window.NutreezePicker).
 *
 * Pure API (tested in node):
 *   MenuImport.parseText(textOrLines)        -> {items, warnings} in the Nutreeze menu format (see docs/nutreeze-menu-format.md)
 *   MenuImport.linesFromTextContent(content, pageWidth) -> lines of one pdf.js page, columns split
 *   MenuImport.textFromPdf(pdfjsLib, data)   -> Promise<{lines, pages, hasText}>
 *   MenuImport.readPrompt({pages})           -> instruction sent to Claude with menu images
 *   MenuImport.parseRead(value)              -> {items, warnings} from Claude's JSON answer
 *   MenuImport.check(item)                   -> item with needsCheck / checkReasons recomputed
 *   MenuImport.makeBanned(engine, dislikes)  -> name => reason|null (built-in never-pick + whole-word dislikes)
 *   MenuImport.annotate(items, {bannedReason, likeOf}) -> items with banned / liked set
 *   MenuImport.optimize(items, engine, opts) -> {options, fixed, skipped, usedMenuSnacks, notes}
 *   MenuImport.toRecord(items, {date, source, notes}) -> menus/{date} document
 *
 * Card API (browser):
 *   MenuImport.css; MenuImport.bind(root, host); MenuImport.html(date)
 *   host = { engine, getSample, loadPdf, getMenu(date), saveMenu(date, record), dayType(date) -> picker day type,
 *            dislikes() -> prefs/main.dislikes, targets(date) -> AppTargets object (optional),
 *            onUsePlan(date, plan, fixed), render(), date(), toast(msg) }
 *
 * Rules kept from Aziz's spec: numbers are only ever what the menu prints (null when unreadable, never
 * estimated); anything uncertain is flagged for confirmation; planned items are added as planned, not eaten.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MenuImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SECTIONS = ['meal', 'snack', 'salad', 'soup', 'drink', 'other'];
  const MAX_ITEMS = 120;
  const MISMATCH = 0.15; // same rule as the Nutreeze Menu Reader

  /* ---------------- text parsing ---------------- */

  // Section headings as they appear on menus -> Nutreeze section.
  const SECTION_WORDS = [
    [/^(main ?(meals?|dishes|courses?)?|meals?|lunch|dinner|breakfast|mains|entrees?|plates?|bowls?|high protein|protein meals?|keto|low carb)$/, 'meal'],
    [/^(snacks?|desserts?|sweets?|sweet|fruits?|nuts|bites|treats|bakery|cakes?)$/, 'snack'],
    [/^(salads?)$/, 'salad'],
    [/^(soups?)$/, 'soup'],
    [/^(drinks?|beverages?|juices?|smoothies?|shakes?|coffee)$/, 'drink'],
    [/^(sides?|add ?ons?|extras?|sauces?)$/, 'other'],
  ];

  const LABELS = [
    ['kcal', /^(kcal|kcals|calories?|cals?|energy)$/],
    ['protein', /^(protein|proteins|prot|pro|p)$/],
    ['carbs', /^(carbs?|carbohydrates?|carb\.?|c)$/],
    ['fat', /^(fats?|total fat|f)$/],
  ];
  const labelOf = w => { const x = String(w).toLowerCase().replace(/[^a-z ]/g, '').trim(); for (const [k, re] of LABELS) if (re.test(x)) return k; return null; };

  const PRICE = /(?:\b(?:kd|kwd|bd|bhd|sar|aed|qar|omr|usd|eur|gbp)\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:kd|kwd|bd|bhd|sar|aed|qar|omr|usd|eur|gbp)\b|[$€£]\s*\d+(?:[.,]\d+)?|\bfils\b\s*\d+|\d+\s*fils\b)/gi;
  // Words that can stand next to a number as its label (whole words only).
  const LABEL_WORDS = 'kcal|kcals|calories|calorie|cals|cal|energy|protein|proteins|prot|carbohydrates|carbohydrate|carbs|carb|fats|fat|total fat';
  const SHORT_LABELS = 'p|c|f';

  function toNum(s) {
    let t = String(s).trim();
    if (/^\d{1,2},\d{3}$/.test(t)) t = t.replace(',', '');
    else t = t.replace(',', '.');
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  // Values with a label next to them: "Protein: 45g", "520 kcal", "45g P", "P 45".
  function labelledValues(line) {
    const out = {};
    const used = [];
    const num = '(\\d+(?:[.,]\\d+)?)';
    const take = (re, labelIdx, numIdx) => {
      let m; re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const k = labelOf(m[labelIdx]);
        const v = toNum(m[numIdx]);
        if (!k || v == null || out[k] != null) continue;
        if (used.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
        out[k] = v; used.push([m.index, m.index + m[0].length]);
      }
    };
    const numFirst = new RegExp(num + '\\s*(?:g|gm|grams?)?\\s*(' + LABEL_WORDS + '|' + SHORT_LABELS + ')\\b', 'gi'); // "520 kcal", "45g P"
    const labelFirst = new RegExp('\\b(' + LABEL_WORDS + '|' + SHORT_LABELS + ')\\b\\s*[:=\\-]?\\s*' + num, 'gi'); // "Protein: 45g", "P 45"
    // Whichever style the line starts with wins: in "Protein: 38g Carbs: 18g" the "38g Carbs" pair is not carbs.
    const lf = labelFirst.exec(line), nf = numFirst.exec(line);
    if (lf && (!nf || lf.index <= nf.index)) { take(labelFirst, 1, 2); take(numFirst, 2, 1); }
    else { take(numFirst, 2, 1); take(labelFirst, 1, 2); }
    return { values: out, spans: used };
  }

  function headerColumns(line) {
    if (/\d/.test(line)) return null;
    const cols = [];
    for (const w of line.split(/\s*[|,;\t]\s*|\s{2,}|\s+/)) {
      const k = labelOf(w);
      if (k && !cols.includes(k)) cols.push(k);
    }
    // "Total fat" spelled across two words still lands as fat via "fat".
    return cols.length >= 3 ? cols : null;
  }

  function sectionOf(line) {
    const t = line.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 24) return null;
    for (const [re, s] of SECTION_WORDS) if (re.test(t)) return s;
    return null;
  }

  const cleanName = s => String(s || '')
    .replace(PRICE, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/^[\s\-–—•·*#|:.,]+|[\s\-–—•·*#|:;.,=(]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const blank = () => ({ kcal: null, protein: null, carbs: null, fat: null });
  const hasAny = v => ['kcal', 'protein', 'carbs', 'fat'].some(k => v[k] != null);

  // Assign unlabelled numbers. Returns {values, assumed} or null.
  function unlabelled(nums, cols) {
    if (cols) {
      if (nums.length < cols.length) return null;
      const v = blank(); const last = nums.slice(-cols.length);
      cols.forEach((k, i) => { v[k] = last[i]; });
      return { values: v, assumed: false };
    }
    if (nums.length < 4) return null;
    const [a, b, c, d] = nums.slice(-4);
    // kcal first or last; fat is the only column the 4P+4C+9F check can place.
    const orders = [
      ['kcal', 'protein', 'carbs', 'fat'], ['kcal', 'protein', 'fat', 'carbs'], ['kcal', 'fat', 'carbs', 'protein'],
      ['protein', 'carbs', 'fat', 'kcal'], ['fat', 'carbs', 'protein', 'kcal'],
    ];
    for (const o of orders) {
      const v = blank(); [a, b, c, d].forEach((n, i) => { v[o[i]] = n; });
      if (fits(v)) return { values: v, assumed: o !== orders[0] ? 'reordered' : 'default' };
    }
    const v = blank(); [a, b, c, d].forEach((n, i) => { v[orders[0][i]] = n; });
    return { values: v, assumed: 'default' };
  }

  function fromMacros(v) {
    if ([v.protein, v.carbs, v.fat].some(x => typeof x !== 'number')) return null;
    return 4 * v.protein + 4 * v.carbs + 9 * v.fat;
  }
  function fits(v) {
    const m = fromMacros(v);
    return typeof v.kcal === 'number' && v.kcal > 0 && m != null && Math.abs(m - v.kcal) / v.kcal <= MISMATCH;
  }

  // Recompute needsCheck from the numbers. Keeps flags that came from reading (e.g. a guessed column order)
  // until Aziz confirms the item.
  function check(item) {
    const it = { ...item };
    const reasons = (it.readReasons || []).slice();
    const missing = ['kcal', 'protein', 'carbs', 'fat'].filter(k => typeof it[k] !== 'number' || !isFinite(it[k]));
    if (missing.length) reasons.push('missing ' + missing.join(', ') + (missing.includes('kcal') && fromMacros(it) != null ? ` (4P+4C+9F ≈ ${Math.round(fromMacros(it))})` : ''));
    else {
      const m = fromMacros(it);
      if (it.kcal <= 0) reasons.push('kcal is 0');
      else if (Math.abs(m - it.kcal) / it.kcal > MISMATCH) reasons.push(`kcal ${Math.round(it.kcal)} is more than 15% off 4P+4C+9F (${Math.round(m)})`);
      if (it.protein > 150 || it.carbs > 300 || it.fat > 150 || it.kcal > 2500) reasons.push('a number looks too large for one item');
    }
    it.checkReasons = it.confirmed && !missing.length ? [] : reasons;
    it.needsCheck = it.checkReasons.length > 0;
    return it;
  }

  function item(name, values, section, readReasons) {
    return check({ name, section: section || 'meal', ...blank(), ...values, banned: false, bannedReason: null, liked: false, readReasons: readReasons || [] });
  }

  /*
   * Parse menu text (pasted, or lines from a PDF's text layer). Handles:
   *  - one item per line: "French Tacos Chicken 650 55 60 18", "Chicken Masala — 607 kcal | 67 P | 60 C | 11 F"
   *  - a table with a header row: "Item  Calories  Protein  Carbs  Fat" then rows of numbers
   *  - blocks: a name line, then "Calories: 520", "Protein 45g" ... on the following lines
   *  - section headings ("Snacks", "Desserts", "Salads") switching the section of what follows
   */
  function parseText(input) {
    const nutreeze = parseNutreezeJson(input);
    if (nutreeze) return nutreeze;
    const lines = (Array.isArray(input) ? input : String(input || '').split(/\r?\n/)).map(l => String(l).replace(/\s+/g, ' ').trim());
    const items = [], warnings = [];
    let section = 'meal', cols = null, buffer = [], pending = null, sawUnlabelled = false, sawReorder = false;

    const nameFromBuffer = () => {
      const texts = buffer.filter(t => /[a-z]/i.test(t));
      if (!texts.length) return '';
      if (texts.length <= 2) return cleanName(texts[0]);
      const short = texts.filter(t => t.length < 60 && !/,/.test(t));
      return cleanName((short.length ? short[short.length - 1] : texts[0]));
    };
    const flush = () => {
      if (pending && hasAny(pending.values)) items.push(item(pending.name, pending.values, pending.section, pending.reasons));
      pending = null;
    };

    for (const raw of lines) {
      if (items.length >= MAX_ITEMS) { warnings.push(`Only the first ${MAX_ITEMS} items were read.`); break; }
      const line = raw.replace(PRICE, ' ').replace(/\s+/g, ' ').trim();
      if (!line || /^#/.test(line)) continue;

      const sec = sectionOf(line);
      if (sec) { flush(); section = sec; buffer = []; continue; }
      const head = headerColumns(line);
      if (head) { flush(); cols = head; buffer = []; continue; }

      const { values, spans } = labelledValues(line);
      let rest = line;
      spans.slice().sort((a, b) => b[0] - a[0]).forEach(([a, b]) => { rest = rest.slice(0, a) + ' '.repeat(b - a) + rest.slice(b); });
      const firstNum = rest.search(/\d/);
      const labelledStart = spans.length ? Math.min(...spans.map(s => s[0])) : Infinity;
      const nameEnd = Math.min(firstNum < 0 ? Infinity : firstNum, labelledStart, line.length);
      const lineName = cleanName(line.slice(0, nameEnd));
      const nums = [...rest.matchAll(/\d+(?:[.,]\d+)?/g)].map(m => toNum(m[0]));

      if (Object.keys(values).length) {
        // Labelled numbers on this line.
        const v = { ...blank(), ...values };
        if (lineName && /[a-z]{2}/i.test(lineName)) {
          flush();
          pending = { name: lineName, values: v, section, reasons: [] };
        } else if (pending && !['kcal', 'protein', 'carbs', 'fat'].some(k => values[k] != null && pending.values[k] != null)) {
          Object.assign(pending.values, values);
        } else {
          flush();
          const name = nameFromBuffer();
          if (!name) { warnings.push(`Numbers without a name were skipped: "${raw.slice(0, 60)}"`); buffer = []; continue; }
          pending = { name, values: v, section, reasons: buffer.filter(t => /[a-z]/i.test(t)).length > 2 ? ['name picked from several lines; check it'] : [] };
        }
        buffer = [];
        if (['kcal', 'protein', 'carbs', 'fat'].every(k => pending.values[k] != null)) flush();
        continue;
      }

      const un = unlabelled(nums, cols);
      if (un) {
        flush();
        const name = lineName && /[a-z]{2}/i.test(lineName) ? lineName : nameFromBuffer();
        if (!name) { warnings.push(`Numbers without a name were skipped: "${raw.slice(0, 60)}"`); buffer = []; continue; }
        const reasons = [];
        if (un.assumed) { sawUnlabelled = true; if (un.assumed === 'reordered') { sawReorder = true; reasons.push('columns weren\'t labelled; order guessed from the kcal'); } }
        if (!cols && !fits(un.values) && un.assumed) reasons.push('columns weren\'t labelled');
        items.push(item(name, un.values, section, reasons));
        buffer = [];
        continue;
      }

      if (nums.length && lineName && cols && nums.length < cols.length) {
        flush();
        const v = blank(); cols.slice(-nums.length).forEach((k, i) => { v[k] = nums[i]; });
        items.push(item(lineName, v, section, ['some columns were empty or unreadable']));
        buffer = [];
        continue;
      }

      // Plain text: a name, a description, or a page title.
      if (pending && pending.name && hasAny(pending.values)) {
        // A new text line after a partly filled block starts the next item.
        flush();
      }
      buffer.push(line);
      if (buffer.length > 6) buffer.shift();
    }
    flush();

    const merged = dedupe(items);
    if (sawUnlabelled && !cols) warnings.unshift('The menu didn\'t label its number columns. They were read as kcal, protein, carbs, fat' + (sawReorder ? ' (some reordered to match the kcal)' : '') + '. Protein and carbs can\'t be told apart by the numbers alone, so check one item against the menu.');
    if (merged.dupes) warnings.push(`${merged.dupes} item${merged.dupes > 1 ? 's' : ''} appeared twice and ${merged.dupes > 1 ? 'were' : 'was'} kept once.`);
    return { items: merged.items, warnings };
  }

  function dedupe(items) {
    const byName = new Map(); let dupes = 0;
    for (const it of items) {
      const k = it.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const prev = byName.get(k);
      if (!prev) { byName.set(k, it); continue; }
      dupes++;
      if (['kcal', 'protein', 'carbs', 'fat'].some(f => prev[f] !== it[f])) {
        byName.set(k, check({ ...prev, readReasons: (prev.readReasons || []).concat(`listed twice with different numbers (${it.kcal} kcal / ${it.protein} P the other time)`) }));
      }
    }
    return { items: [...byName.values()], dupes };
  }

  // The Nutreeze Menu Reader's export, or a record this card saved before.
  function parseNutreezeJson(input) {
    if (typeof input !== 'string' && (!input || Array.isArray(input))) return null;
    let data = input;
    if (typeof input === 'string') {
      const t = input.trim();
      if (!/^[\[{]/.test(t)) return null;
      try { data = JSON.parse(t); } catch (e) { return null; }
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
    if (!list) return null;
    const items = list.filter(x => x && typeof x === 'object' && x.name).slice(0, MAX_ITEMS).map(x => {
      const n = v => (typeof v === 'number' && isFinite(v) ? v : null);
      const it = item(String(x.name).trim().slice(0, 100), { kcal: n(x.kcal), protein: n(x.protein ?? x.p), carbs: n(x.carbs ?? x.c), fat: n(x.fat ?? x.f) },
        SECTIONS.includes(x.section) ? x.section : 'meal', x.needsCheck && !x.confirmed ? ['flagged when it was read'] : []);
      if (x.confirmed) { it.confirmed = true; return check(it); }
      return it;
    });
    return { items, warnings: [], date: data && typeof data.date === 'string' ? data.date : null };
  }

  /* ---------------- PDF text layer ---------------- */

  // Group one page's pdf.js text items into lines (top to bottom), splitting side-by-side menu columns.
  function linesFromTextContent(content, pageWidth) {
    const its = (content && content.items || []).filter(t => t && typeof t.str === 'string' && t.str.trim() && t.transform);
    const rows = [];
    for (const t of its.map(t => ({ s: t.str, x: t.transform[4], y: t.transform[5], w: t.width || t.str.length * Math.abs(t.transform[0] || 10) * 0.5, h: Math.abs(t.transform[3]) || t.height || 10 }))) {
      let row = rows.find(r => Math.abs(r.y - t.y) <= Math.max(2, Math.min(r.h, t.h) * 0.5));
      if (!row) { row = { y: t.y, h: t.h, parts: [] }; rows.push(row); }
      row.parts.push(t);
    }
    rows.sort((a, b) => b.y - a.y);
    const W = pageWidth || Math.max(600, ...its.map(t => t.transform[4] + (t.width || 0)));
    const chunks = []; let splitRows = 0;
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      // Segments split at wide gaps; a new chunk starts when a word-led segment follows numbers.
      const segs = [];
      for (const p of r.parts) {
        const last = segs[segs.length - 1];
        const gap = last ? p.x - (last.end) : 0;
        if (last && gap < W * 0.04) { last.text += (gap > 1 ? ' ' : '') + p.s; last.end = p.x + p.w; }
        else segs.push({ text: p.s, x: p.x, end: p.x + p.w });
      }
      // A new chunk (the next menu column) starts at a word-led segment after a full set of numbers,
      // or after a name when neither side has numbers. Header labels ("Calories", "Protein") never start one.
      const rowChunks = []; let chunk = null;
      for (const s of segs) {
        const first = s.text.trim().split(/\s+/)[0] || '';
        const isLabel = !!labelOf(first.replace(/[:=]$/, ''));
        const startsWord = /^\s*[a-z]/i.test(s.text) || /^\s*[^\x00-\x7f]/.test(s.text);
        const chunkNums = chunk ? (chunk.text.match(/\d+(?:[.,]\d+)?/g) || []).length : 0;
        const chunkHasLabel = chunk && chunk.text.trim().split(/\s+/).some(w => labelOf(w));
        const split = chunk && startsWord && (chunkNums >= 3 || (!isLabel && !chunkNums && !chunkHasLabel && !/\d/.test(s.text)));
        if (split) { rowChunks.push(chunk); chunk = { text: s.text, x: s.x }; }
        else if (chunk) chunk.text += '  ' + s.text;
        else chunk = { text: s.text, x: s.x };
      }
      if (chunk) rowChunks.push(chunk);
      if (rowChunks.length > 1) splitRows++;
      rowChunks.forEach(c => chunks.push({ text: c.text.trim(), col: c.x >= W * 0.45 ? 1 : 0 }));
    }
    // Two-column menus read down the left column first, then the right one.
    const ordered = splitRows >= 2 ? chunks.filter(c => c.col === 0).concat(chunks.filter(c => c.col === 1)) : chunks;
    return ordered.map(c => c.text).filter(Boolean);
  }

  async function textFromPdf(pdfjsLib, data, { maxPages = 30 } = {}) {
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, maxPages);
    const lines = [];
    let chars = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const ls = linesFromTextContent(tc, vp.width);
      ls.forEach(l => { chars += l.replace(/\s/g, '').length; });
      lines.push(...ls);
    }
    return { lines, pages, totalPages: doc.numPages, hasText: chars > 40, doc };
  }

  // Render pages to JPEG blobs for Claude when the PDF has no text layer (a scan or a photo saved as PDF).
  async function pdfPageImages(doc, { maxPages = 4, maxSide = 1800 } = {}) {
    const blobs = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, maxSide / Math.max(base.width, base.height)) });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      blobs.push(await new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.85)));
    }
    return blobs.filter(Boolean);
  }

  /* ---------------- images through Claude ---------------- */

  function readPrompt({ pages = 1 } = {}) {
    return [
      `The attached ${pages > 1 ? pages + ' images are pages' : 'image is a page'} of a restaurant or meal-prep menu.`,
      'List every food or drink item that shows nutrition numbers, copying the numbers exactly as printed.',
      'Rules:',
      '- Never estimate or calculate. If a number is missing, cut off, blurry or you are not sure of a digit, use null for it and set "unsure": true.',
      '- kcal is calories (kcal/Cal/Energy). protein, carbs, fat are grams.',
      '- section is the heading the item sits under, mapped to one of: meal, snack, salad, soup, drink, other. Desserts, fruit, nuts and sweets are snack. Breakfast and main dishes are meal.',
      '- Use the item name as printed (English if both English and Arabic are shown). Ignore prices.',
      '- Skip items with no nutrition numbers at all, and say how many you skipped in note.',
      'Reply with only JSON in this shape:',
      '{"items":[{"name":"Buffalo Chicken with Sweet Potato","section":"meal","kcal":496,"protein":65,"carbs":41,"fat":8,"unsure":false}],"note":"One short sentence on anything hard to read."}',
    ].join('\n');
  }

  function parseRead(value) {
    let v = value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
    if (Array.isArray(v)) v = { items: v };
    if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return { items: [], warnings: ['Claude\'s answer couldn\'t be read. Try again.'] };
    const n = x => {
      if (x == null || x === '') return null;
      const k = typeof x === 'number' ? x : toNum(String(x).replace(/[^\d.,]/g, ''));
      return k != null && isFinite(k) && k >= 0 ? k : null;
    };
    const items = dedupe(v.items.filter(x => x && typeof x === 'object' && String(x.name || '').trim()).slice(0, MAX_ITEMS).map(x =>
      item(cleanName(x.name).slice(0, 100), { kcal: n(x.kcal ?? x.calories), protein: n(x.protein), carbs: n(x.carbs), fat: n(x.fat) },
        SECTIONS.includes(x.section) ? x.section : 'meal', x.unsure ? ['Claude wasn\'t sure it read this right'] : []))).items;
    const warnings = ['Read from an image by Claude. Numbers are copied, not estimated, but compare anything flagged with the menu.'];
    if (v.note) warnings.push(String(v.note).slice(0, 300));
    return { items, warnings };
  }

  /* ---------------- preferences + optimiser ---------------- */

  // Whole-word phrase match, the same rule as MealPrefs.classify (a trailing s/es is allowed).
  const normWords = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  function containsPhrase(text, phrase) {
    const p = normWords(phrase);
    if (!p) return false;
    const words = p.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:s|es)? ');
    return new RegExp('(?:^| )' + words + '(?:s|es)?(?: |$)').test(normWords(text));
  }

  /*
   * The one never-pick check: the picker's built-in rules (plan section 6), then Aziz's own
   * dislikes (prefs/main.dislikes) matched as whole words.
   */
  function makeBanned(engine, dislikes) {
    const list = (dislikes || []).map(d => String(d || '').trim()).filter(Boolean);
    return name => {
      const builtIn = engine && engine.bannedReason ? engine.bannedReason(String(name || ''), []) : null;
      if (builtIn) return builtIn;
      const hit = list.find(d => containsPhrase(name, d));
      return hit ? 'Your never-pick list: ' + hit : null;
    };
  }

  function annotate(items, { bannedReason, likeOf, extraBans } = {}) {
    const isBanned = bannedReason && bannedReason.length < 2 ? bannedReason : name => (bannedReason ? bannedReason(name, extraBans || []) : null);
    return items.map(it => {
      const reason = it.skip ? 'You took it out' : isBanned(it.name);
      return { ...it, banned: !!reason, bannedReason: reason || null, liked: !!(likeOf && likeOf(it.name)) };
    });
  }

  const complete = it => ['kcal', 'protein', 'carbs', 'fat'].every(k => typeof it[k] === 'number' && isFinite(it[k]));
  const toEngine = it => ({ name: it.name, kcal: it.kcal, p: it.protein, c: it.carbs, f: it.fat, needsCheck: !!it.needsCheck, fromMenu: true });

  /*
   * opts: { dayType, adonis, gatorade, eggs, dislikes, targets, onlyConfirmed, top, lockMeals, lockSnacks }
   *   dislikes: prefs/main.dislikes (whole-word match, plus the picker's built-in never-pick rules)
   *   targets:  an AppTargets object for the day; the engine's defaults are used only when it's missing
   * Meals come from section "meal" (salads and soups too when there are fewer than 2 meals);
   * snacks from section "snack" when the menu has at least 2, otherwise the engine's fixed Nutreeze snack list.
   */
  function optimize(items, engine, opts = {}) {
    const o = Object.assign({ dayType: 'training', adonis: true, dislikes: [], onlyConfirmed: false, top: 3 }, opts);
    const isBanned = makeBanned(engine, o.dislikes);
    if (o.gatorade == null) o.gatorade = o.dayType !== 'rest' && o.dayType !== 'friday';
    if (o.eggs == null) o.eggs = o.dayType === 'saturday';
    const tagged = annotate(items, { bannedReason: isBanned, likeOf: engine.likeOf });
    const skipped = [];
    const usable = tagged.filter(it => {
      if (it.banned) { skipped.push({ name: it.name, reason: it.bannedReason }); return false; }
      if (!complete(it)) { skipped.push({ name: it.name, reason: 'numbers missing; fill them in to use it' }); return false; }
      if (o.onlyConfirmed && it.needsCheck) { skipped.push({ name: it.name, reason: 'not confirmed yet' }); return false; }
      return true;
    });
    let meals = usable.filter(it => it.section === 'meal');
    const notes = [];
    if (meals.length < 2) {
      const extra = usable.filter(it => it.section === 'salad' || it.section === 'soup' || it.section === 'other');
      if (extra.length) { meals = meals.concat(extra); notes.push('Fewer than 2 main meals on the menu, so salads and soups count as meals.'); }
    }
    const menuSnacks = usable.filter(it => it.section === 'snack');
    const usedMenuSnacks = menuSnacks.length >= 2;
    if (!usedMenuSnacks) notes.push(menuSnacks.length ? 'Only 1 snack on this menu, so snacks come from your usual Nutreeze snack list.' : 'No snacks on this menu, so snacks come from your usual Nutreeze snack list.');
    if (meals.length < 2) return { options: [], fixed: [], skipped, usedMenuSnacks, notes, error: 'Need at least 2 meals with all four numbers to build a day.' };
    const r = engine.pick({
      meals: meals.map(toEngine), snacks: usedMenuSnacks ? menuSnacks.map(toEngine) : undefined,
      dayType: o.dayType, adonis: o.adonis, gatorade: o.gatorade, eggs: o.eggs, targets: o.targets || undefined,
      // Fixed-list snacks Aziz dislikes, by the same whole-word rule.
      exclude: usedMenuSnacks ? [] : (engine.SNACKS || []).filter(sn => isBanned(sn.name)).map(sn => sn.name),
      lockMeals: o.lockMeals || [], lockSnacks: o.lockSnacks || [], top: o.top,
    });
    if (!r.options.length) return { options: [], fixed: r.fixed, skipped, usedMenuSnacks, notes, error: 'No combination could be built. Check the snacks or add more meals.' };
    return { options: r.options, fixed: r.fixed, fixedTotals: r.fixedTotals, labels: r.labels, skipped, usedMenuSnacks, notes };
  }

  function toRecord(items, { date, source, notes, now } = {}) {
    return {
      date: date || null,
      updatedAt: (now || new Date()).toISOString(),
      source: source || 'text',
      notes: notes || '',
      items: items.map(it => ({
        name: it.name, section: it.section, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat,
        banned: !!it.banned, bannedReason: it.bannedReason || null, liked: !!it.liked,
        needsCheck: !!it.needsCheck, confirmed: !!it.confirmed, skip: !!it.skip,
      })),
    };
  }

  function fromRecord(rec) {
    if (!rec || !Array.isArray(rec.items)) return [];
    return rec.items.map(x => {
      const it = item(x.name, { kcal: x.kcal, protein: x.protein, carbs: x.carbs, fat: x.fat }, x.section, x.needsCheck && !x.confirmed ? ['flagged when it was read'] : []);
      it.confirmed = !!x.confirmed; it.skip = !!x.skip;
      return check(it);
    });
  }

  /* ---------------- card (browser only) ---------------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r0 = n => Math.round(n);
  const ST = { date: '', items: null, warnings: [], source: '', busy: '', error: '', text: '', showText: false, result: null, opts: { adonis: true, onlyConfirmed: false }, canImage: null, ctl: null, loadedFor: '' };
  let H = null;

  function sync() {
    const d = H.date();
    if (ST.loadedFor === d) return;
    ST.loadedFor = d; ST.result = null; ST.error = ''; ST.warnings = [];
    const rec = H.getMenu(d);
    ST.items = rec ? fromRecord(rec) : null;
    ST.source = rec ? rec.source || '' : '';
  }

  function save(note) {
    const d = H.date();
    const items = annotate(ST.items, { bannedReason: makeBanned(H.engine, H.dislikes()), likeOf: H.engine.likeOf });
    H.saveMenu(d, toRecord(items, { date: d, source: ST.source, notes: note || '' }));
  }

  function setItems(res, source) {
    ST.items = res.items; ST.warnings = res.warnings || []; ST.source = source; ST.result = null;
    ST.error = res.items.length ? '' : (ST.warnings.find(w => /skipped|couldn/.test(w)) || 'No items with nutrition numbers were found.');
    if (res.items.length) save();
  }

  async function sampleOrNull() { try { return await H.getSample(); } catch (e) { return null; } }

  async function readImages(blobs, source) {
    const sample = await sampleOrNull();
    if (!sample) { ST.error = 'Reading images needs Claude, which isn\'t available here. Paste the menu text instead.'; ST.showText = true; return; }
    const lim = await sample.limits().catch(() => null);
    if (!lim || !lim.images) { ST.error = 'This page can\'t send images to Claude. Paste the menu text instead.'; ST.showText = true; return; }
    const max = lim.images.maxCount || 4;
    if (blobs.length > max) ST.warnings.push(`Only the first ${max} pages were read.`);
    ST.ctl = new AbortController();
    const v = await sample.json(readPrompt({ pages: Math.min(blobs.length, max) }), { images: blobs.slice(0, max), signal: ST.ctl.signal, modelTier: 'default' });
    setItems(parseRead(v), source);
  }

  async function shrink(file, max = 1800) {
    try {
      if (typeof createImageBitmap !== 'function') return file;
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 1.5e6) return file;
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      return await new Promise(res => cv.toBlob(b => res(b || file), 'image/jpeg', 0.88));
    } catch (e) { return file; }
  }

  async function onFiles(files) {
    const list = [...files];
    if (!list.length) return;
    ST.busy = 'Reading the menu…'; ST.error = ''; ST.warnings = []; H.render();
    try {
      const pdf = list.find(f => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name));
      if (pdf) {
        const lib = await H.loadPdf();
        if (!lib) throw Object.assign(new Error('pdf'), { code: 'pdf_unavailable' });
        const buf = new Uint8Array(await pdf.arrayBuffer());
        const t = await textFromPdf(lib, buf);
        const res = t.hasText ? parseText(t.lines) : { items: [] };
        if (t.totalPages > t.pages) (res.warnings = res.warnings || []).push(`Only the first ${t.pages} of ${t.totalPages} pages were read.`);
        if (res.items.length) setItems(res, 'pdf');
        else {
          // No text layer (or no numbers in it): show the pages to Claude.
          ST.busy = t.hasText ? 'No numbers in the PDF text; asking Claude to read the pages…' : 'This PDF is a scan; asking Claude to read the pages…'; H.render();
          await readImages(await pdfPageImages(t.doc), 'pdf-image');
        }
      } else {
        const imgs = await Promise.all(list.filter(f => /^image\//.test(f.type)).map(f => shrink(f)));
        if (!imgs.length) throw Object.assign(new Error('type'), { code: 'bad_type' });
        await readImages(imgs, 'image');
      }
    } catch (e) {
      const c = e && e.code;
      if (c !== 'cancelled') ST.error = errorText(c, e);
    }
    ST.busy = ''; ST.ctl = null; H.render();
  }

  function errorText(code, e) {
    switch (code) {
      case 'pdf_unavailable': return 'The PDF reader couldn\'t load (it needs internet the first time). Paste the menu text, or upload screenshots instead.';
      case 'bad_type': return 'Upload a PDF or an image (PNG, JPG).';
      case 'not_granted': case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed':
        return 'Claude isn\'t available on this page right now. Paste the menu text instead.';
      case 'images_unavailable': case 'image_rejected': return 'That image couldn\'t be sent. Try a PNG or JPG screenshot.';
      case 'rate_limited': return 'Claude is busy for a moment. Wait a minute and try again.';
      case 'session_expired': return 'You\'ve been signed out. Reload the page and try again.';
      case 'invalid_json': case 'empty_completion': return 'Claude\'s answer couldn\'t be read. Try again.';
      default:
        if (e && /password/i.test(e.name || e.message || '')) return 'That PDF is password-protected. Open it, save an unlocked copy, and upload that.';
        if (e && /Invalid PDF|InvalidPDF/i.test(e.name || e.message || '')) return 'That file isn\'t a readable PDF.';
        return 'Something went wrong reading the menu. Try again, or paste the text.';
    }
  }

  function runOptimizer() {
    const d = H.date();
    const dt = H.dayType(d);
    ST.result = optimize(ST.items, H.engine, { dayType: dt, adonis: ST.opts.adonis, dislikes: H.dislikes(), targets: H.targets ? H.targets(d) : null, onlyConfirmed: ST.opts.onlyConfirmed, top: 3 });
    ST.result.dayType = dt;
  }

  function bind(rootEl, host) {
    H = host;
    sampleOrNull().then(async s => {
      const lim = s ? await s.limits().catch(() => null) : null;
      ST.canImage = !!(lim && lim.images); H.render();
    });
    rootEl.addEventListener('click', e => {
      const b = e.target.closest('[data-mi]'); if (!b) return;
      const a = b.dataset.mi, i = +b.dataset.i;
      if (a === 'paste') { ST.showText = !ST.showText; H.render(); }
      else if (a === 'readtext') { const res = parseText(ST.text); setItems(res, 'text'); if (res.items.length) ST.showText = false; H.render(); }
      else if (a === 'stop' && ST.ctl) ST.ctl.abort();
      else if (a === 'ok' && ST.items[i]) { ST.items[i] = check({ ...ST.items[i], confirmed: true }); if (ST.items[i].needsCheck) H.toast('Fill in the missing numbers first'); else { ST.result = null; save(); } H.render(); }
      else if (a === 'skip' && ST.items[i]) { ST.items[i] = { ...ST.items[i], skip: !ST.items[i].skip }; ST.result = null; save(); H.render(); }
      else if (a === 'okall') { ST.items = ST.items.map(it => complete(it) ? check({ ...it, confirmed: true }) : it); ST.result = null; save(); H.render(); }
      else if (a === 'go') { runOptimizer(); H.render(); }
      else if (a === 'use' && ST.result && ST.result.options[i]) { H.onUsePlan(H.date(), ST.result.options[i], ST.result.fixed); ST.result = null; H.render(); }
      else if (a === 'clear') { ST.items = null; ST.result = null; ST.warnings = []; ST.error = ''; H.saveMenu(H.date(), null); H.render(); }
    });
    rootEl.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'miText') { ST.text = t.value; return; }
      const k = t.dataset && t.dataset.mik; if (!k || !ST.items) return;
      const it = ST.items[+t.dataset.i]; if (!it) return;
      if (k === 'name') it.name = t.value;
      else { const v = t.value.trim() === '' ? null : toNum(t.value); it[k] = v; it.confirmed = false; }
      it._dirty = true; ST.result = null;
    });
    rootEl.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'miFile' && t.files) { onFiles(t.files); t.value = ''; return; }
      if (t.id === 'miAdonis') { ST.opts.adonis = t.checked; ST.result = null; H.render(); return; }
      if (t.id === 'miConfirmed') { ST.opts.onlyConfirmed = t.checked; ST.result = null; H.render(); return; }
      const k = t.dataset && t.dataset.mik; if (!k || !ST.items) return;
      const i = +t.dataset.i, it = ST.items[i]; if (!it) return;
      if (k === 'section') it.section = t.value;
      ST.items[i] = check({ ...it, readReasons: it._dirty && k !== 'name' && k !== 'section' ? [] : it.readReasons });
      save(); H.render();
    });
  }

  const css = `
.mi .mi-drop{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.mi .mi-file{position:relative;overflow:hidden}
.mi .mi-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
.mi .mi-list{margin:10px 0;border-top:1px solid var(--line)}
.mi .mi-it{padding:8px 0;border-bottom:1px solid var(--line)}
.mi .mi-it.flag{background:color-mix(in srgb,var(--warn) 9%,transparent);padding:8px;border-radius:6px}
.mi .mi-it.off .mi-nums,.mi .mi-it.off .mi-top input{opacity:.5}
.mi .mi-top{display:flex;gap:6px;align-items:center}
.mi .mi-top input{flex:1;min-width:0}
.mi .mi-nums{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) minmax(0,1.3fr);gap:6px;margin-top:6px}
.mi .mi-nums label{display:flex;flex-direction:column;font-size:.72rem;color:var(--muted);gap:2px}
.mi input.mi-in,.mi select.mi-in{width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--line);background:var(--sunk);color:var(--ink);border-radius:6px;padding:6px;font:inherit;font-size:.9rem}
.mi input.n{font-family:var(--mono);text-align:right}
.mi .mi-why{font-size:.8rem;color:var(--warn);margin-top:4px}
.mi .mi-ban{font-size:.8rem;color:var(--bad);margin-top:4px}
.mi .mi-sub{font-size:.85rem}
`;

  function itemsTable(items, dislikes) {
    const tagged = annotate(items, { bannedReason: makeBanned(H.engine, dislikes), likeOf: H.engine.likeOf });
    const flagged = tagged.filter(it => it.needsCheck && !it.banned).length;
    const rows = tagged.map((it, i) => {
      const cls = it.banned ? 'off' : it.needsCheck ? 'flag' : '';
      const n = (k, label) => `<label>${label}<input class="mi-in n" inputmode="decimal" data-mik="${k}" data-i="${i}" value="${it[k] == null ? '' : esc(it[k])}" aria-label="${label} for ${esc(it.name)}"></label>`;
      return `<div class="mi-it ${cls}">
        <div class="mi-top"><input class="mi-in" data-mik="name" data-i="${i}" value="${esc(it.name)}" aria-label="Name">
          ${!it.banned && it.needsCheck && complete(it) ? `<button class="btn small" data-mi="ok" data-i="${i}" title="The numbers match the menu">OK</button>` : ''}
          <button class="btn ghost small" data-mi="skip" data-i="${i}" title="${it.skip ? 'Use it again' : 'Leave it out'}" aria-label="${it.skip ? 'Use it again' : 'Leave it out'}">${it.skip ? 'Use' : '✕'}</button></div>
        <div class="mi-nums">${n('kcal', 'kcal')}${n('protein', 'Protein')}${n('carbs', 'Carbs')}${n('fat', 'Fat')}
          <label>Type<select class="mi-in" data-mik="section" data-i="${i}">${SECTIONS.map(s => `<option${s === it.section ? ' selected' : ''}>${s}</option>`).join('')}</select></label></div>
        ${it.banned ? `<div class="mi-ban">Won't be picked: ${esc(it.bannedReason)}</div>` : ''}
        ${!it.banned && it.needsCheck ? `<div class="mi-why">Check: ${esc(it.checkReasons.join('; '))}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="mi-list">${rows}</div>
      ${flagged ? `<p class="mi-sub"><b>${flagged} item${flagged > 1 ? 's need' : ' needs'} a check.</b> Compare with the menu and tap OK, or fix the number. <button class="btn ghost small" data-mi="okall">All match the menu</button></p>` : ''}`;
  }

  function resultHtml(res) {
    if (!res) return '';
    const line = it => `<li>${esc(it.name)} <span class="muted num" style="font-size:.85rem">${r0(it.kcal)} kcal · ${r0(it.p)} P</span>${it.needsCheck ? ' <span class="pill warn">unconfirmed</span>' : ''}</li>`;
    const fixedLines = (res.fixed || []).map(x => `<li class="muted">${esc(x.name)} <span class="num" style="font-size:.85rem">${r0(x.kcal)} kcal · ${r0(x.p)} P${x.estimate ? ' (estimate)' : ''}</span></li>`).join('');
    return `${res.notes.length ? `<p class="muted mi-sub">${res.notes.map(esc).join(' ')}</p>` : ''}
      ${res.skipped.length ? `<p class="muted mi-sub">Left out: ${res.skipped.map(s => `${esc(s.name)} (${esc(s.reason)})`).join(', ')}</p>` : ''}
      ${res.error ? `<p class="note">${esc(res.error)}</p>` : ''}
      ${res.options.map((o, i) => `<div class="ex">
        <div class="spread"><b>${i === 0 ? 'Best option' : 'Option ' + (i + 1)}</b><span class="pill ${o.check.fits ? 'good' : 'warn'}">${o.check.fits ? 'Fits' : 'Closest'}</span></div>
        <ul style="margin:0;padding-left:1.1em">${line(o.meal1)}${line(o.meal2)}${o.snacks.map(line).join('')}${fixedLines}</ul>
        <div class="row"><span class="num" style="font-size:.9rem">Total ${r0(o.totals.kcal)} kcal · ${r0(o.totals.p)} P · ${r0(o.totals.c)} C · ${r0(o.totals.f)} F</span><button class="btn small" data-mi="use" data-i="${i}">Plan this day</button></div>
        <p class="muted mi-sub">${esc(o.check.verdict)}</p>
      </div>`).join('')}`;
  }

  function html(date) {
    if (!H) return '';
    sync();
    const bans = H.dislikes();
    const accept = 'application/pdf,.pdf' + (ST.canImage === false ? '' : ',image/*');
    const T = H.engine.targetsFrom ? H.engine.targetsFrom(H.targets ? H.targets(date) : null) : H.engine.TARGETS;
    return `<div class="card mi">
      <div class="spread"><h3>Plan my day from a menu</h3><span class="muted" style="font-size:.85rem">2 meals + 2 snacks${ST.opts.adonis ? ' + Adonis' : ''}</span></div>
      <p class="muted mi-sub">Upload a restaurant or meal-prep menu as a PDF${ST.canImage === false ? '' : ' or screenshots'}, or paste its text. The best combo for ~${T.kcal.toLocaleString('en-US')} kcal and ${T.proteinMin}–${T.proteinMax} g protein is picked from it; never-pick foods are left out.</p>
      <div class="mi-drop">
        <label class="btn mi-file">${ST.items ? 'Upload another menu' : 'Upload menu'}<input type="file" id="miFile" accept="${accept}" multiple${ST.busy ? ' disabled' : ''}></label>
        <button class="btn ghost small" data-mi="paste">${ST.showText ? 'Hide text box' : 'Paste text'}</button>
        ${ST.items ? `<button class="btn ghost small" data-mi="clear">Clear menu</button>` : ''}
      </div>
      ${ST.showText ? `<textarea id="miText" rows="5" style="width:100%;margin-top:8px;border:1px solid var(--line);background:var(--sunk);color:var(--ink);border-radius:8px;padding:8px;font-family:var(--mono);font-size:.85rem" placeholder="Snacks&#10;Name  kcal  protein  carbs  fat&#10;or the Menu Reader's Copy JSON">${esc(ST.text)}</textarea><div class="row"><button class="btn small" data-mi="readtext">Read this text</button></div>` : ''}
      ${ST.busy ? `<p class="muted mi-sub" aria-live="polite">${esc(ST.busy)} ${ST.ctl ? '<button class="btn ghost small" data-mi="stop">Stop</button>' : ''}</p>` : ''}
      ${ST.error ? `<p class="note">${esc(ST.error)}</p>` : ''}
      ${ST.warnings.length ? `<p class="muted mi-sub">${ST.warnings.map(esc).join(' ')}</p>` : ''}
      ${ST.items && ST.items.length ? `${itemsTable(ST.items, bans)}
        <div class="row" style="flex-wrap:wrap;gap:12px">
          <label class="mi-sub"><input type="checkbox" id="miAdonis"${ST.opts.adonis ? ' checked' : ''}> Adonis cookie dough</label>
          <label class="mi-sub"><input type="checkbox" id="miConfirmed"${ST.opts.onlyConfirmed ? ' checked' : ''}> Only use checked numbers</label>
          <button class="btn" data-mi="go">Find the best combo</button>
        </div>
        ${resultHtml(ST.result)}` : ''}
    </div>`;
  }

  return { SECTIONS, makeBanned, containsPhrase, parseText, linesFromTextContent, textFromPdf, pdfPageImages, readPrompt, parseRead, check, annotate, optimize, toRecord, fromRecord, errorText, css, bind, html, _state: ST };
});
