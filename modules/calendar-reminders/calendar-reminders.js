/* Phone calendar reminders for the Aziz Cut Tracker.
 * Builds one .ics file (weigh-in, training, water nudges, the calorie review, supplements)
 * from the app's schedule so Google Calendar / Samsung Calendar on Android can import it.
 * Plain JS, no imports, no network. Browser global `CalendarReminders` or CommonJS.
 * API:
 *   CalendarReminders.DEFAULTS                      -> default settings (copied into prefs/main.reminders on first save)
 *   CalendarReminders.settings(prefsMain)           -> DEFAULTS merged with prefs/main.reminders
 *   CalendarReminders.events(settings, ctx)         -> [{uid, summary, description, start, time, minutes, rrule?, alarms:[min]}]
 *       ctx: { from: "YYYY-MM-DD" (first day, today), review: "YYYY-MM-DD" (STRICT.to) or null,
 *              supps: SuppDrinks.plan(prefs) rows (optional), tz: "Asia/Kuwait" }
 *   CalendarReminders.ics(events, {tz, name, stamp}) -> the file text (CRLF, folded, VTIMEZONE for a fixed-offset zone)
 *   CalendarReminders.build(prefsMain, ctx)         -> {filename, text, count}
 *   CalendarReminders.css / html(prefsMain, ctx) / readForm(root) / apply(action, data, prefsMain, ctx)
 *       apply returns {prefs?, toast?, download?:{filename, text}}
 * Times are local wall-clock in `tz`; Kuwait is UTC+3 all year, so the VTIMEZONE has one STANDARD block.
 */
const CalendarReminders = (() => {
  const DEFAULTS = {
    weigh: true, weighTime: "07:00",
    train: true, trainTime: "15:30", trainDays: ["SU", "MO", "TU", "WE", "TH"], satTime: "10:00", satOn: true,
    water: true, waterTimes: ["11:00", "13:00", "17:00", "19:00"],
    review: true, reviewTime: "09:00",
    supps: true,
  };
  const TZ = "Asia/Kuwait", OFFSET = "+0300";
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const pad = n => String(n).padStart(2, "0");
  const clone = o => JSON.parse(JSON.stringify(o));
  const toUTC = iso => { const [y, m, d] = String(iso).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (iso, n) => isoOf(toUTC(iso) + n * 864e5);
  const dow = iso => DAYS[new Date(toUTC(iso)).getUTCDay()];
  const validTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ""));
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && !isNaN(toUTC(d));
  const ampm = s => { let [h, m] = s.split(":").map(Number); const p = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (m ? ":" + pad(m) : "") + " " + p; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function settings(prefs) {
    const own = (prefs && prefs.reminders) || {};
    const s = Object.assign({}, DEFAULTS, own);
    for (const k of ["weighTime", "trainTime", "satTime", "reviewTime"]) if (!validTime(s[k])) s[k] = DEFAULTS[k];
    s.trainDays = (Array.isArray(s.trainDays) ? s.trainDays : DEFAULTS.trainDays).filter(d => DAYS.includes(d));
    s.waterTimes = (Array.isArray(s.waterTimes) ? s.waterTimes : DEFAULTS.waterTimes).filter(validTime).sort();
    return s;
  }

  // First date on/after `from` whose weekday is in `days` (so RRULE's DTSTART is itself an occurrence).
  function firstOn(from, days) {
    for (let i = 0; i < 7; i++) { const d = addDays(from, i); if (days.includes(dow(d))) return d; }
    return from;
  }

  function events(s, ctx) {
    ctx = ctx || {};
    const from = validDate(ctx.from) ? ctx.from : isoOf(Date.now());
    const out = [];
    if (s.weigh) out.push({
      uid: "cr-weigh", summary: "Morning weigh-in", start: from, time: s.weighTime, minutes: 5, rrule: "FREQ=DAILY", alarms: [0],
      description: "After the bathroom, before food or water, same scale. Log it in the app. One reading means nothing; the weekly average does.",
    });
    if (s.train && s.trainDays.length) out.push({
      uid: "cr-train", summary: "Train + 30 min treadmill", start: firstOn(from, s.trainDays), time: s.trainTime, minutes: 90,
      rrule: "FREQ=WEEKLY;BYDAY=" + s.trainDays.join(","), alarms: [30, 0],
      description: "Meal 1 + both snacks about 90 min before. 1 L Gatorade during (it counts inside the 2,000). Adonis after. Open Train in the app to log sets.",
    });
    if (s.train && s.satOn) out.push({
      uid: "cr-train-sat", summary: "Saturday session", start: firstOn(from, ["SA"]), time: s.satTime, minutes: 90,
      rrule: "FREQ=WEEKLY;BYDAY=SA", alarms: [90, 0],
      description: "Eggs + khubz by 8:30 so they settle. Then the usual 2 meals + 2 snacks + Adonis.",
    });
    if (s.water) s.waterTimes.forEach((t, i) => out.push({
      uid: "cr-water-" + t.replace(":", ""), summary: "Water check", start: from, time: t, minutes: 5, rrule: "FREQ=DAILY", alarms: [0],
      description: "Aim 3 L on rest days, 3.5-4 L on training days (Gatorade counts). Not more than 1 L an hour. Tap it into Today.",
    }));
    if (s.review && validDate(ctx.review) && ctx.review >= from) out.push({
      uid: "cr-review-" + ctx.review.replace(/-/g, ""), summary: "14-day calorie review", start: ctx.review, time: s.reviewTime, minutes: 30, alarms: [1440, 0],
      description: "Two weeks of weigh-ins are in. Open Progress: compare the 7-day averages and let the coach say whether 2,000 kcal stays. Decide on the trend, never one reading.",
    });
    if (s.supps && Array.isArray(ctx.supps)) ctx.supps.filter(p => p && p.on !== false && validTime(p.time) && p.name).forEach(p => out.push({
      uid: "cr-supp-" + String(p.key || p.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), summary: p.name + (p.dose ? " " + p.dose : ""), start: from, time: p.time, minutes: 5,
      rrule: "FREQ=DAILY", alarms: [0], description: p.with ? "Take it " + p.with + "." : "Tap it in Drinks and supplements on Today.",
    }));
    return out;
  }

  const icsText = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  function fold(line) { // 75 octets per line, continuation lines start with a space (RFC 5545 3.1)
    const out = []; let cur = "";
    for (const ch of line) { if (Buffer_len(cur + ch) > 75) { out.push(cur); cur = " " + ch; } else cur += ch; }
    out.push(cur); return out.join("\r\n");
  }
  function Buffer_len(s) { return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length; }
  const stampOf = d => { const x = d instanceof Date ? d : new Date(d || Date.now()); return x.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"; };

  function ics(evs, opts) {
    opts = opts || {};
    const tz = opts.tz || TZ, name = opts.name || "Cut tracker", stamp = stampOf(opts.stamp);
    const tag = (opts.tag || stamp.slice(0, 8));
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Aziz Cut Tracker//Calendar reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:" + icsText(name), "X-WR-TIMEZONE:" + tz,
      "BEGIN:VTIMEZONE", "TZID:" + tz, "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:" + (opts.offset || OFFSET), "TZOFFSETTO:" + (opts.offset || OFFSET), "TZNAME:" + (opts.tzname || "AST"), "END:STANDARD", "END:VTIMEZONE"];
    for (const e of evs) {
      const dt = e.start.replace(/-/g, "") + "T" + e.time.replace(":", "") + "00";
      L.push("BEGIN:VEVENT", "UID:" + e.uid + "-" + tag + "@aziz-cut-tracker", "DTSTAMP:" + stamp, "DTSTART;TZID=" + tz + ":" + dt,
        "DURATION:PT" + (e.minutes || 5) + "M", "SUMMARY:" + icsText(e.summary));
      if (e.description) L.push("DESCRIPTION:" + icsText(e.description));
      if (e.rrule) L.push("RRULE:" + e.rrule);
      L.push("TRANSP:TRANSPARENT");
      for (const m of (e.alarms || [0])) L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsText(e.summary), "TRIGGER:" + (m ? "-PT" + m + "M" : "PT0M"), "END:VALARM");
      L.push("END:VEVENT");
    }
    L.push("END:VCALENDAR");
    return L.map(fold).join("\r\n") + "\r\n";
  }

  function build(prefs, ctx) {
    ctx = ctx || {};
    const s = settings(prefs), evs = events(s, ctx);
    const from = validDate(ctx.from) ? ctx.from : isoOf(Date.now());
    return { filename: "cut-reminders-" + from + ".ics", text: ics(evs, { tz: ctx.tz, stamp: ctx.now, tag: from.replace(/-/g, "") }), count: evs.length };
  }

  const css = `
.cr-card .cr-rows{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.cr-card .cr-row{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;font-size:.95rem}
.cr-card .cr-row input[type=time]{font:inherit;padding:4px 6px;border-radius:8px;border:1px solid var(--line,#ccc);background:var(--card,transparent);color:inherit}
.cr-card .cr-row .cr-sub{font-size:.85rem;color:var(--muted,#777)}
.cr-card .cr-water{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cr-card .cr-water input[type=time]{font:inherit;padding:3px 5px;border-radius:8px;border:1px solid var(--line,#ccc);background:var(--card,transparent);color:inherit}
.cr-card .cr-how{font-size:.88rem;margin:8px 0 0}
.cr-card .cr-how li{margin:2px 0}`;

  function html(prefs, ctx) {
    ctx = ctx || {};
    const s = settings(prefs), evs = events(s, ctx);
    const row = (key, label, sub, timeKey) => `<label class="cr-row"><input type="checkbox" name="${key}" ${s[key] ? "checked" : ""}><span>${esc(label)}${sub ? `<br><span class="cr-sub">${esc(sub)}</span>` : ""}</span>${timeKey ? `<input type="time" name="${timeKey}" value="${s[timeKey]}" aria-label="${esc(label)} time">` : "<span></span>"}</label>`;
    const dayLabel = s.trainDays.length === 5 && !s.trainDays.includes("FR") && !s.trainDays.includes("SA") ? "Sun–Thu" : s.trainDays.join(", ");
    return `<div class="card cr-card" data-cr-form><h3>Phone reminders</h3>
    <p class="muted" style="font-size:.9rem">Download one calendar file and open it on your phone. The alerts then come from your calendar app, even when this app is closed. Times are Kuwait time; the events repeat, so import it once.</p>
    <div class="cr-rows">
      ${row("weigh", "Morning weigh-in", "every day", "weighTime")}
      ${row("train", "Training", dayLabel + " at " + ampm(s.trainTime) + (s.satOn ? ", Saturday at " + ampm(s.satTime) : "") + ", alert 30 min before", "trainTime")}
      <label class="cr-row" style="padding-left:28px"><input type="checkbox" name="satOn" ${s.satOn ? "checked" : ""}><span>Saturday session</span><input type="time" name="satTime" value="${s.satTime}" aria-label="Saturday session time"></label>
      ${row("water", "Water checks", s.waterTimes.length + " a day", null)}
      <div class="cr-water" style="padding-left:28px">${s.waterTimes.map((t, i) => `<input type="time" name="water${i}" value="${t}" aria-label="Water check ${i + 1}">`).join("")}<button type="button" class="chip" data-cr="water-add">+ time</button>${s.waterTimes.length ? `<button type="button" class="chip" data-cr="water-less">− time</button>` : ""}</div>
      ${row("review", "14-day calorie review", ctx.review ? "one event on " + ctx.review + ", alert the day before" : "no review date set", "reviewTime")}
      ${row("supps", "Supplements", Array.isArray(ctx.supps) && ctx.supps.length ? "from your supplement schedule (" + ctx.supps.filter(p => p && p.on !== false).length + ")" : "set the schedule in Drinks and supplements first", null)}
    </div>
    <div class="row"><button type="button" class="btn small" data-cr="download">Download ${evs.length} reminder${evs.length === 1 ? "" : "s"} (.ics)</button><button type="button" class="btn small ghost" data-cr="save">Save times</button></div>
    <details><summary class="muted" style="font-size:.9rem">How to add it on Android</summary><ol class="cr-how">
      <li>Tap the downloaded file and choose <b>Calendar</b> (Google or Samsung). If a chooser doesn't appear, open the file from the Files app.</li>
      <li>No "open with Calendar"? On a computer go to calendar.google.com → Settings → Import and export → Import, pick the file. It syncs to the phone.</li>
      <li>Changed a time here? Download again and import; the new file replaces the old events (same ids).</li>
    </ol></details></div>`;
  }

  function readForm(root) {
    const f = (root || document).querySelector("[data-cr-form]");
    if (!f) return {};
    const v = { waterTimes: [] };
    f.querySelectorAll("input[name]").forEach(i => {
      if (/^water\d+$/.test(i.name)) { if (validTime(i.value)) v.waterTimes.push(i.value); }
      else v[i.name] = i.type === "checkbox" ? i.checked : i.value;
    });
    return v;
  }

  function merge(prefs, data) {
    const out = clone(prefs || {}), cur = settings(prefs), next = Object.assign({}, cur);
    for (const k of ["weigh", "train", "satOn", "water", "review", "supps"]) if (typeof data[k] === "boolean") next[k] = data[k];
    for (const k of ["weighTime", "trainTime", "satTime", "reviewTime"]) if (validTime(data[k])) next[k] = data[k];
    if (Array.isArray(data.waterTimes)) next.waterTimes = data.waterTimes.filter(validTime).sort();
    out.reminders = next;
    return out;
  }

  function apply(action, data, prefs, ctx) {
    data = data || {};
    if (action === "water-add") {
      const p = merge(prefs, data), s = p.reminders; const last = s.waterTimes[s.waterTimes.length - 1] || "09:00";
      let [h, m] = last.split(":").map(Number); h = Math.min(23, h + 2); s.waterTimes = s.waterTimes.concat(pad(h) + ":" + pad(m)).filter((t, i, a) => a.indexOf(t) === i).sort();
      return { prefs: p };
    }
    if (action === "water-less") { const p = merge(prefs, data); p.reminders.waterTimes = p.reminders.waterTimes.slice(0, -1); return { prefs: p }; }
    if (action === "save") return { prefs: merge(prefs, data), toast: "Reminder times saved." };
    if (action === "download") {
      const p = merge(prefs, data), b = build(p, ctx);
      if (!b.count) return { prefs: p, toast: "Nothing to download: turn on at least one reminder." };
      return { prefs: p, download: { filename: b.filename, text: b.text }, toast: "Open the file with your calendar app." };
    }
    return {};
  }

  return { DEFAULTS, TZ, settings, events, ics, build, css, html, readForm, apply, _firstOn: firstOn };
})();
if (typeof module !== "undefined" && module.exports) module.exports = CalendarReminders;
