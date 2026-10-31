/* Voice logging for the Aziz Cut Tracker: say a set ("bench 60 for 10, 10, 8") or a meal ("had a chicken shawarma").
 * Plain JS, no imports, no network. Speech comes from the browser's SpeechRecognition when the page is allowed a
 * microphone; otherwise the same box takes Android keyboard voice typing (the mic on Gboard). Either way the text
 * goes through the same parser, so the tests cover the whole path after the microphone.
 * API:
 *   VoiceLog.parse(text, opts)        -> [{ exercise, candidates, sure, weight, unit, reps, sets, km, min, raw }]
 *        opts = { exercises: [{id, name, cat}], current: exId, prefer: [exId], unit: "kg"|"lb" }
 *        One entry per exercise mentioned ("bench 60 for 10 10 8 then lat pulldown 55 for 12 12" -> 2 entries).
 *        exercise is null when nothing in the library matched (and no `current` to fall back on).
 *   VoiceLog.matchExercise(phrase, exercises, opts) -> { best, candidates:[{ex, score}] }
 *   VoiceLog.toSets(entry, exercise)  -> [{t:'n', w, r, km, min, sec, done:true}] in the logger's set shape
 *   VoiceLog.words(text)              -> text with number words turned into digits ("sixty for ten" -> "60 for 10")
 *   VoiceLog.speech.supported()       -> true when the browser has SpeechRecognition
 *   VoiceLog.speech.start({ onText(text, final), onEnd(), onError(code) }) -> { stop() }
 *   VoiceLog.open({ exercises, current, prefer, unit, onApply(entries) }) -> opens the "Log by voice" sheet (Train)
 *   VoiceLog.foodCardHtml()           -> Food tab card with the mic; VoiceLog.bindFood(root, { onText }) wires it once
 *   VoiceLog.css                      -> string, inject once (uses the app's tokens)
 */
const VoiceLog = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const r1 = n => Math.round(n * 10) / 10;

  // ---------- number words ----------
  const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const HALF = { half: 0.5, quarter: 0.25 };
  function words(text) {
    const toks = String(text || "").toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
    const out = []; let acc = null;
    const flush = () => { if (acc != null) { out.push(String(acc)); acc = null; } };
    const push = (punct) => { if (punct) { flush(); out.push(punct); } };
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i].replace(/[,.;:!?]+$/, ""), punct = toks[i].slice(w.length);
      if (w in ONES) { if (acc != null && !((acc >= 20 && acc % 10 === 0) || (acc >= 100 && acc % 100 === 0))) flush(); acc = (acc || 0) + ONES[w]; push(punct); continue; }
      if (w in TENS) { if (acc != null && !(acc >= 100 && acc % 100 === 0)) flush(); acc = (acc || 0) + TENS[w]; push(punct); continue; }
      if (w === "hundred") { if (acc != null && acc < 100) acc = acc * 100; else { flush(); acc = 100; } push(punct); continue; }
      if (w === "and" && acc != null && acc >= 100 && toks[i + 1] && (toks[i + 1].replace(/[,.;:!?]+$/, "") in ONES || toks[i + 1].replace(/[,.;:!?]+$/, "") in TENS)) continue;
      if (w === "a" && acc == null && toks[i + 1] && toks[i + 1].replace(/[,.;:!?]+$/, "") in HALF) continue;
      if (w in HALF) { if (acc != null) { acc += HALF[w]; } else acc = HALF[w]; flush(); push(punct); continue; }
      flush(); out.push(toks[i]);
    }
    flush();
    return out.join(" ").replace(/ ([,.;:!?])/g, "$1").replace(/(\d) point (\d)/g, "$1.$2").replace(/(\d) and a half\b/g, "$1.5").replace(/(\d) and 0.5\b/g, "$1.5");
  }

  // ---------- exercise matching ----------
  const SYN = {
    bench: ["bench", "press"], flat: ["bench"], db: ["dumbbell"], dumbbells: ["dumbbell"], bb: ["barbell"], bar: ["barbell"],
    pulldown: ["pulldown"], pulldowns: ["pulldown"], "pull-down": ["pulldown"], lats: ["lat"], lat: ["lat", "pulldown"],
    ohp: ["overhead", "press"], overhead: ["overhead", "press"], shoulder: ["overhead", "shoulder", "press"], military: ["overhead", "press"],
    rdl: ["romanian", "deadlift"], rdls: ["romanian", "deadlift"], romanian: ["romanian", "deadlift"],
    curls: ["curl"], curl: ["curl"], biceps: ["bicep", "curl"], bicep: ["bicep", "curl"], tris: ["triceps"], tricep: ["triceps"],
    pushdown: ["pushdown"], pushdowns: ["pushdown"], rope: ["rope", "pushdown"], skullcrusher: ["skull", "crusher"], skullcrushers: ["skull", "crusher"],
    rows: ["row"], row: ["row"], squats: ["squat"], squat: ["squat"], hack: ["hack", "squat"], smith: ["smith"],
    lateral: ["lateral", "raise"], laterals: ["lateral", "raise"], side: ["lateral", "raise"], delts: ["lateral", "raise"], delt: ["lateral", "raise"],
    raises: ["raise"], ext: ["extension"], extensions: ["extension"], extension: ["extension"], quad: ["leg", "extension"],
    ham: ["leg", "curl"], hamstring: ["leg", "curl"], hamstrings: ["leg", "curl"],
    pullups: ["pull", "up"], pullup: ["pull", "up"], chinups: ["chin", "up"], chinup: ["chin", "up"], pushups: ["push", "up"], pushup: ["push", "up"],
    dips: ["dip"], dip: ["dip"], flys: ["fly"], flies: ["fly"], fly: ["fly"], pec: ["pec", "deck"], crossover: ["crossover"], crossovers: ["crossover"],
    treadmill: ["treadmill"], walk: ["treadmill", "walk"], walking: ["treadmill", "walk"], incline: ["incline"], run: ["treadmill", "run"], running: ["treadmill", "run"],
    bike: ["bike"], cycling: ["bike"], elliptical: ["elliptical"], stairs: ["stair", "climber"], stairmaster: ["stair", "climber"], rowing: ["rowing", "machine"],
    abs: ["abs"], ab: ["abs"], crunches: ["crunch"], crunch: ["crunch"], plank: ["plank"], calves: ["calf"], calf: ["calf"], shrugs: ["shrug"], shrug: ["shrug"],
    adductor: ["adductor"], adductors: ["adductor"], abductor: ["abductor"], abductors: ["abductor"], abduction: ["abductor"], adduction: ["adductor"],
    machine: ["machine"], cable: ["cable"], cables: ["cable"], gundam: ["gundam"], preacher: ["preacher"], hammer: ["hammer"], face: ["face", "pull"], facepull: ["face", "pull"], facepulls: ["face", "pull"],
    deadlift: ["deadlift"], deadlifts: ["deadlift"], thrust: ["hip", "thrust"], thrusts: ["hip", "thrust"], glute: ["glute"], glutes: ["glute"], lunges: ["lunge"], lunge: ["lunge"],
    chest: ["chest"], back: ["back"], wide: ["wide"], close: ["close"], single: ["single", "arm"], "one": ["single"], seated: ["seated"], standing: ["standing"], lying: ["lying"]
  };
  const STOP = new Set(["the", "a", "an", "on", "at", "with", "of", "my", "i", "did", "do", "some", "set", "sets", "rep", "reps", "kg", "kilo", "kilos", "kilogram", "kilograms", "lb", "lbs", "pound", "pounds", "for", "x", "by", "times", "each", "and", "then", "log", "add", "to", "grip", "arm"]);
  const stem = w => w.replace(/ies$/, "y").replace(/(?<![su])s$/, "");
  const norm = s => String(s || "").toLowerCase().replace(/[()\-,/]+/g, " ").replace(/[^a-z0-9. ]+/g, " ").split(/\s+/).filter(Boolean);
  const exTokens = ex => { const t = new Set(norm(ex.name).map(stem)); if (ex.part) norm(ex.part).forEach(x => t.add(stem(x))); return t; };
  const phraseTokens = phrase => { const out = new Set(); norm(phrase).forEach(w => { if (STOP.has(w) || /^\d/.test(w)) return; const s = stem(w); out.add(s); (SYN[w] || SYN[s] || []).forEach(x => out.add(stem(x))); }); return out; };

  function matchExercise(phrase, exercises, opts = {}) {
    const want = phraseTokens(phrase);
    if (!want.size || !exercises || !exercises.length) return { best: null, candidates: [] };
    const prefer = new Set(opts.prefer || []);
    const scored = exercises.map(ex => {
      const have = exTokens(ex);
      let hit = 0; want.forEach(t => { if (have.has(t)) hit++; });
      if (!hit) return null;
      // Share of the request matched, then how much of the exercise's name the request covers (so "bench" prefers the plain barbell bench).
      let score = hit / want.size + 0.35 * (hit / have.size);
      if (prefer.has(ex.id)) score += 0.3;
      if (ex.id === opts.current) score += 0.15;
      if (ex.avoided) score -= 0.1;
      return { ex, score: Math.round(score * 1000) / 1000 };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.ex.name.length - b.ex.name.length);
    const best = scored[0] ? scored[0].ex : null;
    const sure = !!scored[0] && (scored.length < 2 || scored[0].score - scored[1].score >= 0.08);
    return { best, sure, candidates: scored.slice(0, 5) };
  }

  // ---------- set parsing ----------
  const UNIT = { kg: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg", lb: "lb", lbs: "lb", pound: "lb", pounds: "lb" };
  const SPLIT = /\s*(?:,\s*)?\b(?:and then|then|after that|next|and)\b\s*/;
  const isCardio = ex => !!ex && ex.cat === "Cardio";
  const repsOnly = ex => !!ex && ["Bodyweight", "Reps only", "Assisted"].includes(ex.cat);
  const isDuration = ex => !!ex && ex.cat === "Duration";

  function parseChunk(raw, opts) {
    let s = words(raw).toLowerCase().replace(/\b(\d+(?:\.\d+)?)\s*(kg|kilos?|kilograms?|lbs?|pounds?)\b/g, "$1 $2").replace(/[;!?]/g, " ");
    s = s.replace(/\bx\b|\btimes\b|\bby\b/g, " for ").replace(/\b(\d+)\s*(?:reps?|repetitions?)\b/g, "$1 rep").replace(/\b(\d+)\s*sets?\b/g, "$1 set").replace(/(\d)\s*(?:km|kilometers?|k)\b/g, "$1 km").replace(/(\d)\s*(?:mins?|minutes?)\b/g, "$1 min").replace(/(\d)\s*(?:secs?|seconds?)\b/g, "$1 sec");
    const toks = s.split(/[\s,]+/).filter(Boolean);
    const firstNum = toks.findIndex(t => /^\d/.test(t));
    const phrase = (firstNum === -1 ? toks : toks.slice(0, firstNum)).filter(t => !["log", "add", "did", "i", "the", "at", "with", "for", "some", "just", "do", "my"].includes(t)).join(" ");
    const tail = firstNum === -1 ? [] : toks.slice(firstNum);
    const nums = []; // {v, tag}
    for (let i = 0; i < tail.length; i++) {
      const t = tail[i];
      if (!/^\d+(\.\d+)?$/.test(t)) continue;
      const v = parseFloat(t), next = tail[i + 1] || "", prev = tail[i - 1] || "";
      let tag = "";
      if (UNIT[next]) tag = "w:" + UNIT[next];
      else if (next === "rep") tag = "r";
      else if (next === "set") tag = "sets";
      else if (next === "km") tag = "km";
      else if (next === "min") tag = "min";
      else if (next === "sec") tag = "sec";
      else if (prev === "of" && nums.length && nums[nums.length - 1].tag === "sets") tag = "r";
      else if (prev === "at") tag = "w:";
      nums.push({ v, tag });
    }
    return { phrase, nums, raw: raw.trim() };
  }

  function parse(text, opts = {}) {
    const exercises = opts.exercises || [];
    const chunks = String(text || "").split(SPLIT).map(c => c.trim()).filter(c => /\d|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i.test(c) || c.length > 2);
    const out = []; let lastEx = null;
    chunks.forEach(c => {
      const { phrase, nums, raw } = parseChunk(c, opts);
      const m = phrase ? matchExercise(phrase, exercises, opts) : { best: null, sure: false, candidates: [] };
      let ex = m.best, sure = m.sure;
      if (!ex && !phrase) { ex = exercises.find(e => e.id === (out.length ? lastEx : opts.current)) || null; sure = !!ex; }
      lastEx = ex ? ex.id : lastEx;
      const e = { exercise: ex, candidates: m.candidates.map(x => x.ex), sure: !!ex && sure, weight: null, unit: opts.unit || "kg", reps: [], sets: null, km: null, min: null, sec: null, raw, phrase };
      const tagged = k => nums.filter(n => n.tag === k || (k === "w" && n.tag.startsWith("w:")));
      const w = tagged("w")[0]; if (w) { e.weight = w.v; if (w.tag.slice(2)) e.unit = w.tag.slice(2); }
      tagged("sets").forEach(n => { e.sets = n.v; });
      tagged("km").forEach(n => { e.km = n.v; }); tagged("min").forEach(n => { e.min = n.v; }); tagged("sec").forEach(n => { e.sec = n.v; });
      e.reps = tagged("r").map(n => n.v);
      const loose = nums.filter(n => !n.tag).map(n => n.v);
      if (isCardio(ex)) { if (e.min == null && loose.length) e.min = loose.shift(); if (e.km == null && loose.length) e.km = loose.shift(); }
      else if (isDuration(ex)) { if (e.sec == null && e.min == null && loose.length) e.sec = loose.shift(); if (e.min != null && e.sec == null) { e.sec = e.min * 60; e.min = null; } }
      else if (repsOnly(ex)) { e.reps = e.reps.concat(loose); }
      else {
        if (e.weight == null && loose.length && (loose.length > 1 || e.reps.length || e.sets)) e.weight = loose.shift();
        e.reps = e.reps.concat(loose);
      }
      if (e.sets && e.reps.length === 1) e.reps = Array.from({ length: e.sets }, () => e.reps[0]);
      if (e.sets && !e.reps.length && e.weight != null && !isCardio(ex)) e.reps = Array.from({ length: e.sets }, () => null);
      if (e.reps.length) e.reps = e.reps.map(r => (r == null ? null : Math.round(r)));
      if (e.weight != null && e.weight > 1000) e.weight = null;
      if (e.exercise || e.reps.length || e.km != null || e.min != null || e.sec != null) out.push(e);
    });
    return out;
  }

  function toSets(entry, exercise) {
    const blank = () => ({ t: "n", w: "", r: "", km: "", min: "", sec: "", done: true });
    if (isDuration(exercise || entry.exercise)) { const n = entry.sec != null ? entry.sec : entry.min != null ? entry.min * 60 : null; if (n == null) return []; const s = blank(); s.sec = String(Math.round(n)); return [s]; }
    if (isCardio(exercise || entry.exercise)) { const s = blank(); if (entry.km != null) s.km = String(r1(entry.km)); if (entry.min != null) s.min = String(Math.round(entry.min)); return s.km || s.min ? [s] : []; }
    const reps = entry.reps && entry.reps.length ? entry.reps : (entry.weight != null ? [null] : []);
    return reps.map(r => { const s = blank(); if (r != null) s.r = String(r); if (entry.weight != null && !repsOnly(exercise || entry.exercise)) s.w = String(r1(entry.weight)); return s; }).filter(s => s.r || s.w);
  }

  // ---------- speech ----------
  const SR = () => (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
  const speech = {
    supported: () => !!SR(),
    start({ onText, onEnd, onError, lang } = {}) {
      const R = SR(); if (!R) { onError && onError("unsupported"); return { stop() { } }; }
      const rec = new R(); rec.lang = lang || "en-US"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      let finalText = "";
      rec.onresult = ev => { let interim = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) finalText += (finalText ? " " : "") + r[0].transcript; else interim += r[0].transcript; } onText && onText((finalText + " " + interim).trim(), false); };
      rec.onerror = ev => { onError && onError(ev && ev.error || "error"); };
      rec.onend = () => { if (finalText) onText && onText(finalText.trim(), true); onEnd && onEnd(); };
      try { rec.start(); } catch (e) { onError && onError("start"); }
      return { stop() { try { rec.stop(); } catch (e) { } } };
    }
  };
  const errorText = code => ({
    "not-allowed": "The microphone is blocked here. Tap the box and use the mic on your keyboard instead.",
    "service-not-allowed": "Speech isn't available in this browser. Tap the box and use the mic on your keyboard instead.",
    unsupported: "This browser has no speech recognition. Tap the box and use the mic on your keyboard instead.",
    "no-speech": "Didn't catch anything. Try again, closer to the phone.",
    "audio-capture": "No microphone found.",
    network: "Speech needs a connection. Type it, or use the keyboard mic."
  }[code] || "Couldn't listen. Tap the box and use the mic on your keyboard.");

  // ---------- Train sheet ----------
  let sheet = null, V = null;
  const fmtEntry = e => e.exercise ? e.exercise.name : (e.phrase || "Which exercise?");
  function open(opts) {
    close();
    V = { opts, text: "", entries: [], listening: false, err: "", ctl: null };
    sheet = document.createElement("div"); sheet.className = "vl-overlay"; sheet.innerHTML = '<section class="vl-sheet" role="dialog" aria-label="Log by voice"></section>';
    document.body.appendChild(sheet);
    sheet.addEventListener("click", e => { if (e.target === sheet) { close(); return; } const b = e.target.closest("[data-vl]"); if (b) act(b.dataset.vl, b); });
    sheet.addEventListener("input", e => { const t = e.target; if (t.id === "vlText") { V.text = t.value; reparse(); renderEntries(); } const k = t.dataset.vk, i = +t.dataset.vi; if (k && V.entries[i]) applyField(V.entries[i], k, t.value); });
    sheet.addEventListener("change", e => { const t = e.target; const k = t.dataset.vk, i = +t.dataset.vi; if (k === "ex" && V.entries[i]) { const ex = (V.opts.exercises || []).find(x => x.id === t.value) || null; V.entries[i].exercise = ex; V.entries[i].sure = !!ex; renderEntries(); } });
    render();
    if (speech.supported()) listen();
    else setTimeout(() => { const ta = sheet && sheet.querySelector("#vlText"); if (ta) ta.focus(); }, 50);
  }
  function close() { if (V && V.ctl) V.ctl.stop(); if (sheet) sheet.remove(); sheet = null; V = null; }
  function applyField(e, k, val) {
    if (k === "w") { const n = parseFloat(String(val).replace(",", ".")); e.weight = isFinite(n) ? n : null; }
    else if (k === "unit") e.unit = val === "lb" ? "lb" : "kg";
    else if (k === "reps") e.reps = String(val).split(/[\s,x×]+/).map(x => parseInt(x, 10)).filter(x => x > 0);
    else if (k === "km") { const n = parseFloat(val); e.km = isFinite(n) ? n : null; }
    else if (k === "min") { const n = parseFloat(val); e.min = isFinite(n) ? n : null; }
    else if (k === "sec") { const n = parseFloat(val); e.sec = isFinite(n) ? n : null; }
  }
  function reparse() { V.entries = parse(V.text, V.opts); }
  function listen() {
    if (!V) return;
    V.err = ""; V.listening = true; renderMic();
    V.ctl = speech.start({
      onText(text, final) { if (!V) return; V.text = text; const ta = sheet.querySelector("#vlText"); if (ta) ta.value = text; if (final) { reparse(); renderEntries(); } },
      onEnd() { if (!V) return; V.listening = false; V.ctl = null; reparse(); renderMic(); renderEntries(); },
      onError(code) { if (!V) return; V.listening = false; V.ctl = null; V.err = errorText(code); renderMic(); if (/allowed|unsupported|capture/.test(code)) { const ta = sheet.querySelector("#vlText"); if (ta) ta.focus(); } }
    });
  }
  function act(a) {
    if (a === "close") close();
    else if (a === "mic") { if (V.listening) { V.ctl && V.ctl.stop(); } else if (speech.supported()) listen(); else { V.err = errorText("unsupported"); renderMic(); sheet.querySelector("#vlText").focus(); } }
    else if (a === "clear") { V.text = ""; V.entries = []; render(); }
    else if (a === "apply") {
      const ok = V.entries.filter(e => e.exercise && toSets(e, e.exercise).length);
      if (!ok.length) { V.err = "Pick an exercise and say the weight and reps first."; renderMic(); return; }
      const cb = V.opts.onApply; close(); cb && cb(ok.map(e => ({ exId: e.exercise.id, name: e.exercise.name, unit: e.unit, sets: toSets(e, e.exercise), entry: e })));
    }
  }
  function render() {
    if (!sheet) return;
    const sup = speech.supported();
    sheet.firstElementChild.innerHTML = `<header class="vl-head"><button type="button" class="vl-link" data-vl="close">Close</button><b>Log by voice</b><button type="button" class="vl-btn primary" data-vl="apply">Add sets</button></header>
      <div class="vl-body">
        <div class="vl-mic-row" id="vlMicRow"></div>
        <textarea id="vlText" rows="2" placeholder="${sup ? "e.g. bench 60 for 10, 10, 8" : "Tap the mic on your keyboard and say e.g. bench 60 for 10, 10, 8"}" aria-label="What you lifted">${esc(V.text)}</textarea>
        <div id="vlEntries"></div>
        <p class="vl-hint">Say the exercise, the weight, then the reps of each set: "incline dumbbell press 30 kilos 12, 12, 10", "pull ups 8, 7, 6", "treadmill 30 minutes 2 km". "Then" starts another exercise.</p>
      </div>`;
    renderMic(); renderEntries();
  }
  function renderMic() {
    const el = sheet && sheet.querySelector("#vlMicRow"); if (!el) return;
    el.innerHTML = `<button type="button" class="vl-mic${V.listening ? " on" : ""}" data-vl="mic" aria-label="${V.listening ? "Stop listening" : "Start listening"}">${MIC}</button><span class="vl-state">${V.listening ? "Listening…" : speech.supported() ? "Tap the mic and speak" : "Use your keyboard's mic in the box"}</span>${V.text ? '<button type="button" class="vl-link small" data-vl="clear">Clear</button>' : ""}${V.err ? `<p class="vl-err">${esc(V.err)}</p>` : ""}`;
  }
  function renderEntries() {
    const el = sheet && sheet.querySelector("#vlEntries"); if (!el) return;
    const exs = V.opts.exercises || [];
    el.innerHTML = V.entries.map((e, i) => {
      const ex = e.exercise, cands = (e.candidates || []).filter(c => !ex || c.id !== ex.id).slice(0, 4);
      const optsHtml = (ex ? [ex] : []).concat(cands).map(c => `<option value="${esc(c.id)}" ${ex && c.id === ex.id ? "selected" : ""}>${esc(c.name)}</option>`).join("") +
        `<option disabled>──────</option>` + exs.filter(c => !(ex && c.id === ex.id) && !cands.includes(c)).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
      const cardio = isCardio(ex), ro = repsOnly(ex), dur = isDuration(ex);
      return `<div class="vl-entry${ex ? "" : " ask"}">
        <select data-vk="ex" data-vi="${i}" aria-label="Exercise">${ex ? "" : '<option value="" selected>Which exercise?</option>'}${optsHtml}</select>
        ${ex && !e.sure ? `<small class="vl-hint">Heard "${esc(e.phrase)}". Change it if that's wrong.</small>` : ""}
        <div class="vl-fields">
          ${dur ? `<label><span>Seconds</span><input type="number" inputmode="numeric" data-vk="sec" data-vi="${i}" value="${e.sec ?? (e.min != null ? e.min * 60 : "")}"></label>` : cardio ? `<label><span>Minutes</span><input type="number" inputmode="decimal" data-vk="min" data-vi="${i}" value="${e.min ?? ""}"></label><label><span>km</span><input type="number" inputmode="decimal" step="0.1" data-vk="km" data-vi="${i}" value="${e.km ?? ""}"></label>`
            : `${ro ? "" : `<label><span>Weight</span><input type="number" inputmode="decimal" step="0.5" data-vk="w" data-vi="${i}" value="${e.weight ?? ""}"></label><label><span>Unit</span><select data-vk="unit" data-vi="${i}"><option ${e.unit !== "lb" ? "selected" : ""}>kg</option><option ${e.unit === "lb" ? "selected" : ""}>lb</option></select></label>`}
               <label class="grow"><span>Reps per set</span><input type="text" inputmode="numeric" data-vk="reps" data-vi="${i}" value="${esc(e.reps.filter(r => r != null).join(", "))}" placeholder="10, 10, 8"></label>`}
        </div>
        <small class="vl-sum">${summary(e)}</small>
      </div>`;
    }).join("") || (V.text ? '<p class="vl-hint">Nothing to log yet. Say the exercise, weight and reps.</p>' : "");
  }
  const summary = e => {
    const sets = toSets(e, e.exercise);
    if (!sets.length) return "";
    if (isDuration(e.exercise)) return `${sets[0].sec} s`;
    if (isCardio(e.exercise)) return `${sets[0].min ? sets[0].min + " min" : ""}${sets[0].min && sets[0].km ? " · " : ""}${sets[0].km ? sets[0].km + " km" : ""}`;
    return `${sets.length} set${sets.length > 1 ? "s" : ""}: ${sets.map(s => (s.w ? s.w + " " + e.unit + " × " : "") + (s.r || "?")).join(", ")}`;
  };
  const MIC = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4zm6-4a1 1 0 1 1 2 0 8 8 0 0 1-7 7.94V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.06A8 8 0 0 1 4 11a1 1 0 1 1 2 0 6 6 0 0 0 12 0z"/></svg>';

  // ---------- Food card ----------
  let F = null;
  function foodCardHtml() {
    const st = F || {};
    return `<div class="card vl-food"><div class="spread"><h3>Say what you ate</h3><span class="muted" style="font-size:.85rem">Speech → Claude estimate</span></div>
      <div class="row vl-mic-row">
        <button type="button" class="vl-mic${st.listening ? " on" : ""}" data-vlf="mic" aria-label="${st.listening ? "Stop listening" : "Start listening"}">${MIC}</button>
        <input type="text" id="vlFood" placeholder="${speech.supported() ? "e.g. had a chicken shawarma and a Gatorade" : "Tap your keyboard's mic: e.g. had a chicken shawarma"}" value="${esc(st.text || "")}" aria-label="What you ate">
        <button type="button" class="btn small" data-vlf="go">Estimate</button>
      </div>
      ${st.listening ? '<p class="muted" style="font-size:.85rem;margin:0">Listening…</p>' : ""}${st.err ? `<p class="note">${esc(st.err)}</p>` : ""}
    </div>`;
  }
  function bindFood(root, opts) {
    F = { text: "", listening: false, err: "", ctl: null, opts };
    const card = () => root.querySelector(".vl-food");
    const rerender = () => { const c = card(); if (!c) return; const tmp = document.createElement("div"); tmp.innerHTML = foodCardHtml(); c.replaceWith(tmp.firstElementChild); };
    const go = () => { const t = (F.text || "").trim(); if (!t) { F.err = "Say or type what you ate first."; rerender(); return; } F.err = ""; opts.onText && opts.onText(t); F.text = ""; rerender(); };
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-vlf]"); if (!b) return;
      if (b.dataset.vlf === "go") go();
      else if (b.dataset.vlf === "mic") {
        if (F.listening) { F.ctl && F.ctl.stop(); return; }
        if (!speech.supported()) { F.err = errorText("unsupported"); rerender(); const i = root.querySelector("#vlFood"); if (i) i.focus(); return; }
        F.err = ""; F.listening = true; rerender();
        F.ctl = speech.start({
          onText(text, final) { F.text = text; const i = root.querySelector("#vlFood"); if (i) i.value = text; if (final) { F.listening = false; F.ctl = null; go(); } },
          onEnd() { if (F.listening) { F.listening = false; F.ctl = null; if (F.text) go(); else rerender(); } },
          onError(code) { F.listening = false; F.ctl = null; F.err = errorText(code); rerender(); if (/allowed|unsupported|capture/.test(code)) { const i = root.querySelector("#vlFood"); if (i) i.focus(); } }
        });
      }
    });
    root.addEventListener("input", e => { if (e.target.id === "vlFood") F.text = e.target.value; });
    root.addEventListener("keydown", e => { if (e.target.id === "vlFood" && e.key === "Enter") { e.preventDefault(); go(); } });
  }
  // Hand dictated text to the PhotoFood card (fills its box and presses Estimate).
  function toPhotoFood(root, text) {
    const ta = root.querySelector("#pfText"); if (!ta) return false;
    ta.value = text; ta.dispatchEvent(new Event("input", { bubbles: true }));
    const go = root.querySelector('[data-pf="go"]'); if (go) go.click();
    try { ta.closest(".card").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { }
    return true;
  }

  const css = `
.vl-mic{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;border:1px solid var(--line,#ccc);background:var(--sunk,#f3f3f3);color:var(--accent,#2b6);cursor:pointer;flex:none;transition:transform .15s}
.vl-mic.on{background:var(--accent,#2b6);color:var(--accent-ink,#fff);animation:vl-pulse 1.1s ease-in-out infinite}
@keyframes vl-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent,#2b6) 45%,transparent)}50%{box-shadow:0 0 0 12px transparent}}
.vl-mic-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vl-mic-row .vl-state{color:var(--muted,#777);font-size:.9rem}
.vl-err{flex-basis:100%;margin:0;color:var(--bad,#c33);font-size:.88rem}
.vl-food #vlFood{flex:1;min-width:140px;border:1px solid var(--line,#ccc);background:var(--sunk,#f3f3f3);color:var(--ink,#111);border-radius:8px;padding:10px;font:inherit}
.vl-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1200;display:flex;align-items:flex-end;justify-content:center}
.vl-sheet{width:100%;max-width:720px;max-height:92vh;overflow:auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:16px 16px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.25);padding-bottom:max(16px,env(safe-area-inset-bottom,0px))}
.vl-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line,#ddd)}
.vl-head b{text-align:center}
.vl-body{padding:14px 16px;display:grid;gap:12px}
.vl-body textarea{width:100%;border:1px solid var(--line,#ccc);background:var(--sunk,#f3f3f3);color:var(--ink,#111);border-radius:10px;padding:10px;font:inherit;font-size:1.05rem;resize:vertical}
.vl-link{background:none;border:0;color:var(--accent,#2b6);font:inherit;font-weight:600;cursor:pointer;padding:6px 0}
.vl-link.small{font-size:.85rem}
.vl-btn{border:1px solid var(--line,#ccc);background:var(--sunk,#f3f3f3);color:var(--ink,#111);border-radius:10px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
.vl-btn.primary{background:var(--accent,#2b6);color:var(--accent-ink,#fff);border-color:transparent}
.vl-entry{border:1px solid var(--line,#ddd);border-radius:12px;padding:10px;display:grid;gap:8px;background:var(--sunk,#f8f8f8)}
.vl-entry.ask{border-color:var(--warn,#d90)}
.vl-entry select,.vl-entry input{border:1px solid var(--line,#ccc);background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:8px;font:inherit;width:100%;min-width:0}
.vl-fields{display:flex;gap:8px;flex-wrap:wrap}
.vl-fields label{display:grid;gap:3px;font-size:.8rem;color:var(--muted,#777);flex:1 1 80px}
.vl-fields label.grow{flex:2 1 140px}
.vl-fields input{font-size:1.05rem;font-variant-numeric:tabular-nums}
.vl-sum{color:var(--muted,#777)}
.vl-hint{color:var(--muted,#777);font-size:.85rem;margin:0}
`;

  return { parse, matchExercise, toSets, words, speech, errorText, open, close, foodCardHtml, bindFood, toPhotoFood, css, _internal: { parseChunk, phraseTokens } };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VoiceLog;
