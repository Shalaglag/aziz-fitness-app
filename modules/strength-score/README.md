# Strength score and imbalance check (StrengthScore)

One number for how strong you are relative to body weight (the Fitbod "Strength Score" idea), a level per push / pull / legs and per muscle, and flags when one side lags the other. One `.card` for the Progress tab, under the Strength card. Plain JS, no imports, no network. Global `StrengthScore`.

| Function | Returns |
| --- | --- |
| `StrengthScore.css` | CSS string, inject once (uses the app's tokens) |
| `StrengthScore.html(docs, opts)` | the card |
| `StrengthScore.fromDocs(docs, opts)` | `{overall, level, groups, regions, muscles, lifts, flags, skipped, notes, bodyKg, change28}` |
| `StrengthScore.compute(lifts, opts)` | same, from a lifts list and `opts.bodyKg` (no docs) |
| `StrengthScore.summary(docs, opts)` | plain text for the coach / a chat |
| `StrengthScore.patternFor(name, overrides)` | `{id, label, ratios, kind, group}` or `null` |
| `StrengthScore.scoreOf(ratio, ratios)` / `levelOf(score)` | the mapping pieces |

## Method

- **Per lift:** ratio = latest est. 1RM (kg, from `StrengthAnalytics.analyze().lifts`) ÷ body weight (kg, latest weigh-in in `docs.weights` at or before the date). Each movement pattern (`STANDARDS`, 30 patterns: barbell / dumbbell / machine presses, rows, pulldowns, curls, squats, hinges, leg machines, calves...) has five ratio breakpoints for beginner / novice / intermediate / advanced / elite. The ratio maps to 20 / 40 / 60 / 80 / 100 with straight lines between, 0–20 below beginner, capped at 100. Dumbbell patterns use the per-hand load; pull-ups and dips use (body weight + load) ÷ body weight.
- **Levels:** <20 Starting, 20 Beginner, 40 Novice, 60 Intermediate, 80 Advanced, 100 Elite.
- **Per muscle:** weighted mean of its lifts' scores; a primary muscle counts 1, a helper ½, times an equipment confidence (free weight 1, cable 0.8, machine 0.6, body weight 0.8) because machine loads differ by brand.
- **Groups:** push = chest, front/side delts, triceps; pull = back, rear delts, biceps; legs = quads, hamstrings, glutes, calves. Overall = mean of the groups that have data; a missing group is named in a note, never guessed.
- **Imbalance flags** (`GAP` = 15 points): push vs pull, upper vs lower, quads vs hamstrings, chest vs back. Each flag says who lags whom by how much and one line of advice (add a set or two for the lagging side, re-check in 4 weeks).
- **Change:** `change28` = overall now minus overall 28 days ago (same lifts, body weight back then).
- A lift whose last session is older than `window` days (default 60) is listed as not scored; unknown exercises too. Cardio, abs, abduction and shrugs have no standard and are ignored.
- Nothing about one person is hard-coded. `opts.sex: "female"` scales the standards (upper × 0.65, lower × 0.75); the default is male with a note saying so. `opts.standards` overrides a pattern, `opts.patterns` maps an exercise name to a pattern id.

## Options

`today`, `asOf`, `bodyKg` (else latest weigh-in), `sex`, `window`, `standards`, `patterns`, `lifts` (skip the analytics call), `analytics` (a StrengthAnalytics object when the global is absent, e.g. tests), plus anything `StrengthAnalytics.analyze` takes (`targets`, `units`, `mainLifts`, `cutStart`), which is passed through.

## Wiring in the app

```js
// CSS: add "StrengthScore" to the css-injection list.
${safeMod("StrengthScore", () => StrengthScore.html(S.docs, strengthOpts()))}   // right after the StrengthAnalytics card
```

The coach / 14-day review can call `StrengthScore.summary(S.docs, strengthOpts())`.

Tests: `node --test modules/strength-score/strength-score.test.js`.
