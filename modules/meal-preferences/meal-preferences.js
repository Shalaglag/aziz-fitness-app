// Meal preferences: Aziz's liked meals and never-pick list, plus the matcher
// that tags a Nutreeze menu item. Plain ES module, no dependencies.
//
// Entry shape:
//   { id, name, list: "like" | "never", level: "favorite" | "like" | "general" (likes only),
//     kind: "meal" | "snack" | "rule", terms: [phrases], except: [phrases], note }
// A menu item matches an entry when it contains any of `terms` as whole words
// (a trailing "s"/"es" is allowed) and none of `except`.
// Priority: never > favorite > like > general > neutral.

export const DEFAULT_PREFERENCES = [
  { id: "french-tacos-chicken", name: "French Tacos Chicken", list: "like", level: "favorite", kind: "meal", terms: ["French Tacos Chicken", "Chicken French Tacos"], except: [], note: "Favorite. Prioritize when it fits." },
  { id: "buffalo-chicken-sweet-potato", name: "Buffalo Chicken with Sweet Potato", list: "like", level: "like", kind: "meal", terms: ["Buffalo Chicken"], except: [], note: "" },
  { id: "chicken-majboos", name: "Chicken Majboos", list: "like", level: "like", kind: "meal", terms: ["Chicken Majboos", "Chicken Machboos", "Chicken Machbous"], except: [], note: "" },
  { id: "chicken-biryani", name: "Chicken Biryani", list: "like", level: "like", kind: "meal", terms: ["Chicken Biryani"], except: [], note: "" },
  { id: "beef-machboos", name: "Beef Machboos", list: "like", level: "like", kind: "meal", terms: ["Beef Machboos", "Beef Majboos", "Beef Machbous"], except: [], note: "" },
  { id: "grilled-steak-potato", name: "Grilled Steak with Potato", list: "like", level: "like", kind: "meal", terms: ["Grilled Steak"], except: [], note: "" },
  { id: "general-chicken-rice-steak-pasta", name: "Chicken, rice, steak and pasta dishes", list: "like", level: "general", kind: "rule", terms: ["chicken", "rice", "steak", "pasta"], except: [], note: "Liked in general." },

  { id: "creamy-garlic-cheesy-chicken", name: "Creamy Garlic Cheesy Chicken & Potato", list: "never", kind: "meal", terms: ["Creamy Garlic Cheesy Chicken"], except: [], note: "" },
  { id: "chicken-mushroom-sourdough", name: "Chicken Mushroom with Sourdough", list: "never", kind: "meal", terms: ["Chicken Mushroom with Sourdough", "Chicken Mushroom Sourdough"], except: [], note: "" },
  { id: "chicken-shawarma", name: "Chicken Shawarma", list: "never", kind: "meal", terms: ["Chicken Shawarma", "Shawarma"], except: [], note: "" },
  { id: "champion-chicken", name: "Champion Chicken", list: "never", kind: "meal", terms: ["Champion Chicken"], except: [], note: "" },
  { id: "minced-beef-rice", name: "Minced Beef with Rice", list: "never", kind: "meal", terms: ["Minced Beef with Rice", "Minced Beef Rice"], except: [], note: "" },
  { id: "tandoori-chicken-tomato-jam", name: "Tandoori Chicken with Grilled Tomato Jam", list: "never", kind: "meal", terms: ["Tandoori Chicken with Grilled Tomato Jam", "Tomato Jam"], except: [], note: "" },
  { id: "fish-seafood", name: "Tuna, fish or shrimp dishes", list: "never", kind: "rule", terms: ["tuna", "fish", "shrimp", "prawn", "salmon", "hammour", "seafood", "cod", "sea bass", "calamari"], except: [], note: "Any fish or seafood." },
  { id: "sandwiches", name: "Sandwiches (except French Tacos Chicken)", list: "never", kind: "rule", terms: ["sandwich", "panini", "sub"], except: ["French Tacos"], note: "" },
  { id: "protein-balls", name: "Protein balls (incl. Kinder Protein Ball)", list: "never", kind: "snack", terms: ["protein ball", "Kinder"], except: [], note: "" },
  { id: "popcorn", name: "Popcorn", list: "never", kind: "snack", terms: ["Popcorn"], except: [], note: "" },
  { id: "blueberry-vanilla-muffin", name: "Blueberry Vanilla Muffin", list: "never", kind: "snack", terms: ["Blueberry Vanilla Muffin", "Blueberry Muffin"], except: [], note: "" },
];

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsPhrase(text, phrase) {
  const p = normalize(phrase);
  if (!p) return false;
  const words = p.split(" ").map(escapeRe).join("(?:s|es)? ");
  return new RegExp("(?:^| )" + words + "(?:s|es)?(?: |$)").test(normalize(text));
}

export function matches(entry, menuName) {
  const hit = (entry.terms || []).find((t) => containsPhrase(menuName, t));
  if (!hit) return null;
  if ((entry.except || []).some((t) => containsPhrase(menuName, t))) return null;
  return hit;
}

const RANK = { never: 0, favorite: 1, like: 2, general: 3 };

// Returns { status: "never" | "favorite" | "like" | "general" | "neutral", entry, term }
export function classify(menuName, prefs = DEFAULT_PREFERENCES) {
  let best = null;
  for (const entry of prefs) {
    const term = matches(entry, menuName);
    if (!term) continue;
    const status = entry.list === "never" ? "never" : entry.level || "like";
    if (!best || RANK[status] < RANK[best.status]) best = { status, entry, term };
  }
  return best || { status: "neutral", entry: null, term: null };
}

// Drop never-pick items from a menu and sort the rest: favorite, like, general, neutral.
export function filterMenu(items, prefs = DEFAULT_PREFERENCES, getName = (x) => x.name ?? x) {
  const order = { favorite: 0, like: 1, general: 2, neutral: 3 };
  return items
    .map((item) => ({ item, ...classify(getName(item), prefs) }))
    .filter((r) => r.status !== "never")
    .sort((a, b) => order[a.status] - order[b.status]);
}
