# App shortcuts

Long-press the app icon (once the app is installed to the home screen) to jump straight to:

| Shortcut | Opens | Focuses |
|---|---|---|
| Log weight | Today | the morning weigh-in box |
| Add water | Today | the +250 ml button |
| Start workout | Train | top of the Train tab |
| Log food | Food | the food name box |

The shortcuts live in `app/manifest.webmanifest` and open `index.html#<action>`. Nothing is saved
automatically: a shortcut only opens the right place, so reloading the page can't log twice.

## API

- `AppShortcuts.parse(hash)` → `{action, tab, focus, label}` or `null` for anything else (plain tab
  hashes like `#food` stay with the shell).
- `AppShortcuts.manifestShortcuts(base = "./index.html")` → the manifest `shortcuts` array. The test
  checks the manifest file matches it.

The shell reads the hash on load and on `hashchange`, switches tab, focuses the element, then clears
the hash with `history.replaceState`.

Shortcuts need the app served from its own web address and installed. Inside the claude.ai
Artifact viewer the manifest is ignored, and the hash handling does nothing harmful.
