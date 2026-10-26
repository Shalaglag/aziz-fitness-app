/* ExerciseDemos: one demo registry for every exercise, keyed by workout-logger exercise id.
   Plain JS, no imports, no network. A demo is shown only when a person checked it and its
   equipment matches the exercise, so a cable clip never stands in for a machine or dumbbell lift.
   Usage: const demos = ExerciseDemos.create(window.EXERCISE_DEMOS, { library: WorkoutLogger.library });
          demos.link('seated-row-machine') -> { href, label, verified } */
(function (root) {
  'use strict';

  const STATUSES = ['verified', 'review', 'missing', 'incorrect', 'replace'];
  const ITEM_STATUSES = ['verified', 'review', 'incorrect', 'replace'];
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const norm = s => String(s || '').trim().toLowerCase();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isHttps = u => /^https:\/\/[^\s"'<>]+$/.test(String(u || ''));
  // Self-hosted clips are published next to the app, so a relative path is fine for videos.
  const isLocal = u => /^[a-z0-9][a-z0-9._\/-]*\.(mp4|webm)$/i.test(String(u || ''));
  const okUrl = it => it && (isHttps(it.url) || (it.kind === 'video' && isLocal(it.url)));
  const checked = it => !!(it && it.status === 'verified' && it.checkedBy && it.checkedAt && okUrl(it));

  function searchUrl(name) {
    // Keep the equipment words ("Seated Row Machine") so results show the right variation.
    const q = String(name || '').replace(/[()]/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' proper form');
  }

  function create(data, opts) {
    opts = opts || {};
    const demos = (data && data.demos) || {};
    const library = opts.library || {};
    const byKey = {};
    Object.keys(demos).forEach(id => {
      const e = demos[id];
      [id, e.name].forEach(n => { if (n) byKey[slug(n)] = id; });
    });
    // Aliases are exact alternative names (Strong / plan names). They never override a real id or name.
    Object.keys(demos).forEach(id => (demos[id].aliases || []).forEach(a => { if (!byKey[slug(a)]) byKey['@' + norm(a)] = id; }));

    // Exact matches only: id, name, or a listed alias. No fuzzy matching.
    function id(idOrName) {
      if (!idOrName) return null;
      if (demos[idOrName]) return idOrName;
      return byKey[slug(idOrName)] || byKey['@' + norm(idOrName)] || null;
    }
    const entry = idOrName => { const k = id(idOrName); return k ? demos[k] : null; };

    // The entry's equipment must agree with the logger library (when the library has the exercise).
    function equipOk(k) {
      const e = demos[k], lib = library[k];
      return !!e && (!lib || norm(lib.cat) === norm(e.equipment));
    }

    function status(idOrName) {
      const k = id(idOrName), e = k && demos[k];
      if (!e) return 'missing';
      const items = e.items || [];
      if (items.some(it => it.status === 'incorrect')) return 'incorrect';
      if (items.some(checked) && equipOk(k)) return 'verified';
      if (items.some(it => it.status === 'replace')) return 'replace';
      if (items.some(it => it.status === 'review' || it.status === 'verified')) return 'review';
      return 'missing';
    }

    // Verified items only, and only when equipment matches. `angle` picks front/side when there is one.
    function verified(idOrName) {
      const k = id(idOrName);
      if (!k || !equipOk(k) || status(k) === 'incorrect') return [];
      return (demos[k].items || []).filter(checked);
    }
    function best(idOrName, angle) {
      const v = verified(idOrName);
      return (angle && v.find(it => it.angle === angle)) || v.find(it => it.kind === 'video') || v[0] || null;
    }
    // Links someone found but nobody has checked yet. Never presented as a demo.
    function candidates(idOrName) {
      const k = id(idOrName);
      return k ? (demos[k].items || []).filter(it => it.status === 'review' && okUrl(it)) : [];
    }

    // What the "Demo" button should do for an exercise. `name` is used when the id is unknown (custom lifts).
    function link(idOrName, name) {
      const b = best(idOrName);
      if (b) return { href: b.url, label: 'Demo ↗', verified: true, item: b };
      const e = entry(idOrName);
      return { href: searchUrl((e && e.name) || name || idOrName), label: 'Search demos ↗', verified: false, item: null };
    }

    function summary() {
      const out = { total: 0 };
      STATUSES.forEach(s => { out[s] = 0; });
      Object.keys(demos).forEach(k => { out.total++; out[status(k)]++; });
      return out;
    }

    // Problems a person must fix before a demo can be trusted.
    function validate() {
      const problems = [];
      const urlOwners = {};
      Object.keys(library).forEach(k => { if (!demos[k]) problems.push({ id: k, problem: 'Library exercise has no registry entry' }); });
      Object.keys(demos).forEach(k => {
        const e = demos[k];
        if (!STATUSES.includes(e.status || 'missing')) problems.push({ id: k, problem: 'Unknown entry status ' + e.status });
        if (!equipOk(k)) problems.push({ id: k, problem: 'Equipment "' + e.equipment + '" does not match the library ("' + library[k].cat + '")' });
        (e.items || []).forEach((it, i) => {
          const at = k + ' item ' + (i + 1);
          if (!ITEM_STATUSES.includes(it.status)) problems.push({ id: k, problem: at + ': unknown status ' + it.status });
          if (!okUrl(it)) problems.push({ id: k, problem: at + ': URL must be https (or a local .mp4/.webm clip)' });
          if (it.status === 'verified' && !(it.checkedBy && it.checkedAt)) problems.push({ id: k, problem: at + ': verified without checkedBy and checkedAt' });
          if (it.kind === 'video' && !it.licence) problems.push({ id: k, problem: at + ': video file without a licence' });
          if (it.url && it.status !== 'incorrect') (urlOwners[it.url] = urlOwners[it.url] || []).push(k);
        });
      });
      Object.keys(urlOwners).forEach(u => {
        const owners = [...new Set(urlOwners[u])];
        const equips = [...new Set(owners.map(k => norm(demos[k].equipment)))];
        if (equips.length > 1) problems.push({ id: owners.join(', '), problem: 'Same URL used for different equipment: ' + u });
      });
      return problems;
    }

    // Small block for the exercise sheet: verified demos, then unchecked finds, then the search.
    function sheetHtml(idOrName, name) {
      const k = id(idOrName), v = verified(idOrName), c = candidates(idOrName), st = status(idOrName);
      const row = (it, cls, tag) => '<li><a class="ed-link ' + cls + '" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(it.title || it.source || 'Video') + ' ↗</a><small>' + esc([it.angle ? it.angle + ' view' : '', it.source, tag].filter(Boolean).join(' · ')) + '</small></li>';
      return '<section class="ed-sheet"><h4>Demo video</h4>' +
        (v.length ? '<ul>' + v.map(it => row(it, 'ok', 'checked ' + it.checkedAt)).join('') + '</ul>'
          : '<p class="ed-muted">' + (st === 'incorrect' ? 'The saved video was marked wrong for this exercise.' : 'No checked video for this exercise yet.') + '</p>') +
        (c.length ? '<p class="ed-lbl">Found, not checked yet</p><ul>' + c.map(it => row(it, 'unchecked', 'check equipment and range of motion')).join('') + '</ul>' : '') +
        '<a class="ed-link" href="' + esc(searchUrl((k && demos[k].name) || name || idOrName)) + '" target="_blank" rel="noopener noreferrer">Search YouTube ↗</a></section>';
    }

    return { id, entry, status, verified, best, candidates, link, summary, validate, sheetHtml, searchUrl, css, size: Object.keys(demos).length };
  }

  const css = [
    '.ed-sheet{margin-top:1rem}.ed-sheet h4{margin:0 0 .3rem}',
    '.ed-sheet ul{margin:.2rem 0 .5rem;padding-left:1.15rem}.ed-sheet li{margin:.2rem 0}',
    '.ed-sheet small{display:block;color:var(--muted);font-size:.78rem}',
    '.ed-link{font-size:.85rem;font-weight:600;color:var(--accent)}',
    '.ed-link.unchecked{color:var(--ink)}',
    '.ed-lbl{margin:.45rem 0 .1rem;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warn)}',
    '.ed-muted{color:var(--muted);font-size:.85rem;margin:.2rem 0}'
  ].join('\n');

  const api = { create, searchUrl, slug, STATUSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ExerciseDemos = api;
})(typeof window !== 'undefined' ? window : globalThis);
