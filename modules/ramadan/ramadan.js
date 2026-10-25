/* Ramadan mode for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Prayer times are computed on the device
 * (sun position), so it works offline. Defaults are Kuwait City, UTC+3, no DST.
 * API:
 *   Ramadan.DEFAULTS                          -> config (copy and override any field)
 *   Ramadan.dayOf(isoDate, cfg)               -> 1..30 during Ramadan, else 0
 *   Ramadan.range(cfg)                        -> {start, end, eid} ISO dates
 *   Ramadan.times(isoDate, cfg)               -> {imsak, fajr, sunrise, dhuhr, asr, maghrib, isha} as "HH:MM" (24 h)
 *   Ramadan.plan(isoDate, {dayType, train, cfg, targets}) -> the day's slots, water window and notes
 *       dayType: "training" | "rest" | "saturday" | "friday" (same values the app's picker uses)
 *       train:   "after-iftar" (default) | "before-iftar"
 *   Ramadan.css                               -> string, inject once (uses the app's tokens)
 *   Ramadan.html(isoDate, opts)               -> HTML card for the Today tab ("" outside Ramadan)
 * Food stays 2 Nutreeze meals + 2 snacks + Adonis (+ Gatorade on training days) at 2,000 kcal;
 * Ramadan only moves them. Each slot's `appSlot` is the Food tab slot name the item goes in.
 */
const Ramadan = (() => {
  const DEFAULTS = {
    // 1 Ramadan 1448 AH is expected on Mon 8 Feb 2027 (astronomical estimate).
    // Kuwait confirms by moon sighting the night before; change `start` if it moves a day.
    start: "2027-02-08",
    days: 30,
    lat: 29.3759, lon: 47.9774, tz: 3, // Kuwait City
    fajrAngle: 18, ishaAngle: 17.5,    // Kuwait Ministry of Awqaf convention
    imsakMin: 10,                       // stop eating this many minutes before Fajr
    trainAfterIftarMin: 120,            // lift this long after Maghrib (time for Meal 1 to settle)
    trainBeforeIftarMin: 75,            // fasted session starts this long before Maghrib
    water: { training: 3500, rest: 3000 }, // ml, same targets as the hydration tracker
  };

  const RAD = Math.PI / 180;
  const pad = (n) => String(n).padStart(2, "0");
  const toUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (iso, n) => isoOf(toUTC(iso) + n * 864e5);
  const hhmm = (min) => { const m = Math.round(((min % 1440) + 1440) % 1440); return pad(Math.floor(m / 60)) + ":" + pad(m % 60); };
  const ampm = (s) => { let [h, m] = s.split(":").map(Number); const p = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + pad(m) + " " + p; };
  const conf = (cfg) => Object.assign({}, DEFAULTS, cfg || {}, { water: Object.assign({}, DEFAULTS.water, (cfg || {}).water) });

  function range(cfg) {
    const c = conf(cfg);
    return { start: c.start, end: addDays(c.start, c.days - 1), eid: addDays(c.start, c.days) };
  }

  function dayOf(iso, cfg) {
    const c = conf(cfg);
    const n = Math.round((toUTC(iso) - toUTC(c.start)) / 864e5) + 1;
    return n >= 1 && n <= c.days ? n : 0;
  }

  // Sun declination and equation of time (NOAA low-precision formulas, good to ~1 min).
  function sun(iso) {
    const jd = toUTC(iso) / 864e5 + 2440587.5 + 0.5; // local-ish noon
    const T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
    const y = Math.tan((eps / 2) * RAD) ** 2;
    const eqt = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    return { decl, eqt };
  }

  // Minutes after local midnight for each prayer.
  function minutes(iso, cfg) {
    const c = conf(cfg);
    const { decl, eqt } = sun(iso);
    const noon = 720 - 4 * c.lon - eqt + c.tz * 60;
    const ha = (alt) => {
      const cosH = (Math.sin(alt * RAD) - Math.sin(c.lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(c.lat * RAD) * Math.cos(decl * RAD));
      return Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD * 4; // minutes
    };
    const asrAlt = Math.atan(1 / (1 + Math.tan(Math.abs(c.lat - decl) * RAD))) / RAD; // Shafi'i/standard
    const fajr = noon - ha(-c.fajrAngle);
    return {
      imsak: fajr - c.imsakMin,
      fajr,
      sunrise: noon - ha(-0.833),
      dhuhr: noon,
      asr: noon + ha(asrAlt),
      maghrib: noon + ha(-0.833),
      isha: noon + ha(-c.ishaAngle),
    };
  }

  function times(iso, cfg) {
    const m = minutes(iso, cfg), out = {};
    for (const k in m) out[k] = hhmm(m[k]);
    return out;
  }

  // Sort clock times that cross midnight: anything before noon counts as "after midnight".
  const order = (s) => { const [h, mm] = s.split(":").map(Number); const t = h * 60 + mm; return t < 720 ? t + 1440 : t; };

  function plan(iso, opts) {
    const o = opts || {};
    const c = conf(o.cfg);
    const day = dayOf(iso, c);
    const dayType = o.dayType || "training";
    const training = dayType === "training" || dayType === "saturday";
    const train = o.train === "before-iftar" ? "before-iftar" : "after-iftar";
    const m = minutes(iso, c);
    // Suhoor is eaten before the next dawn, so use the next day's Fajr for it.
    const next = minutes(addDays(iso, 1), c);
    const night = { maghrib: m.maghrib, imsak: next.imsak + 1440, fajr: next.fajr + 1440 };

    const slots = [];
    const add = (t, id, label, items, appSlot, note) => slots.push({ time: hhmm(t), id, label, items, appSlot, note: note || "" });

    if (training && train === "before-iftar") {
      const start = m.maghrib - c.trainBeforeIftarMin;
      add(start, "train", "Lift (fasted)", ["Shorter session: main lifts only, stop sets 2 reps short of failure", "Skip the treadmill here, walk after Taraweeh instead"], null,
        "Keep it under an hour. If you feel dizzy, stop the session.");
      add(m.maghrib, "iftar", "Iftar", ["3 dates + water", "Gatorade 1 L over the evening", "Meal 1 (the higher-carb meal)", "Adonis cookie dough"], "Meal 1",
        "Post-workout meal: carbs and protein together.");
      add(m.maghrib + 150, "evening", "Evening snack", ["Snack 1", "30 min treadmill or walk (optional)"], "Snack");
    } else {
      add(m.maghrib, "iftar", "Iftar", ["3 dates + water", "Meal 1 (lighter, lower-fat, higher-carb)", "Snack 1 (fruit if possible)"], "Meal 1",
        training ? "Pray Maghrib, then eat. Keep it light so you can train in two hours." : "");
      if (training) {
        const start = m.maghrib + c.trainAfterIftarMin;
        add(start, "train", "Lift + 30 min treadmill", ["Normal session from the rotation", "Gatorade 1 L during"], null,
          "If you pray Taraweeh first, push this later. Two hours after iftar is the minimum.");
        add(start + 120, "post", "After training", ["Adonis cookie dough", "Snack 2"], "Snack");
      } else {
        add(m.maghrib + 180, "evening", "Evening snack", ["Adonis cookie dough", "Snack 2"], "Snack");
      }
    }
    if (training && train === "before-iftar") {
      add(night.imsak - 50, "suhoor", "Suhoor", ["Meal 2 (the higher-protein, heavier meal)", "Snack 2 (nuts or Pro Mud Cake fit here)"], "Meal 2",
        "Finish by " + ampm(hhmm(night.imsak)) + ".");
    } else {
      add(night.imsak - 50, "suhoor", "Suhoor", ["Meal 2 (the higher-protein, heavier meal)"], "Meal 2",
        "Finish by " + ampm(hhmm(night.imsak)) + ". Protein and some fat here keep you full through the fast.");
    }
    slots.sort((a, b) => order(a.time) - order(b.time));

    const target = training ? c.water.training : c.water.rest;
    const water = waterPlanFor(m, night, target, training, train, c);

    const supps = [
      { time: hhmm(m.maghrib), name: "Creatine 5 g", note: "With iftar." },
      { time: hhmm(night.imsak - 50), name: "Vitamin D3 + omega-3", note: "With suhoor (the meal with fat)." },
      { time: hhmm(m.maghrib + 300), name: "Magnesium", note: "Before sleep." },
    ];

    // opts.targets: an AppTargets object; only used for the wording, the meals stay the same.
    const T = o.targets || {}, pos = v => typeof v === "number" && isFinite(v) && v > 0 ? v : null;
    const tk = { kcal: pos(T.kcal) || 2000, pMin: pos(T.proteinMin) || 160, pMax: pos(T.proteinMax) || (pos(T.proteinMin) ? pos(T.proteinMin) + 10 : 170) };
    const fastMin = m.maghrib - m.fajr;
    const notes = [
      "Calories stay at " + tk.kcal.toLocaleString("en-US") + " and protein at " + tk.pMin + "–" + tk.pMax + " g. Ramadan moves the meals, it doesn't change the targets.",
      "Expect the scale to bounce in week 1 from water and meal timing. Judge by the 7-day average.",
    ];
    if (dayType === "friday") notes.push("Friday is still the free day, but it's one iftar meal now, not a whole day of eating.");
    if (training && train === "before-iftar") notes.push("Fasted training: drop a set per exercise if strength dips. Keeping the weight on the bar matters more than volume.");

    return {
      date: iso, day, isRamadan: day > 0, dayType, training, train,
      times: times(iso, c), suhoorBy: hhmm(night.imsak),
      fastHours: Math.round((fastMin / 60) * 10) / 10,
      slots, water, supps, notes,
    };
  }

  // Spread the target over the eating window: front-loaded after iftar, a bigger share
  // at suhoor, little right before sleep.
  function waterPlanFor(m, night, target, training, train, c) {
    const gatorade = training ? 1000 : 0;
    const plain = Math.max(0, target - gatorade);
    const trainAt = train === "before-iftar" ? m.maghrib : m.maghrib + c.trainAfterIftarMin;
    const afterIftar = training && train === "after-iftar";
    const pts = [
      [m.maghrib, 0.15, "Break the fast: water with dates. Sip, don't chug."],
      [m.maghrib + 45, 0.15, "After Meal 1."],
      [m.maghrib + 100, 0.15, afterIftar ? "Before the gym." : "Steady sips."],
      [m.maghrib + 240, 0.15, afterIftar ? "After the gym, with Adonis." : "Evening."],
      [m.maghrib + 300, 0.1, "Before sleep. A glass or two, not more."],
      [night.imsak - 50, 0.3, "Suhoor: water with Meal 2. Spread it over the meal."],
    ];
    let left = plain;
    const checkpoints = pts.map(([t, share, note], i) => {
      const ml = i === pts.length - 1 ? left : Math.round((plain * share) / 50) * 50;
      left -= ml;
      return { time: hhmm(t), ml, note };
    });
    if (gatorade) {
      checkpoints.push({
        time: hhmm(trainAt), ml: gatorade,
        note: train === "before-iftar" ? "Gatorade 1 L over the evening (you trained fasted, so refill here)." : "Gatorade 1 L during the workout, as usual.",
      });
      checkpoints.sort((a, b) => order(a.time) - order(b.time));
    }
    return {
      from: hhmm(m.maghrib), to: hhmm(night.imsak), targetMl: target,
      hours: Math.round(((night.imsak - m.maghrib) / 60) * 10) / 10,
      checkpoints,
    };
  }

  const css = `
.rm-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r,14px);padding:16px}
.rm-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
.rm-head h2{margin:0;font-family:var(--display);font-size:1.15rem}
.rm-day{font-family:var(--mono);color:var(--muted);font-size:.85rem}
.rm-times{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.rm-times div{background:var(--sunk);border-radius:10px;padding:8px;text-align:center}
.rm-times b{display:block;font-family:var(--mono);font-size:1.05rem;color:var(--ink)}
.rm-times span{font-size:.75rem;color:var(--muted)}
.rm-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.rm-list li{display:grid;grid-template-columns:5.2rem 1fr;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.rm-list time{font-family:var(--mono);color:var(--accent);font-size:.9rem}
.rm-list strong{display:block}
.rm-list small{color:var(--muted)}
.rm-sub{margin:14px 0 6px;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.rm-note{color:var(--muted);font-size:.85rem;margin:6px 0 0}`;

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  function html(iso, opts) {
    const p = plan(iso, opts);
    if (!p.isRamadan) return "";
    const L = (t, title, body) => `<li><time>${ampm(t)}</time><div><strong>${esc(title)}</strong>${body ? `<small>${body}</small>` : ""}</div></li>`;
    return `<section class="rm-card">
  <div class="rm-head"><h2>Ramadan · day ${p.day}</h2><span class="rm-day">Fast ${p.fastHours} h</span></div>
  <div class="rm-times">
    <div><b>${ampm(p.suhoorBy)}</b><span>Suhoor ends</span></div>
    <div><b>${ampm(p.times.maghrib)}</b><span>Iftar</span></div>
    <div><b>${ampm(p.times.isha)}</b><span>Isha</span></div>
  </div>
  <ul class="rm-list">${p.slots.map((s) => L(s.time, s.label, esc(s.items.join(" · ")) + (s.note ? "<br>" + esc(s.note) : ""))).join("")}</ul>
  <p class="rm-sub">Water ${(p.water.targetMl / 1000).toFixed(1)} L between ${ampm(p.water.from)} and ${ampm(p.water.to)}</p>
  <ul class="rm-list">${p.water.checkpoints.map((w) => L(w.time, w.ml + " ml", esc(w.note))).join("")}</ul>
  <p class="rm-sub">Supplements</p>
  <ul class="rm-list">${p.supps.map((s) => L(s.time, s.name, esc(s.note))).join("")}</ul>
  ${p.notes.map((n) => `<p class="rm-note">${esc(n)}</p>`).join("")}
</section>`;
  }

  return { DEFAULTS, dayOf, range, times, plan, css, html, _ampm: ampm };
})();

if (typeof module !== "undefined") module.exports = Ramadan;
