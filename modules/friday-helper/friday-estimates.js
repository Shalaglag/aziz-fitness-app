/*
 * Friday free-day estimates for Aziz.
 * Every value is a [low, high] range. Values marked "label" come from a
 * package label; everything else is an estimate and should be treated as one.
 * Plain script: works as a browser global (window.FridayEstimates) or via require().
 */
(function (root) {
  var TARGET_KCAL = 2000;
  var MAINTENANCE = [2700, 2900];
  var PROTEIN_MIN = 160;
  var KCAL_PER_KG_FAT = 7700;

  // Kuwait Flour Mills thin khubz, per 100 g (label).
  var KHUBZ_PER_100G = { kcal: 254, p: 12.7, c: 49, f: 0.8 };
  var KHUBZ_LOAF_G = [50, 65]; // not weighed yet

  var BREAKFAST = {
    eggs3: { name: '3 eggs', kcal: [210, 235], p: [18, 19], c: [1, 2], f: [14, 16] },
    cheese: { name: 'Kraft cheese spread (a little)', kcal: [40, 75], p: [2, 3], c: [1, 2], f: [3, 6] }
  };

  var COOKING = {
    unsure: { name: 'Not sure', kcal: [0, 120], p: [0, 0], c: [0, 0], f: [0, 13.5] },
    dry: { name: 'Non-stick, no fat', kcal: [0, 10], p: [0, 0], c: [0, 0], f: [0, 1] },
    oil: { name: 'Oil', kcal: [40, 120], p: [0, 0], c: [0, 0], f: [4.5, 13.5] },
    butter: { name: 'Butter', kcal: [35, 100], p: [0, 0], c: [0, 0], f: [4, 11] }
  };

  // Shrimp meat for a ½ kg Jumpy Shrimp order. Scaled by portion.
  var SHRIMP_HALF_KG = { name: 'Cajun shrimp', kcal: [300, 375], p: [70, 85], c: [0, 3], f: [3, 6] };
  var PORTIONS = { '0.5': 1, '0.75': 1.5, '1': 2 };

  // Cajun butter sauce for a ½ kg order. Mostly butter: ~90% of kcal from fat.
  var SAUCE = {
    dry: { name: 'Dry Cajun seasoning, no butter', kcal: [10, 40] },
    side: { name: 'Sauce on the side, dipped', kcal: [120, 300] },
    regular: { name: 'Regular (tossed in sauce)', kcal: [300, 700] },
    extra: { name: 'Extra sauce', kcal: [600, 900] }
  };

  var SIDES = {
    corn: { name: 'Corn on the cob', kcal: [90, 150], p: [3, 4], c: [18, 27], f: [1, 5] },
    potato: { name: 'Boiled potato', kcal: [100, 160], p: [2, 4], c: [22, 35], f: [0, 1] },
    sausage: { name: 'Sausage', kcal: [200, 300], p: [9, 13], c: [1, 3], f: [17, 26] },
    egg: { name: 'Boiled egg', kcal: [70, 80], p: [6, 6], c: [0, 1], f: [5, 5] },
    fries: { name: 'Fries (regular)', kcal: [300, 450], p: [3, 5], c: [38, 55], f: [15, 22] },
    rice: { name: 'White rice (1 cup)', kcal: [200, 260], p: [4, 5], c: [45, 57], f: [0, 1] },
    bread: { name: 'Garlic bread / roll', kcal: [150, 250], p: [4, 6], c: [20, 30], f: [5, 12] }
  };

  var DRINKS = {
    water: { name: 'Water', kcal: [0, 0], p: [0, 0], c: [0, 0], f: [0, 0] },
    diet: { name: 'Diet / zero soda', kcal: [0, 5], p: [0, 0], c: [0, 1], f: [0, 0] },
    soda: { name: 'Regular soda (330 mL)', kcal: [135, 150], p: [0, 0], c: [35, 39], f: [0, 0] },
    juice: { name: 'Fresh juice (300 mL)', kcal: [130, 180], p: [1, 2], c: [30, 42], f: [0, 1] }
  };

  var EXTRAS = {
    adonis: { name: 'Adonis Cookie Dough (50 g)', kcal: [192, 192], p: [22, 22], c: [11.4, 11.4], f: [6.2, 6.2], label: true },
    gatorade: { name: 'Gatorade 1 L', kcal: [220, 260], p: [0, 0], c: [55, 65], f: [0, 0] },
    iso100: { name: 'ISO100 scoop (water)', kcal: [110, 120], p: [25, 25], c: [1, 2], f: [0, 1] }
  };

  function scaled(item, n, name) {
    return {
      name: name || item.name,
      kcal: [item.kcal[0] * n, item.kcal[1] * n],
      p: [item.p[0] * n, item.p[1] * n],
      c: [item.c[0] * n, item.c[1] * n],
      f: [item.f[0] * n, item.f[1] * n]
    };
  }

  function sauceItem(level, mult) {
    var s = SAUCE[level];
    var k = [s.kcal[0] * mult, s.kcal[1] * mult];
    return {
      name: s.name,
      kcal: k,
      p: [0, 0],
      c: [k[0] * 0.08 / 4, k[1] * 0.08 / 4],
      f: [k[0] * 0.9 / 9, k[1] * 0.9 / 9]
    };
  }

  function khubzItem(count, loafGrams) {
    var g = loafGrams ? [loafGrams, loafGrams] : KHUBZ_LOAF_G;
    var lo = (g[0] * count) / 100;
    var hi = (g[1] * count) / 100;
    var r = KHUBZ_PER_100G;
    return {
      name: count + ' thin khubz',
      kcal: [r.kcal * lo, r.kcal * hi],
      p: [r.p * lo, r.p * hi],
      c: [r.c * lo, r.c * hi],
      f: [r.f * lo, r.f * hi]
    };
  }

  /*
   * sel = {
   *   breakfast: bool, khubz: number, loafGrams: number|null, cooking: key,
   *   shrimp: bool, portion: '0.5'|'0.75'|'1', sauce: key,
   *   sides: { key: count }, drink: key, drinkCount: number,
   *   extras: { adonis: bool, gatorade: bool, iso100: number },
   *   custom: [{ name, kcal: [lo, hi], p: [lo, hi] }]
   * }
   */
  function itemize(sel) {
    var groups = [];
    if (sel.breakfast) {
      var b = [BREAKFAST.eggs3, BREAKFAST.cheese];
      if (sel.khubz > 0) b.push(khubzItem(sel.khubz, sel.loafGrams));
      b.push(scaled(COOKING[sel.cooking], 1, 'Cooking fat: ' + COOKING[sel.cooking].name.toLowerCase()));
      groups.push({ name: 'Egg breakfast', items: b });
    }
    if (sel.shrimp) {
      var mult = PORTIONS[sel.portion];
      var m = [
        scaled(SHRIMP_HALF_KG, mult, sel.portion.replace('0.5', '½').replace('0.75', '¾') + ' kg Cajun shrimp'),
        sauceItem(sel.sauce, mult)
      ];
      Object.keys(sel.sides || {}).forEach(function (k) {
        var n = sel.sides[k];
        if (n > 0) m.push(scaled(SIDES[k], n, (n > 1 ? n + ' × ' : '') + SIDES[k].name));
      });
      groups.push({ name: 'Shrimp meal', items: m });
    }
    var other = [];
    if (sel.drink && sel.drink !== 'water' && sel.drinkCount > 0) {
      other.push(scaled(DRINKS[sel.drink], sel.drinkCount, (sel.drinkCount > 1 ? sel.drinkCount + ' × ' : '') + DRINKS[sel.drink].name));
    }
    (sel.custom || []).forEach(function (c) {
      other.push({ name: c.name || 'Other food', kcal: c.kcal, p: c.p, c: [0, 0], f: [0, 0], partial: true });
    });
    if (sel.extras && sel.extras.adonis) other.push(EXTRAS.adonis);
    if (sel.extras && sel.extras.gatorade) other.push(EXTRAS.gatorade);
    if (sel.extras && sel.extras.iso100 > 0) other.push(scaled(EXTRAS.iso100, sel.extras.iso100, (sel.extras.iso100 > 1 ? sel.extras.iso100 + ' × ' : '') + EXTRAS.iso100.name));
    if (other.length) groups.push({ name: 'Everything else', items: other });
    return groups;
  }

  function sum(groups) {
    var t = { kcal: [0, 0], p: [0, 0], c: [0, 0], f: [0, 0] };
    groups.forEach(function (g) {
      g.items.forEach(function (i) {
        ['kcal', 'p', 'c', 'f'].forEach(function (k) {
          t[k][0] += i[k][0];
          t[k][1] += i[k][1];
        });
      });
    });
    return t;
  }

  function mid(r) { return (r[0] + r[1]) / 2; }
  function n(x) { return Math.round(x).toLocaleString('en-US'); }

  function verdict(total, sel) {
    var lo = total.kcal[0], hi = total.kcal[1], m = mid(total.kcal);
    var v;
    if (hi <= TARGET_KCAL) {
      v = { tone: 'good', head: 'Under 2,000', text: 'Even the high end is under your 2,000 target. Nothing to change.' };
    } else if (m <= TARGET_KCAL) {
      v = { tone: 'good', head: 'Around 2,000', text: 'The best guess is at or under 2,000. Nothing to change.' };
    } else if (m <= MAINTENANCE[0]) {
      v = { tone: 'ok', head: 'Above target, below maintenance', text: 'Above 2,000 but likely under maintenance (~2,700–2,900), so it is still a fat-loss day. Change nothing.' };
    } else if (m <= MAINTENANCE[1]) {
      v = { tone: 'ok', head: 'Near maintenance', text: 'Around maintenance. That is fine for one free day. Do not cut Saturday; go straight back to the normal plan.' };
    } else {
      v = { tone: 'warn', head: 'Above maintenance', text: 'Probably above maintenance. One day like this barely moves the trend. Do not cut Saturday to make up for it; go straight back to the normal plan.' };
    }
    var notes = [];
    var over = m - TARGET_KCAL;
    if (over > 50) {
      notes.push('About ' + n(Math.round(over / 10) * 10) + ' kcal more than a 2,000 day, which slows this week\'s fat loss by roughly ' + Math.round(over / KCAL_PER_KG_FAT * 1000 / 10) * 10 + ' g.');
    } else if (over < -50) {
      notes.push('About ' + n(Math.round(-over / 10) * 10) + ' kcal under 2,000. No need to eat more to hit the number on a free day.');
    }
    if (total.p[1] < PROTEIN_MIN) {
      var gap = Math.ceil(PROTEIN_MIN - mid(total.p));
      notes.push('Protein is ' + Math.round(total.p[0]) + '–' + Math.round(total.p[1]) + ' g, about ' + gap + ' g short of 160. ' + (sel.extras && sel.extras.adonis ? 'An ISO100 scoop (+25 g)' : 'Adonis (+22 g) or an ISO100 scoop (+25 g)') + ' closes most of it.');
    } else if (total.p[0] < PROTEIN_MIN) {
      notes.push('Protein is ' + Math.round(total.p[0]) + '–' + Math.round(total.p[1]) + ' g, likely close to 160. Fine for a free day.');
    }
    if (sel.shrimp && sel.sauce !== 'dry') {
      notes.push('Cajun sauce is salty. Saturday\'s weigh-in may read 0.5–1.5 kg high from water and fade over 1–3 days. Log it anyway; the 7-day average handles it.');
    }
    if (sel.shrimp && sel.sauce === 'regular') {
      var save = sauceItem('regular', PORTIONS[sel.portion]);
      var side = sauceItem('side', PORTIONS[sel.portion]);
      notes.push('Sauce on the side would save about ' + Math.round((mid(save.kcal) - mid(side.kcal)) / 10) * 10 + ' kcal.');
    }
    v.notes = notes;
    return v;
  }

  function estimate(sel) {
    var groups = itemize(sel);
    var total = sum(groups);
    return { groups: groups, total: total, best: mid(total.kcal), verdict: verdict(total, sel) };
  }

  var api = {
    TARGET_KCAL: TARGET_KCAL, MAINTENANCE: MAINTENANCE, PROTEIN_MIN: PROTEIN_MIN,
    KHUBZ_LOAF_G: KHUBZ_LOAF_G, COOKING: COOKING, SAUCE: SAUCE, SIDES: SIDES,
    DRINKS: DRINKS, EXTRAS: EXTRAS, PORTIONS: PORTIONS,
    estimate: estimate, mid: mid
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FridayEstimates = api;
})(this);
