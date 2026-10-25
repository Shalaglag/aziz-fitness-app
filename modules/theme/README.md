# Plate theme kit

Live preview: https://claude.ai/artifact/TAHYUTfeDfMb1QsDLiqYNL (local copy: preview.html)

Framework-free. Works in a plain HTML app, a single-file Artifact (inline the files), or any framework.

## Files
- `theme.css`: tokens (color, type, spacing, radius, shadows), light + dark, 4 accents, a few primitives (`.card`, `.btn`, `.chip`, `.t-label`, `.t-num`).
- `motion.css`: duration/easing tokens and animation classes. All collapse under `prefers-reduced-motion`.
- `theme.js`: `FitTheme` switcher (mode + accent), saved to localStorage, follows the system by default, updates `<meta name="theme-color">`.
- `motion.js`: `FitMotion` helpers (count-up numbers, pop, PR celebration, tab transitions, progress rings/bars).

## Plug in
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">
<link rel="stylesheet" href="theme/theme.css">
<link rel="stylesheet" href="theme/motion.css">
<script src="theme/theme.js"></script>   <!-- in <head>, before first paint -->
<script src="theme/motion.js" defer></script>
```

## Modes and accents
- `<html data-theme="light|dark">`, or no attribute = follow the system. Use `FitTheme.setMode("system"|"light"|"dark")`.
- `<html data-accent="red|blue|yellow|green">` (25/20/15/10 kg plates). Default blue. `FitTheme.setAccent(name)`.
- Style everything through tokens: `--bg --surface --surface-2 --surface-3 --fg --fg-muted --fg-faint --line --accent --on-accent --accent-soft`.
- Macro colors are fixed across accents: `--protein --carbs --fat`. Status: `--good --warn --bad`.

## Type
`--font-display` (Barlow Condensed, headings and big numbers, usually uppercase), `--font-body` (Figtree), `--font-mono` (IBM Plex Mono, numbers in tables/logs, use `.t-num`).
Scale: `--text-xs 12 · sm 14 · md 16 · lg 20 · xl 28 · 2xl 40 · 3xl 56`.

## Motion recipes
| Use | How |
|---|---|
| Cards entering a screen | `class="anim-rise" style="--i:0..n"` (50 ms stagger) |
| Tab / screen switch | `FitMotion.switchView(() => render(next), "forward"|"back")`; give the screen container `view-transition-name: fit-screen` |
| Calorie ring | `<circle class="ring-fill" pathLength="100">` + `FitMotion.setProgress(el, pct)`; turns `--warn` over 100 |
| Macro / weight bars | `<div class="bar" style="--bar-color:var(--protein)"><span></span></div>` + `FitMotion.setProgress(span, pct)` |
| Animated numbers | `FitMotion.countUp(el, 1970)` (opts: from, decimals, suffix, duration) |
| Set done / meal eaten | `FitMotion.pop(checkEl)`; check icon path with `class="anim-draw" pathLength="1"` |
| New PR | `FitMotion.celebrate(numberEl)` (parent should be `position: relative`) |
| Rest timer last 10 s | toggle `.anim-pulse` |
| Loading | `.skeleton` with a height/width |
| Bottom sheet | `.sheet` + toggle `.is-open` |
| Press feedback | `.tap` on buttons and tappable cards |

Durations: tap 120 ms, UI 220 ms, enter 420 ms, fill 900 ms, celebrate 1200 ms.

## App shell token names
`theme.css` ends with aliases for the app's existing names (`--sunk --ink --muted --accent-ink --display --body --mono --r`; `--bg --surface --line --accent --protein --carbs --fat --good --warn --bad` match directly). Replace the app's own `:root` / dark token blocks with `theme.css` so the aliases aren't overridden.
