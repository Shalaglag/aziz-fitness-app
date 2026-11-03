/* nippard-programs: ready-made programs from Jeff Nippard's published plans for Train > New template,
 * plus "Jeff Nippard says" quotes on the matching exercises.
 * Data: programs.json (window.NIPPARD_PROGRAMS) and tips.json (window.NIPPARD_TIPS). Plain JS, no imports.
 * API:
 *   NippardPrograms.create(data, opts?) -> { list(), get(id), templates(id, opts?), size }
 *     list(): [{id, name, source, level, days, time, blurb, workouts: n, exercises: n}]
 *     templates(id, {unit, folder, order}) -> workout-logger templates (one per workout day), ids `np-<program>-<n>`.
 *   NippardPrograms.tips(data) -> { find(exId), inlineHtml(exId), detailHtml(exId), css, size }
 */
const NippardPrograms = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function create(data, opts) {
    const programs = (data && data.programs) || [];
    const byId = {}; programs.forEach(p => { byId[p.id] = p; });
    function list() {
      return programs.map(p => ({ id: p.id, name: p.name, source: p.source, level: p.level, days: p.days, time: p.time, blurb: p.blurb, workouts: p.workouts.length, exercises: p.workouts.reduce((n, w) => n + w.exercises.length, 0) }));
    }
    const get = id => byId[id] || null;
    // One logger template per workout day. Sets are copied (warm-ups as t:'w'), supersets keep their group, rest in seconds.
    function templates(id, o) {
      const p = byId[id]; if (!p) return [];
      o = o || {};
      const unit = o.unit || 'kg', folder = o.folder || p.name, base = o.order || 0;
      return p.workouts.map((w, i) => ({
        id: 'np-' + p.id + '-' + (i + 1), name: w.name, folder, order: base + i,
        notes: (i === 0 ? p.blurb + ' ' : '') + 'From ' + p.source + '.',
        exercises: w.exercises.map(e => {
          const ex = { exId: e.ex, unit, notes: e.notes || '', sets: e.sets.map(s => Object.assign({}, s)) };
          if (e.rest) ex.rest = e.rest;
          if (e.ss) ex.ss = 'np-' + p.id + '-' + (i + 1) + '-' + e.ss;
          return ex;
        })
      }));
    }
    return { list, get, templates, size: programs.length };
  }

  const CSS = '.nt-inline{margin:.35rem 0 .2rem;border:1px solid var(--line,#ddd);border-radius:var(--r,10px);background:var(--sunk,rgba(0,0,0,.03));padding:0 .6rem}' +
    '.nt-inline summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:.5rem;padding:.45rem 0;font-size:.85rem}.nt-inline summary::-webkit-details-marker{display:none}' +
    '.nt-inline summary>span:first-child,.nt-detail h4{font-weight:600}.nt-peek{color:var(--muted,#777);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:italic}' +
    '.nt-q{margin:.3rem 0 .55rem;padding-left:.6rem;border-left:3px solid var(--accent,#2b8a3e);font-size:.88rem;line-height:1.4}.nt-q p{margin:0 0 .15rem}.nt-q cite{display:block;font-style:normal;font-size:.75rem;color:var(--muted,#777)}' +
    '.nt-kind{display:inline-block;font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--accent,#2b8a3e);font-weight:600;margin-right:.35rem}' +
    '.nt-detail{margin-top:1rem}.nt-detail h4{margin:0 0 .4rem}';
  const KIND = { tip: 'Tip', machine: 'Machine note', fact: 'Fun fact' };

  function tips(data) {
    const all = (data && data.tips) || {}, srcs = (data && data._sources) || {};
    const find = exId => all[exId] || all[slug(exId)] || null;
    const quote = t => '<blockquote class="nt-q"><p><span class="nt-kind">' + esc(KIND[t.kind] || 'Tip') + '</span>“' + esc(t.q) + '”</p><cite>— Jeff Nippard, ' + esc(srcs[t.src] || t.src || '') + '</cite></blockquote>';
    function inlineHtml(exId) {
      const list = find(exId); if (!list || !list.length) return '';
      return '<details class="nt-inline"><summary><span>Jeff Nippard says</span><span class="nt-peek">' + esc(list[0].q) + '</span></summary>' + list.map(quote).join('') + '</details>';
    }
    function detailHtml(exId) {
      const list = find(exId); if (!list || !list.length) return '';
      return '<section class="nt-detail"><h4>Jeff Nippard says</h4>' + list.map(quote).join('') + '</section>';
    }
    return { find, inlineHtml, detailHtml, css: CSS, size: Object.keys(all).length };
  }

  return { create, tips, slug };
})();
if (typeof module !== 'undefined') module.exports = NippardPrograms;
