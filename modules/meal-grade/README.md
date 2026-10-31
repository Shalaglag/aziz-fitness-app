# Meal grade (A–D per food row and per day)

One letter next to every meal, snack and menu item, and one for the day, so the better Nutreeze options stand out before you pick. Plain JS, no DOM beyond two HTML helpers, no network. Browser global `window.MealGrade` or CommonJS.

- `meal-grade.js`: the module.
- `meal-grade.test.js`: `node --test modules/meal-grade/meal-grade.test.js`

## How a row is graded

Score 0–100 → **A** 80+, **B** 60+, **C** 40+, **D** below.

| Kind | Protein density (g protein per 100 kcal) | Fit to the day | Penalty |
|---|---|---|---|
| Meal (slot Meal 1/2, Breakfast; menu section meal/salad/soup; else 350+ kcal) | 70 pts, 0 at 4 g/100 kcal, full at 12 (the plan needs ~8: 160 g in 2,000 kcal) | 30 pts when the meal is 25–40 % of the day's kcal target, −1 per % outside | −10 when fat is over 40 % of its calories |
| Snack (Snack, Extra, Adonis; other menu sections; else under 350 kcal) | 50 pts, full at 8 g/100 kcal | 50 pts at 120 kcal or less, 0 at 300 kcal | −15 when fat is 15 g or more |

Examples: Buffalo Chicken 496 kcal / 65 P → A, Chicken Masala → A, French Tacos → B; Popcorn → A, Fruit Salad → B, Banana → C, Herbs Roasted Walnut and Pro Mud Cake → D, Adonis → A. A row with no kcal or protein number has no grade (`null`).

## How a day is graded

Protein 40 (full at the minimum, 0 at 40 g under), calories 35 (full inside the kcalLo–kcalHi band, −1 per 10 kcal outside), fat 15 (−1 per 2 g over fatHi), carbs 10 (in range 10, within 20 g 5). **A** 85+, **B** 70+, **C** 50+, **D** below. `basis: "plan"` (default) counts planned and eaten rows, `"eaten"` only ticked rows. An empty day has no grade.

## API

- `gradeItem(item, {kind, targets})` → `{grade, score, density, kcalShare, fatShare, kind, label, reasons}` or `null`. Reads `p`/`protein`, `f`/`fat`, `kcal`.
- `gradeDay(food, {targets, basis})` → `{grade, score, totals, parts:[{key,label,got,max,detail}], reasons, basis, count}` or `null`.
- `density(item)`, `kindOf(item)`, `targetsFrom(t)` (AppTargets shape, the picker's `{kcal, proteinMin, proteinMax, fat:[], carbs:[]}`, or the shell's `TARGET`; day target drives the meal's kcal share).
- `badge(res, {small, title})`, `dayBadge(res)` → HTML pills; add `MealGrade.css` once.

## Where it shows in the app

Food tab: a letter on every row of "Today's food", the Nutreeze snack table, the menu-import item list and both pickers' options, and a "Day A/B/C/D" pill in the verdict row (planned until everything is ticked, then eaten). Grades use `dayTargets(date)`, so a diet break or calorie-cycling day moves the kcal share with it.
