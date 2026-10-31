# Aziz Cut Tracker: local copy

This folder holds the whole fitness app project: the main app, the feature modules built for it, the standalone tools, and the plan documents. This GitHub repo (Shalaglag/aziz-fitness-app, created Oct 25, 2026) is the home for the code. Every feature thread builds into it, and the online versions and the copy on your PC are updated from it.

## How to open it

**On the phone (the real app):** install the Android app from the `android-latest` release, steps in [docs/ANDROID.md](docs/ANDROID.md).

**Easiest:** double-click `Open the app.html` in this folder (or `app/index.html`). It opens in your browser, no install needed.

- Needs internet only for the fonts. Everything else works offline.
- Opened from this folder, the app saves to **this browser only** (localStorage). The header says "Saved in this browser only".
- To get your data **synced between phone and computer**, use the online version: https://claude.ai/artifact/EBaguVa4wy8ED9pyxJuT8T . The local copy and the online copy do not share data.

## What's in here

| Folder | What it is |
|---|---|
| `app/index.html` | The main app (Today, Train, Food, Progress, Guide tabs). |
| `build/` | Builds `app/index.html` from `build/shell.html` plus the modules (`node build/build.js`; `--check` verifies the committed app). |
| `modules/` | Pieces built to plug into the app: cutting guide, Friday helper, hydration, meal preferences, progressive overload (double progression), sleep and recovery, and the Plate theme kit. The `.js` and `.json` files are what get inlined into the app. |
| `tools/` | Standalone pages: food log, exercise form guide, Nutreeze meal picker, pre-workout check, today's schedule, strength log, Strong screenshot reader, supplement guide (plus `supplement-reminders.ics` to import into your calendar), weight tracker. |
| `docs/` | `nutrition-training-handoff.md` (the full plan), `APP-SHELL.md` (how the app is built and its data model), the Nutreeze menu format, and the still-owed info list. |

Open any `.html` file by double-clicking it. Each folder is self-contained, so keep a page next to its `.js` / `.json` / `.png` files.

### Tools that need the online version to save

These pages save only through Claude's synced storage, so opened from this folder they show your plan but can't log anything. Use the online links for logging:

- Strength log: https://claude.ai/artifact/KwkiyLptWCXHL7VNUsztkW
- Strong screenshot reader: https://claude.ai/artifact/JDbgEX5He9e7yCX33FJVTF (manual entry only offline)
- Weight tracker ("Road to 80 kg"): https://claude.ai/artifact/MQB83XJ3MG1aN6v7cLn1Dc

The food log and hydration tracker fall back to browser storage when opened locally.

## Online versions

- Main app: https://claude.ai/artifact/EBaguVa4wy8ED9pyxJuT8T
- Food log: https://claude.ai/artifact/FLvBap9dWfQeQxDjJxtNm7
- Meal picker: https://claude.ai/artifact/XCZwySGP2UYQpZ6wGjFsFa
- Form guide: https://claude.ai/artifact/SCrKFCYApEXvi3zgFPfaTs
- Double progression: https://claude.ai/artifact/UWCXCMAcsLWTs91D72Rc2Y
- Cutting guide: https://claude.ai/artifact/Qp8nskmG17V3m9Pp1JqCd6
- Friday free day: https://claude.ai/artifact/FtP5RE21T9eUrGDZ7CDP3L
- Water log: https://claude.ai/artifact/H6zXMRRXP1tdtj3aFejA6S
- Sleep and recovery: https://claude.ai/artifact/4TwMsTfqZWvRWSAE6gmjM3
- Plate theme kit: https://claude.ai/artifact/TAHYUTfeDfMb1QsDLiqYNL
- Pre-workout check: https://claude.ai/artifact/HUXjangSJTdDWV9VKdjzYn
- Today: https://claude.ai/artifact/AcoPwzRx9p5x32Ef675mNt
- Supplement box: https://claude.ai/artifact/Y6DJtmQWGXmkeFmenXRj6f
- Still owed list: https://claude.ai/artifact/C21t7Zpaj7U2wmKV2s7twW

## Updating

When the app changes, the new files are copied into this folder over the old ones. Edits you make here yourself are kept: Claude checks before overwriting anything that changed on your side.
