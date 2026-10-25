# Progress photos

Weekly front / side / back photos for the Progress tab, with a before/after slider and an aligned timelapse that shows weight and waist on each frame.

- `progress-photos.js`: the module (plain JS, no imports, no network). Global `ProgressPhotos`.
- `preview.html`: the card on its own, with six demo weeks. "Try mine" keeps photos in that browser only.
- `test.js`: `node modules/progress-photos/test.js` (helper checks plus a Chromium run of the preview and of the assets path).

## What it does

- Three photo slots for any day (defaults to today). Tap to take or pick a photo; tap again to replace. Delete takes two taps.
- Each photo is shrunk to 1600 px on the long edge and re-saved as JPEG before it is stored, which also strips EXIF (GPS location, camera details).
- Optional waist (cm) typed on the photo day.
- "Line up": this day's photo sits half see-through over the first photo of that pose; drag it or use the size / left-right / up-down sliders. The alignment is saved and used in the slider and the timelapse, so the body stays put from week to week.
- Compare: pick a pose, then a Before and After day. Slider (drag or tap anywhere on the photo; horizontal swipes slide, vertical swipes still scroll the page) or side by side. Shows the weigh-in nearest each day (within 3 days) and the change.
- Timelapse: every photo of the pose in order, cross-faded, with "Week N · date", weight and change, waist and change on top. Play / pause, scrubber, three speeds. Lingers on the latest photo before looping.
- Due badge: "Take your first set today", "Still to take: Side, Back", "Photos due", or "Next photos Sun Dec 6" (7 days after the last set).

## Wiring it into the app

Data: one doc per photo day in a new `photos` collection.

```
photos/{date}: { date, front?, side?, back?, waist?, align?: { front?: {x, y, s}, side?, back? }, at }
```

Each pose holds the asset id from the `assets` capability. Display is `"/_blob/" + id`. When `assets` isn't available (the local copy), photos go to the browser's IndexedDB with refs like `idb:<key>`.

```js
// Progress tab, mounted once into its own host (like #lbHost) so re-renders don't wipe it
const assets = await window.claude?.use("assets").catch(() => null);
const photos = ProgressPhotos.mount(document.getElementById("ppHost"), {
  storage: S.db ? {
    list: c => S.db.collection(c).get().then(qs => qs.docs.map(d => d.data())),
    put: (c, id, doc) => S.db.collection(c).doc(id).set(doc),
    remove: (c, id) => S.db.collection(c).doc(id).delete(),
  } : undefined,            // undefined = localStorage
  assets,                   // null = IndexedDB in this browser
  weights: { list: async () => weightsSorted().map(w => ({ date: w.date, kg: w.kg })) },
  measures: { list: async () => [] }, // optional: waist logged elsewhere, [{date, waist}]
});
// call photos.refresh() when the Progress tab is opened, to pick up photos taken on the other device
```

Add `assets: {}` to the app's existing capabilities (it already has `db` and `downloads`). Only people who can edit the artifact get `assets`, which is just Aziz while the app stays private.
