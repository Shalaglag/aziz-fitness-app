/* FormCues: technique cues, injury watch-outs, muscles worked and a demo link for
   each exercise, built from exercise-form-guide.json. Plain JS, no imports, no network.
   Usage: const fc = FormCues.create(guideJson); fc.find('bench-press-barbell') -> entry */
(function (root) {
  'use strict';

  // Workout logger (Liftbook) exercise ids -> form guide ids, for names the fuzzy match misses.
  const ALIASES = {
    'bench-press-barbell': 'bench-press', 'incline-bench-press-dumbbell': 'incline-db-press',
    'gundam-chest-press-machine': 'gundam-chest-press', 'seated-overhead-press-dumbbell': 'seated-db-ohp',
    'lateral-raise-dumbbell': 'lateral-raise', 'lateral-raise-cable': 'lateral-raise', 'side-delts': 'lateral-raise',
    'standing-lateral-raise-machine': 'machine-lateral-raise', 'front-raise-dumbbell': 'front-raise-db',
    'triceps-extension-cable': 'cable-overhead-triceps-extension', 'triceps-pushdown-straight-bar': 'straight-bar-pushdown',
    'triceps-rope-pushdown-cable': 'rope-pushdown', 'lat-pulldown-wide-grip-cable': 'wide-lat-pulldown',
    'lat-pulldown-single-arm-cable': 'single-arm-lat-pulldown', 'seated-row-cable': 'seated-cable-row',
    'pullover-machine': 'machine-pullover', 'iso-lateral-low-row-plate-loaded': 'iso-lateral-low-row',
    'shrug-machine': 'traps-machine', 'bicep-curl-dumbbell': 'db-curl', 'seated-bicep-curl-machine': 'seated-machine-curl',
    'standing-bicep-curl-cable': 'cable-curl', 'hack-squat-machine': 'hack-squat', 'squat-smith-machine': 'smith-squat',
    'leg-extension-machine': 'leg-extension', 'lying-leg-curl-machine': 'lying-leg-curl',
    'hip-adductor-machine': 'hip-adductor', 'hip-abductor-machine': 'hip-abductor',
    'standing-calf-raise-machine': 'standing-calf-raise', 'calf-press-leg-press': 'leg-press-calf-raise',
    'seated-abs-machine': 'seated-ab-crunch', 'treadmill-incline-walk': 'incline-treadmill-walk'
  };

  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Loose key: "Incline Bench Press (Dumbbell)" and "Incline DB Press" both -> "incline-db-press".
  const loose = s => slug(String(s || '').toLowerCase()
    .replace(/dumbbells?/g, 'db').replace(/barbell/g, 'bb').replace(/\bbiceps?\b/g, 'bicep')
    .replace(/\((machine|cable|plate[- ]loaded|plate)\)/g, '').replace(/\bbench\b(?= press)/g, ''));
  // Equipment named in a logger name or id: "Seated Row (Machine)" / "seated-row-machine" -> "machine".
  const EQUIP = { 'smith-machine': 'smith', 'plate-loaded': 'plate', 'ez-bar': 'ez', machine: 'machine', cable: 'cable', dumbbell: 'db', barbell: 'bb' };
  const equipOf = s => {
    const m = String(s || '').match(/\(([^)]*)\)\s*$/), k = m ? slug(m[1]) : slug(s);
    const hit = Object.keys(EQUIP).find(e => m ? k === e : k.endsWith('-' + e));
    return hit ? EQUIP[hit] : null;
  };
  // A loose match only counts when the entry was written for that equipment, so a machine row never gets cable row cues.
  const equipFits = (input, e) => {
    const want = equipOf(input);
    if (!want) return true;
    const text = loose([e.name].concat(e.loggedAs || [], e.equipment || '').join(' ').replace(/\(([^)]*)\)/g, ' $1 '));
    return new RegExp('(^|-)' + want + '(-|$)').test(text) || (want === 'plate' && /plate/.test(text));
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const list = a => '<ul>' + a.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';

  function demoUrl(entry) {
    if (!entry) return '';
    return entry.demo || '';
  }

  // "Watch a demo" shows only when opts.demoLinks is true and the entry has its own demo URL. There is no search fallback: the app shows built-in animations instead.
  function create(guide, opts) {
    const showDemo = !!(opts && opts.demoLinks === true);
    const exercises = (guide && guide.exercises) || [];
    const byId = {}, byKey = {};
    exercises.forEach(e => {
      byId[e.id] = e;
      [e.id, e.name].concat(e.loggedAs || []).forEach(n => {
        if (!byKey[slug(n)]) byKey[slug(n)] = e;
        if (!byKey['~' + loose(n)]) byKey['~' + loose(n)] = e;
      });
    });
    Object.keys(ALIASES).forEach(k => { if (byId[ALIASES[k]]) byKey[k] = byId[ALIASES[k]]; });

    const open = new Set();
    let bound = false;

    function find(idOrName) {
      if (!idOrName) return null;
      const s = slug(idOrName);
      if (byId[s] || byKey[s]) return byId[s] || byKey[s];
      const e = byKey['~' + loose(idOrName)];
      return e && equipFits(idOrName, e) ? e : null;
    }

    function muscles(entry) {
      if (!entry) return '';
      return '<p class="fc-muscles"><span class="fc-lbl">Muscles</span>' +
        (entry.primary || []).map(m => '<span class="fc-chip p">' + esc(m) + '</span>').join('') +
        (entry.secondary || []).map(m => '<span class="fc-chip">' + esc(m) + '</span>').join('') + '</p>';
    }
    const demo = entry => !showDemo || !demoUrl(entry) ? '' : '<a class="fc-demo" href="' + esc(demoUrl(entry)) + '" target="_blank" rel="noopener noreferrer">Watch a demo ↗</a>';

    // Collapsed panel for the live workout card. `key` keeps it open across re-renders.
    function inlineHtml(entry, key) {
      if (!entry) return '';
      key = key || entry.id;
      return '<details class="fc-inline" data-fc="' + esc(key) + '"' + (open.has(key) ? ' open' : '') + '>' +
        '<summary><span>Form cues</span><span class="fc-peek">' + esc((entry.cues || [])[0] || '') + '</span></summary>' +
        '<div class="fc-body">' + list(entry.cues || []) +
        ((entry.mistakes || []).length ? '<p class="fc-lbl warn">Watch for</p>' + list(entry.mistakes.slice(0, 2)) : '') +
        (entry.note ? '<p class="fc-note">' + esc(entry.note) + '</p>' : '') +
        muscles(entry) + demo(entry) + '</div></details>';
    }

    // Full section for the exercise detail sheet.
    function detailHtml(entry) {
      if (!entry) return '';
      return '<section class="fc-detail"><h4>How to do it</h4>' + muscles(entry) +
        (entry.equipment ? '<p class="fc-muted">' + esc(entry.equipment) + '</p>' : '') +
        '<p class="fc-lbl">Cues</p>' + list(entry.cues || []) +
        ((entry.setup || []).length ? '<p class="fc-lbl">Setup</p>' + list(entry.setup) : '') +
        ((entry.steps || []).length ? '<p class="fc-lbl">The rep</p><ol>' + entry.steps.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' : '') +
        ((entry.mistakes || []).length ? '<p class="fc-lbl warn">Injury watch-outs</p>' + list(entry.mistakes) : '') +
        (entry.note ? '<p class="fc-note">' + esc(entry.note) + '</p>' : '') + demo(entry) + '</section>';
    }

    // <details> toggle does not bubble, so listen in the capture phase once.
    function attach(doc) {
      doc = doc || (typeof document !== 'undefined' ? document : null);
      if (!doc || bound) return;
      bound = true;
      doc.addEventListener('toggle', ev => {
        const d = ev.target;
        if (!d || !d.matches || !d.matches('details.fc-inline')) return;
        const k = d.getAttribute('data-fc');
        if (d.open) open.add(k); else open.delete(k);
      }, true);
    }

    return { find, demoUrl, muscles, inlineHtml, detailHtml, attach, css, principles: (guide && guide.principles) || [], size: exercises.length };
  }

  const css = [
    '.fc-inline{margin:.35rem 0 .5rem;border:1px solid var(--line);border-radius:var(--r,10px);background:var(--sunk)}',
    '.fc-inline>summary{list-style:none;cursor:pointer;display:flex;gap:.5rem;align-items:baseline;padding:.45rem .65rem;font-size:.85rem;font-weight:600;color:var(--accent)}',
    '.fc-inline>summary::-webkit-details-marker{display:none}',
    '.fc-inline>summary::before{content:"▸";transition:transform .15s}.fc-inline[open]>summary::before{transform:rotate(90deg)}',
    '.fc-peek{flex:1;min-width:0;font-weight:400;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fc-inline[open] .fc-peek{display:none}',
    '.fc-body{padding:0 .75rem .65rem;font-size:.85rem;color:var(--ink)}',
    '.fc-body ul,.fc-detail ul,.fc-detail ol{margin:.2rem 0 .45rem;padding-left:1.15rem}.fc-body li,.fc-detail li{margin:.12rem 0}',
    '.fc-lbl{margin:.45rem 0 .1rem;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}',
    '.fc-lbl.warn{color:var(--warn)}',
    '.fc-muscles{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center;margin:.45rem 0}.fc-muscles .fc-lbl{margin:0 .2rem 0 0}',
    '.fc-chip{font-size:.75rem;padding:.1rem .5rem;border-radius:999px;border:1px solid var(--line);color:var(--muted)}',
    '.fc-chip.p{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}',
    '.fc-note{margin:.4rem 0;padding:.4rem .55rem;border-left:3px solid var(--warn);background:var(--surface);font-size:.82rem}',
    '.fc-demo{display:inline-block;margin-top:.25rem;font-size:.85rem;font-weight:600;color:var(--accent)}',
    '.fc-detail{margin-top:1rem}.fc-detail h4{margin:0 0 .3rem}.fc-muted{color:var(--muted);font-size:.85rem;margin:.2rem 0}'
  ].join('\n');

  const api = { create, demoUrl, css, aliases: ALIASES, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FormCues = api;
})(typeof window !== 'undefined' ? window : globalThis);
