# Meal preferences (liked and never-pick)

Source: section 6 of `../nutrition-training-handoff.md`.

- **Live list (source of truth):** https://claude.ai/artifact/TYvXrxa2gBeQ7J3dzwDBMw — Aziz adds, removes and moves meals there. Data lives in that artifact's database, collection `prefs` (one document per meal or rule). Claude can read/write it with the ArtifactData tool.
- `meal-preferences.js` — matcher (`classify`, `filterMenu`) plus `DEFAULT_PREFERENCES`, the starting list. Plain ES module for the main app.
- `meal-preferences.json` — the same starting list as JSON. It does not update when the live list changes; use the page's "Copy JSON" for the current list.

Matching: an entry matches a menu name when the name contains any of its `terms` as whole words (plural s/es allowed) and none of its `except` terms. Priority: never > favorite > like > general > neutral.
