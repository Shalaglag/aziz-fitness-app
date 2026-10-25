/* Fitness app motion helpers. Pairs with motion.css.
   API:
     FitMotion.reduced()                  -> true if the user prefers less motion
     FitMotion.countUp(el, to, opts)      -> animates a number (opts: from, duration, decimals, suffix)
     FitMotion.pop(el)                    -> replays the .anim-pop bounce (set done, meal eaten)
     FitMotion.celebrate(el)              -> PR burst around el (plate colors)
     FitMotion.switchView(update, dir)    -> runs update() inside a screen transition; dir "forward" | "back"
     FitMotion.setProgress(el, value)     -> sets --value (0-100) on a .ring-fill or .bar > span
*/
(function () {
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(mq && mq.matches); }

  function format(n, decimals, suffix) {
    return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + (suffix || "");
  }

  function countUp(el, to, opts) {
    opts = opts || {};
    var from = opts.from != null ? opts.from : 0;
    var decimals = opts.decimals || 0;
    var duration = opts.duration || 900;
    if (reduced()) { el.textContent = format(to, decimals, opts.suffix); return; }
    var start = null;
    function frame(t) {
      if (start === null) start = t;
      var p = Math.min((t - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(from + (to - from) * eased, decimals, opts.suffix);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  function pop(el) { replay(el, "anim-pop"); }

  // Olympic plate colors: 25 kg red, 20 kg blue, 15 kg yellow, 10 kg green.
  var PLATES = ["#D0302A", "#1F5FD1", "#F2C230", "#1B8048"];

  function celebrate(el) {
    replay(el, "anim-pr");
    if (reduced()) return;
    var host = el.offsetParent || document.body;
    var r = el.getBoundingClientRect();
    var h = host.getBoundingClientRect();
    var cx = r.left - h.left + r.width / 2 + host.scrollLeft;
    var cy = r.top - h.top + r.height / 2 + host.scrollTop;
    for (var i = 0; i < 18; i++) {
      var piece = document.createElement("span");
      piece.className = "fit-burst-piece";
      var angle = (Math.PI * 2 * i) / 18 + Math.random() * .3;
      var dist = 40 + Math.random() * 50;
      piece.style.left = cx + "px";
      piece.style.top = cy + "px";
      piece.style.background = PLATES[i % 4];
      piece.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      piece.style.setProperty("--dy", Math.sin(angle) * dist - 20 + "px");
      piece.style.setProperty("--rot", (Math.random() * 360 - 180) + "deg");
      host.appendChild(piece);
      setTimeout(piece.remove.bind(piece), 1300);
    }
  }

  function switchView(update, dir) {
    var root = document.documentElement;
    root.setAttribute("data-nav", dir === "back" ? "back" : "forward");
    if (document.startViewTransition && !reduced()) {
      document.startViewTransition(update);
    } else {
      update();
    }
  }

  function setProgress(el, value) {
    el.style.setProperty("--value", Math.max(0, value));
    if (el.classList.contains("ring-fill")) el.classList.toggle("is-over", value > 100);
  }

  window.FitMotion = { reduced: reduced, countUp: countUp, pop: pop, celebrate: celebrate, switchView: switchView, setProgress: setProgress };
})();
