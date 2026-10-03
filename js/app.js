/*
 * Gut Log — a private, on-device tracker for bowel movements, food, drinks,
 * stress and sleep, with a simple "possible food triggers" analysis.
 *
 * Data model (stored in localStorage under STORE_KEY):
 *   { version: 1, entries: Entry[], settings: {...}, learnedTags: {item: tag[]} }
 *
 * Every entry has an id, a `type`, a `ts` (ISO string) and createdAt/updatedAt.
 *
 *   'bm'    { bristol (1-7), pain (0-10), urgency (0-3), abnormalities: string[],
 *             color: string|null, notes }
 *   'meal'  { mealType, items: string[] (lowercase), tags: string[], portion, notes }
 *   'drink' { drink (DRINKS id), oz: number, notes }
 *   'day'   { date: 'YYYY-MM-DD', stress (1-5)|null, sleepHours|null,
 *             sleepQuality (1-5)|null, notes }  — one per day, id 'day-YYYY-MM-DD'
 */
(function () {
  'use strict';

  const STORE_KEY = 'gutlog.v1';
  const THEME_KEY = 'gutlog.theme';
  const RANGE_KEY = 'gutlog.range';
  const HOUR = 3600000;
  const DEFAULT_WINDOW = { windowStart: 2, windowEnd: 24 };

  // ---------- Reference data ----------

  const BRISTOL = [
    { n: 1, name: 'Separate hard lumps', short: 'Hard lumps', desc: 'Hard lumps, like nuts — hard to pass', group: 'Constipated' },
    { n: 2, name: 'Lumpy sausage', desc: 'Sausage-shaped but lumpy', group: 'Constipated' },
    { n: 3, name: 'Cracked sausage', desc: 'Sausage with cracks on the surface', group: 'Typical' },
    { n: 4, name: 'Smooth snake', desc: 'Smooth and soft, like a snake', group: 'Typical' },
    { n: 5, name: 'Soft blobs', desc: 'Soft blobs with clear-cut edges', group: 'Loose' },
    { n: 6, name: 'Mushy', desc: 'Fluffy, ragged pieces — mushy', group: 'Loose' },
    { n: 7, name: 'Watery', desc: 'Watery, no solid pieces — entirely liquid', group: 'Loose' }
  ];

  const URGENCY = ['None', 'Some', 'Urgent', 'Accident'];

  const ABNORMALITIES = [
    { id: 'blood_bright', label: 'Bright red blood', flag: true, blood: true },
    { id: 'blood_dark', label: 'Dark / maroon blood', flag: true, blood: true },
    { id: 'black_tarry', label: 'Black / tarry', flag: true, blood: true },
    { id: 'mucus', label: 'Mucus' },
    { id: 'pus', label: 'Pus', flag: true },
    { id: 'undigested', label: 'Undigested food' },
    { id: 'greasy', label: 'Greasy / floating' },
    { id: 'foul', label: 'Unusually foul smell' },
    { id: 'straining', label: 'Straining' },
    { id: 'incomplete', label: 'Felt incomplete' },
    { id: 'gas', label: 'Lots of gas' }
  ];
  const ABN_BY_ID = Object.fromEntries(ABNORMALITIES.map(a => [a.id, a]));

  const COLORS = [
    { id: 'brown', label: 'Brown', hex: '#6b4226' },
    { id: 'light_brown', label: 'Light brown', hex: '#a0703f' },
    { id: 'dark_brown', label: 'Dark brown', hex: '#3e2412' },
    { id: 'yellow', label: 'Yellow', hex: '#d4b020' },
    { id: 'green', label: 'Green', hex: '#4f7a2a' },
    { id: 'red', label: 'Red', hex: '#b3261e' },
    { id: 'black', label: 'Black', hex: '#111111' },
    { id: 'pale', label: 'Pale / clay', hex: '#d8cfb8' }
  ];
  const COLOR_BY_ID = Object.fromEntries(COLORS.map(c => [c.id, c]));

  const PAIN_WORDS = ['None', 'Minimal', 'Mild', 'Mild', 'Moderate', 'Moderate', 'Moderate', 'Severe', 'Severe', 'Very severe', 'Worst'];

  // Simple illustrations of each Bristol type (viewBox 0 0 100 40).
  const BRISTOL_SVG = {
    1: '<circle cx="16" cy="21" r="7"/><circle cx="34" cy="18" r="6"/><circle cx="50" cy="23" r="7"/><circle cx="67" cy="18" r="6"/><circle cx="84" cy="22" r="7"/>',
    2: '<circle cx="20" cy="21" r="10"/><circle cx="33" cy="18" r="10"/><circle cx="46" cy="22" r="10"/><circle cx="59" cy="18" r="10"/><circle cx="72" cy="22" r="10"/><circle cx="83" cy="19" r="9"/>',
    3: '<rect x="8" y="11" width="84" height="18" rx="9"/><path class="crack" d="M24 11l3 6M38 11l-2 5M52 11l3 7M66 11l-3 5M78 12l2 5M30 29l2-5M58 29l-3-5"/>',
    4: '<path class="snake" d="M10 24c10-14 22-14 32-4s22 10 32-2 14-6 16-2"/>',
    5: '<ellipse cx="20" cy="22" rx="12" ry="9"/><ellipse cx="49" cy="20" rx="13" ry="10"/><ellipse cx="78" cy="22" rx="12" ry="9"/>',
    6: '<path d="M8 26c2-8 8-7 10-11 3-5 9-3 11 0 3-4 10-5 12 0 3-3 9-2 10 3 3-3 10-2 11 3 4-2 9 0 10 4 3 0 8 3 7 8-3 4-9 2-12 3-5 2-10 0-14 1-6 1-10-1-15 0-6 1-10-1-15 0-6 1-12 1-15-1z"/>',
    7: '<path class="water" d="M6 26c6-6 14-8 26-6s18 6 30 2 22-6 32 0c4 3 0 8-8 8H14c-8 0-11-1-8-4z"/><circle cx="30" cy="16" r="2.5"/><circle cx="62" cy="15" r="2"/>'
  };

  function bristolSvg(n) {
    return '<svg class="stool" viewBox="0 0 100 40" aria-hidden="true">' + BRISTOL_SVG[n] + '</svg>';
  }

  const MEAL_TYPES = [
    { id: 'breakfast', label: 'Breakfast' },
    { id: 'lunch', label: 'Lunch' },
    { id: 'dinner', label: 'Dinner' },
    { id: 'snack', label: 'Snack' }
  ];
  const MEAL_BY_ID = Object.fromEntries(MEAL_TYPES.map(m => [m.id, m]));

  const PORTIONS = [
    { id: 'small', label: 'Small' },
    { id: 'normal', label: 'Normal' },
    { id: 'large', label: 'Large' }
  ];

  // Tags with keywords used to auto-tag typed foods. Keywords match whole
  // words (with an optional plural "s"/"es"), so "tea" won't match "steak".
  const FOOD_TAGS = [
    { id: 'dairy', label: 'Dairy', kw: ['milk', 'cheese', 'yogurt', 'yoghurt', 'ice cream', 'cream', 'butter', 'latte', 'cappuccino', 'pizza', 'mac and cheese', 'queso', 'alfredo', 'milkshake', 'custard', 'pudding', 'whey', 'cheesecake', 'quesadilla', 'nachos', 'lasagna', 'cheeseburger', 'frappuccino', 'kefir'] },
    { id: 'gluten', label: 'Gluten / wheat', kw: ['bread', 'toast', 'pasta', 'spaghetti', 'noodle', 'pizza', 'bagel', 'sandwich', 'burger', 'cheeseburger', 'bun', 'wrap', 'cracker', 'cereal', 'cookie', 'cake', 'muffin', 'pancake', 'waffle', 'donut', 'doughnut', 'pretzel', 'croissant', 'beer', 'wheat', 'barley', 'rye', 'couscous', 'biscuit', 'pie', 'ramen', 'sub', 'pastry', 'breaded', 'lasagna', 'mac and cheese', 'dumpling', 'flour tortilla', 'brownie', 'quesadilla'] },
    { id: 'fiber', label: 'High fiber / raw veg', kw: ['salad', 'broccoli', 'cauliflower', 'cabbage', 'kale', 'spinach', 'lettuce', 'raw', 'bran', 'oat', 'oatmeal', 'whole wheat', 'whole grain', 'brown rice', 'quinoa', 'nut', 'almond', 'peanut', 'walnut', 'cashew', 'seed', 'chia', 'flax', 'popcorn', 'corn', 'apple', 'pear', 'berry', 'strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'raspberries', 'prune', 'celery', 'carrot', 'brussels sprout', 'asparagus', 'vegetable', 'veggie', 'coleslaw', 'granola', 'trail mix', 'artichoke'] },
    { id: 'legumes', label: 'Beans / legumes', kw: ['bean', 'lentil', 'chickpea', 'hummus', 'pea', 'edamame', 'tofu', 'falafel', 'refried beans', 'burrito', 'dal'] },
    { id: 'onion_garlic', label: 'Onion / garlic', kw: ['onion', 'garlic', 'shallot', 'leek', 'scallion', 'salsa', 'marinara', 'guacamole', 'onion rings'] },
    { id: 'spicy', label: 'Spicy', kw: ['spicy', 'hot sauce', 'chili', 'chilli', 'jalapeno', 'jalapeño', 'sriracha', 'curry', 'buffalo', 'cajun', 'wings', 'tabasco', 'hot cheetos', 'kimchi', 'hot wings', 'pepper flakes', 'habanero', 'vindaloo', 'szechuan'] },
    { id: 'fatty', label: 'Fried / fatty', kw: ['fried', 'fries', 'fry', 'burger', 'cheeseburger', 'bacon', 'sausage', 'pizza', 'wings', 'nugget', 'chips', 'donut', 'doughnut', 'cheesesteak', 'gravy', 'alfredo', 'mayo', 'tempura', 'fast food', 'onion rings', 'hot dog', 'pepperoni', 'fried chicken', 'nachos', 'quesadilla', 'ice cream', 'milkshake', 'cheesecake', 'ribs', 'brisket', 'avocado'] },
    { id: 'red_meat', label: 'Red meat', kw: ['beef', 'steak', 'burger', 'cheeseburger', 'pork', 'lamb', 'ham', 'bacon', 'sausage', 'pepperoni', 'meatball', 'brisket', 'ribs', 'hot dog', 'salami', 'chorizo', 'veal', 'cheesesteak', 'meatloaf', 'pulled pork', 'lasagna'] },
    { id: 'processed', label: 'Processed', kw: ['hot dog', 'deli', 'salami', 'pepperoni', 'bacon', 'ham', 'sausage', 'nugget', 'chips', 'frozen', 'instant', 'ramen', 'fast food', 'candy', 'soda', 'spam', 'jerky', 'lunch meat', 'cereal', 'hot pocket', 'cheetos', 'doritos', 'pop tart', 'lunchable'] },
    { id: 'sugar', label: 'Sugar / sweeteners', kw: ['candy', 'chocolate', 'cake', 'cookie', 'donut', 'doughnut', 'ice cream', 'soda', 'juice', 'sugar', 'sweet', 'dessert', 'pastry', 'syrup', 'honey', 'gum', 'sugar free', 'sugar-free', 'diet soda', 'sorbitol', 'xylitol', 'energy drink', 'gatorade', 'pie', 'brownie', 'muffin', 'jam', 'jelly', 'milkshake', 'frappuccino', 'pop tart', 'cheesecake', 'smoothie'] },
    { id: 'caffeine', label: 'Caffeine', kw: ['coffee', 'espresso', 'latte', 'cappuccino', 'tea', 'cola', 'coke', 'pepsi', 'mountain dew', 'dr pepper', 'energy drink', 'red bull', 'monster', 'matcha', 'cold brew', 'frappuccino', 'americano', 'mocha'] },
    { id: 'alcohol', label: 'Alcohol', kw: ['beer', 'wine', 'vodka', 'whiskey', 'whisky', 'rum', 'tequila', 'gin', 'cocktail', 'margarita', 'hard seltzer', 'cider', 'sake', 'champagne', 'mimosa', 'alcohol', 'bourbon', 'ipa', 'lager', 'seltzer'] }
  ];
  const TAG_BY_ID = Object.fromEntries(FOOD_TAGS.map(t => [t.id, t]));
  const TAG_MATCHERS = FOOD_TAGS.map(t => ({
    id: t.id,
    re: new RegExp('(^|[^a-z])(' + t.kw.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(s|es)?([^a-z]|$)')
  }));

  const DRINKS = [
    { id: 'water', label: 'Water', tags: [] },
    { id: 'coffee', label: 'Coffee', tags: ['caffeine'] },
    { id: 'tea', label: 'Tea', tags: ['caffeine'] },
    { id: 'soda', label: 'Soda', tags: ['sugar', 'caffeine'] },
    { id: 'diet_soda', label: 'Diet soda', tags: ['sugar', 'caffeine'] },
    { id: 'juice', label: 'Juice', tags: ['sugar'] },
    { id: 'milk', label: 'Milk', tags: ['dairy'] },
    { id: 'alcohol', label: 'Alcohol', tags: ['alcohol'] },
    { id: 'sports', label: 'Sports / electrolyte', tags: ['sugar'] },
    { id: 'energy', label: 'Energy drink', tags: ['caffeine', 'sugar'] },
    { id: 'smoothie', label: 'Smoothie / shake', tags: ['sugar'] },
    { id: 'other', label: 'Other', tags: [] }
  ];
  const DRINK_BY_ID = Object.fromEntries(DRINKS.map(d => [d.id, d]));
  const OZ_PRESETS = [8, 12, 16, 20, 32];

  const STRESS = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
  const SLEEP_Q = ['Terrible', 'Poor', 'OK', 'Good', 'Great'];

  const ICONS = {
    meal: '<svg class="entry-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2.5 1-4 3.5-4 7v3h4"/></svg>',
    drink: '<svg class="entry-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12l-1.5 16a1.5 1.5 0 0 1-1.5 1.3H9a1.5 1.5 0 0 1-1.5-1.3L6 4zM6.7 10h10.6"/></svg>',
    day: '<svg class="entry-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
  };

  // ---------- Storage ----------

  function emptyStore() {
    return { version: 1, entries: [], settings: { ...DEFAULT_WINDOW }, learnedTags: {} };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries)) return emptyStore();
      data.settings = { ...DEFAULT_WINDOW, ...(data.settings || {}) };
      data.learnedTags = data.learnedTags || {};
      return data;
    } catch (e) {
      console.error('Could not read saved data', e);
      return emptyStore();
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      console.error(e);
      toast('Could not save — storage may be full or blocked.');
      return false;
    }
  }

  function prefGet(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; }
  }
  function prefSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  let store = loadStore();

  const byNewest = (a, b) => b.ts.localeCompare(a.ts);
  function entriesOf(type) {
    return store.entries.filter(e => e.type === type).sort(byNewest);
  }
  const bmEntries = () => entriesOf('bm');

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function getWindow() {
    const s = store.settings || DEFAULT_WINDOW;
    return { start: s.windowStart, end: s.windowEnd };
  }

  // ---------- Helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const pad = n => String(n).padStart(2, '0');
  function toLocalInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function dayKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function dateFromKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  function startOfDay(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
  }
  function fmtTime(d) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDayHeading(d) {
    const today = startOfDay(new Date());
    const diff = Math.round((today - startOfDay(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  }
  function fmtShortDate(d) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  const round1 = n => Math.round(n * 10) / 10;
  const pct = r => Math.round(100 * r) + '%';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function normFood(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function hasBlood(e) {
    return (e.abnormalities || []).some(a => ABN_BY_ID[a] && ABN_BY_ID[a].blood);
  }

  // What counts as a "problem" bowel movement for trigger analysis.
  const PROBLEMS = [
    { id: 'loose', label: 'Loose (6–7)', test: e => e.bristol >= 6 },
    { id: 'pain', label: 'Pain 4+', test: e => (e.pain || 0) >= 4 },
    { id: 'bloodMucus', label: 'Blood / mucus', test: e => hasBlood(e) || (e.abnormalities || []).includes('mucus') },
    { id: 'urgency', label: 'Urgent / accident', test: e => (e.urgency || 0) >= 2 }
  ];
  const isProblem = e => PROBLEMS.some(p => p.test(e));

  // Foods & drinks (not water) eaten within the reaction window before `ts`.
  function intakeBefore(ts) {
    const { start, end } = getWindow();
    const t = new Date(ts).getTime();
    return store.entries
      .filter(e => (e.type === 'meal' || (e.type === 'drink' && e.drink !== 'water')))
      .filter(e => { const dt = t - new Date(e.ts).getTime(); return dt >= start * HOUR && dt <= end * HOUR; })
      .sort(byNewest);
  }
  function intakeNames(e) {
    return e.type === 'meal' ? (e.items || []) : [(DRINK_BY_ID[e.drink] || DRINK_BY_ID.other).label.toLowerCase()];
  }

  // ---------- Navigation ----------

  let currentView = 'log';
  function showView(name) {
    currentView = name;
    $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + name));
    $$('.tab').forEach(t => {
      const on = t.dataset.view === name;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    if (name === 'history') renderHistory();
    if (name === 'insights') renderInsights();
    if (name === 'triggers') renderTriggers();
    if (name === 'settings') renderSettings();
    if (name === 'log') refreshLogExtras();
    window.scrollTo(0, 0);
  }

  // ---------- Log forms ----------

  const forms = {
    bm: $('#bm-form'),
    meal: $('#meal-form'),
    drink: $('#drink-form'),
    day: $('#day-form')
  };
  const TITLES = {
    bm: ['Log a bowel movement', 'Edit bowel movement'],
    meal: ['Log food', 'Edit food'],
    drink: ['Log a drink', 'Edit drink'],
    day: ['Daily check-in', 'Edit check-in']
  };
  const SAVE_LABELS = { bm: 'Save entry', meal: 'Save food', drink: 'Save drink', day: 'Save check-in' };
  let logType = 'bm';
  const form = forms.bm;

  function radios(name, options, checkedId) {
    return options.map(o => `
      <label><input type="radio" name="${name}" value="${o.id}" ${String(o.id) === String(checkedId) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('');
  }
  const checkedVal = (f, name) => (f.querySelector(`input[name="${name}"]:checked`) || {}).value;
  function setRadio(f, name, value) {
    $$(`input[name="${name}"]`, f).forEach(i => { i.checked = value != null && i.value === String(value); });
  }

  function setLogType(type) {
    logType = type;
    setRadio($('#log-switch'), 'logtype', type);
    Object.entries(forms).forEach(([t, f]) => f.classList.toggle('hidden', t !== type));
    $('#log-title').textContent = TITLES[type][forms[type].elements.id.value ? 1 : 0];
  }

  function setEditing(type, editing) {
    const f = forms[type];
    $('.btn-save', f).textContent = editing ? 'Save changes' : SAVE_LABELS[type];
    $('.btn-cancel', f).classList.toggle('hidden', !editing);
    $('.btn-delete', f).classList.toggle('hidden', !editing);
    if (type === logType) $('#log-title').textContent = TITLES[type][editing ? 1 : 0];
  }

  function resetForm(type = 'bm') {
    const f = forms[type];
    f.reset();
    f.elements.id.value = '';
    setEditing(type, false);
    ({ bm: resetBm, meal: resetMeal, drink: resetDrink, day: resetDay })[type]();
  }
  const resetAllForms = () => Object.keys(forms).forEach(resetForm);

  function fillForm(entry) {
    const type = entry.type;
    if (!forms[type]) return;
    resetForm(type);
    forms[type].elements.id.value = entry.id;
    ({ bm: fillBm, meal: fillMeal, drink: fillDrink, day: fillDay })[type](entry);
    setEditing(type, true);
    setLogType(type);
  }

  function readWhen(input) {
    const when = input.value ? new Date(input.value) : new Date();
    if (isNaN(when)) { toast('That date/time doesn’t look right.'); return null; }
    return when;
  }

  function saveEntry(f, data, msg) {
    const now = new Date().toISOString();
    const id = f.elements.id.value || data.id;
    const existing = id && store.entries.findIndex(e => e.id === id);
    if (id && existing >= 0) {
      store.entries[existing] = { ...store.entries[existing], ...data, updatedAt: now };
    } else {
      store.entries.push({ id: id || uid(), createdAt: now, ...data, updatedAt: now });
    }
    if (!saveStore()) return false;
    const wasEditing = !!f.elements.id.value;
    toast(wasEditing ? 'Changes saved' : msg);
    resetForm(f.dataset.type);
    updateHeader();
    if (wasEditing && f.dataset.type !== 'day') showView('history');
    return true;
  }

  function onDelete(ev) {
    const f = ev.target.closest('form');
    const id = f.elements.id.value;
    if (!id) return;
    if (!confirm('Delete this entry? This can’t be undone.')) return;
    store.entries = store.entries.filter(e => e.id !== id);
    saveStore();
    toast('Entry deleted');
    resetForm(f.dataset.type);
    updateHeader();
    showView('history');
  }

  // Things on the log screen that depend on other entries.
  function refreshLogExtras() {
    updateBeforeFood();
    updateTodayFluids();
    refreshFoodSuggestions();
  }

  // --- Bowel movement ---

  function buildBmForm() {
    $('#bristol-grid').innerHTML = BRISTOL.map(b => `
      <label class="bristol-opt">
        <input type="radio" name="bristol" value="${b.n}" aria-label="Type ${b.n}: ${esc(b.desc)}">
        <span class="bristol-card">
          ${bristolSvg(b.n)}
          <span class="bt-num">Type ${b.n}</span>
          <span class="bt-desc">${esc(b.desc)}</span>
        </span>
      </label>`).join('');

    $('#urgency-group').innerHTML = radios('urgency', URGENCY.map((u, i) => ({ id: i, label: u })), 0);

    $('#abn-group').innerHTML = ABNORMALITIES.map(a => `
      <label class="${a.flag ? 'flag' : ''}"><input type="checkbox" name="abn" value="${a.id}"><span>${esc(a.label)}</span></label>`).join('');

    $('#color-group').innerHTML = COLORS.map(c => `
      <label><input type="radio" name="color" value="${c.id}"><span><i class="color-dot" style="background:${c.hex}"></i>${esc(c.label)}</span></label>`).join('');
    makeDeselectable($$('#color-group input'));

    $('#bristol-grid').addEventListener('change', updateBristolHint);
    $('#f-pain').addEventListener('input', updatePainOut);
    $('#f-when').addEventListener('change', updateBeforeFood);
    form.addEventListener('submit', onSubmitBm);
  }

  // Allow deselecting an optional radio by tapping it again.
  function makeDeselectable(inputs) {
    inputs.forEach(input => {
      input.addEventListener('pointerdown', () => { input.dataset.wasChecked = input.checked ? '1' : ''; });
      input.addEventListener('click', () => {
        if (input.dataset.wasChecked) { input.checked = false; input.dataset.wasChecked = ''; }
      });
    });
  }

  function updatePainOut() {
    const v = Number($('#f-pain').value);
    $('#pain-out').textContent = `${v} · ${PAIN_WORDS[v]}`;
  }

  function updateBristolHint() {
    const sel = form.querySelector('input[name="bristol"]:checked');
    const hint = $('#bristol-hint');
    if (!sel) { hint.textContent = 'Tap the type that best matches.'; return; }
    const b = BRISTOL[Number(sel.value) - 1];
    hint.textContent = `Type ${b.n} — ${b.name}. Usually considered: ${b.group.toLowerCase()}.`;
  }

  // Shows what was eaten/drunk in the reaction window before this BM.
  function updateBeforeFood() {
    const box = $('#bm-before-food');
    const when = $('#f-when').value ? new Date($('#f-when').value) : new Date();
    if (isNaN(when) || !store.entries.some(e => e.type === 'meal' || e.type === 'drink')) { box.classList.add('hidden'); return; }
    const { start, end } = getWindow();
    const intake = intakeBefore(when);
    box.classList.remove('hidden');
    box.innerHTML = `<h3>Eaten ${start}–${end} h before this</h3>` + (intake.length
      ? `<ul class="intake-list">${intake.map(e => `<li><span>${esc(fmtShortDate(new Date(e.ts)))} ${esc(fmtTime(new Date(e.ts)))}</span> ${esc(intakeNames(e).join(', '))}</li>`).join('')}</ul>`
      : '<p>Nothing logged in that window.</p>');
  }

  function resetBm() {
    $('#f-when').value = toLocalInput(new Date());
    updatePainOut();
    updateBristolHint();
    updateBeforeFood();
  }

  function fillBm(entry) {
    $('#f-when').value = toLocalInput(new Date(entry.ts));
    setRadio(form, 'bristol', entry.bristol);
    $('#f-pain').value = entry.pain ?? 0;
    setRadio(form, 'urgency', entry.urgency ?? 0);
    (entry.abnormalities || []).forEach(a => {
      const cb = form.querySelector(`input[name="abn"][value="${a}"]`);
      if (cb) cb.checked = true;
    });
    if (entry.color) setRadio(form, 'color', entry.color);
    $('#f-notes').value = entry.notes || '';
    updatePainOut();
    updateBristolHint();
    updateBeforeFood();
  }

  function onSubmitBm(ev) {
    ev.preventDefault();
    const bristol = checkedVal(form, 'bristol');
    if (!bristol) {
      toast('Pick a Bristol stool type first.');
      $('#bristol-grid').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const when = readWhen($('#f-when'));
    if (!when) return;
    saveEntry(form, {
      type: 'bm',
      ts: when.toISOString(),
      bristol: Number(bristol),
      pain: Number($('#f-pain').value),
      urgency: Number(checkedVal(form, 'urgency') || 0),
      abnormalities: $$('input[name="abn"]:checked', form).map(i => i.value),
      color: checkedVal(form, 'color') || null,
      notes: $('#f-notes').value.trim()
    }, 'Bowel movement saved');
  }

  // --- Food ---

  let mealItems = [];
  let tagOverrides = {}; // tag id -> true/false when the user taps a tag

  function autoTagsFor(item) {
    if (store.learnedTags[item]) return store.learnedTags[item];
    return TAG_MATCHERS.filter(m => m.re.test(item)).map(m => m.id);
  }
  function autoTags() {
    const set = new Set();
    mealItems.forEach(i => autoTagsFor(i).forEach(t => set.add(t)));
    return set;
  }

  function defaultMealType(d) {
    const h = d.getHours() + d.getMinutes() / 60;
    if (h >= 5 && h < 10.5) return 'breakfast';
    if (h >= 11 && h < 14.5) return 'lunch';
    if (h >= 17 && h < 21) return 'dinner';
    return 'snack';
  }

  function foodFrequency() {
    const counts = new Map();
    entriesOf('meal').forEach(m => (m.items || []).forEach(i => counts.set(i, (counts.get(i) || 0) + 1)));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }

  function buildMealForm() {
    const f = forms.meal;
    $('#mealtype-group').innerHTML = radios('mealType', MEAL_TYPES, 'snack');
    $('#portion-group').innerHTML = radios('portion', PORTIONS, 'normal');
    $('#tag-group').innerHTML = FOOD_TAGS.map(t => `
      <label><input type="checkbox" name="tag" value="${t.id}"><span>${esc(t.label)}</span></label>`).join('');

    const input = $('#f-food-input');
    const add = () => {
      input.value.split(',').map(normFood).filter(Boolean).forEach(addMealItem);
      input.value = '';
      renderMealItems();
    };
    $('#btn-add-food').addEventListener('click', () => { add(); input.focus(); });
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); add(); }
    });
    // Picking from the suggestion list adds it straight away.
    input.addEventListener('input', ev => {
      if (ev.inputType === 'insertReplacementText' || (ev.inputType == null && input.value)) {
        const v = normFood(input.value);
        if ($$('#food-suggest option').some(o => o.value === v)) add();
      }
    });

    $('#food-items').addEventListener('click', ev => {
      const b = ev.target.closest('[data-remove]');
      if (!b) return;
      mealItems = mealItems.filter(i => i !== b.dataset.remove);
      renderMealItems();
    });
    $('#food-frequent').addEventListener('click', ev => {
      const b = ev.target.closest('[data-add]');
      if (!b) return;
      addMealItem(b.dataset.add);
      renderMealItems();
    });
    $('#tag-group').addEventListener('change', ev => {
      tagOverrides[ev.target.value] = ev.target.checked;
    });
    $('#f-meal-when').addEventListener('change', () => {
      if (!f.elements.id.value) {
        const d = new Date($('#f-meal-when').value);
        if (!isNaN(d)) setRadio(f, 'mealType', defaultMealType(d));
      }
    });
    f.addEventListener('submit', onSubmitMeal);
  }

  function addMealItem(item) {
    if (item && !mealItems.includes(item)) mealItems.push(item);
  }

  function renderMealItems() {
    $('#food-items').innerHTML = mealItems.map(i => `
      <button type="button" class="item-chip selected" data-remove="${esc(i)}" aria-label="Remove ${esc(i)}">${esc(i)}<span aria-hidden="true">×</span></button>`).join('');
    const auto = autoTags();
    $$('#tag-group input').forEach(cb => {
      cb.checked = tagOverrides[cb.value] ?? auto.has(cb.value);
    });
    refreshFoodSuggestions();
  }

  function refreshFoodSuggestions() {
    const freq = foodFrequency();
    $('#food-suggest').innerHTML = freq.slice(0, 300).map(([i]) => `<option value="${esc(i)}">`).join('');
    const top = freq.filter(([i]) => !mealItems.includes(i)).slice(0, 12);
    $('#food-frequent-wrap').classList.toggle('hidden', !top.length);
    $('#food-frequent').innerHTML = top.map(([i]) => `<button type="button" class="item-chip" data-add="${esc(i)}">+ ${esc(i)}</button>`).join('');
  }

  function resetMeal() {
    const now = new Date();
    $('#f-meal-when').value = toLocalInput(now);
    setRadio(forms.meal, 'mealType', defaultMealType(now));
    setRadio(forms.meal, 'portion', 'normal');
    mealItems = [];
    tagOverrides = {};
    renderMealItems();
  }

  function fillMeal(entry) {
    $('#f-meal-when').value = toLocalInput(new Date(entry.ts));
    setRadio(forms.meal, 'mealType', entry.mealType || 'snack');
    setRadio(forms.meal, 'portion', entry.portion || 'normal');
    mealItems = (entry.items || []).slice();
    // Keep the saved tags exactly as they were.
    tagOverrides = Object.fromEntries(FOOD_TAGS.map(t => [t.id, (entry.tags || []).includes(t.id)]));
    renderMealItems();
    $('#f-meal-notes').value = entry.notes || '';
  }

  function onSubmitMeal(ev) {
    ev.preventDefault();
    const f = forms.meal;
    const pending = normFood($('#f-food-input').value);
    if (pending) { pending.split(',').map(normFood).filter(Boolean).forEach(addMealItem); $('#f-food-input').value = ''; renderMealItems(); }
    if (!mealItems.length) {
      toast('Add at least one food.');
      $('#f-food-input').focus();
      return;
    }
    const when = readWhen($('#f-meal-when'));
    if (!when) return;
    const tags = $$('#tag-group input:checked').map(i => i.value);
    // Remember the tags chosen for a single food so it's tagged the same next time.
    if (mealItems.length === 1) store.learnedTags[mealItems[0]] = tags;
    saveEntry(f, {
      type: 'meal',
      ts: when.toISOString(),
      mealType: checkedVal(f, 'mealType') || 'snack',
      items: mealItems.slice(),
      tags,
      portion: checkedVal(f, 'portion') || 'normal',
      notes: $('#f-meal-notes').value.trim()
    }, 'Food saved');
  }

  // --- Drink ---

  function lastDrink(kind) {
    return entriesOf('drink').find(d => !kind || d.drink === kind);
  }

  function buildDrinkForm() {
    const f = forms.drink;
    $('#drink-group').innerHTML = radios('drink', DRINKS, 'water');
    $('#oz-group').innerHTML = radios('ozPreset', OZ_PRESETS.map(o => ({ id: o, label: o + ' oz' })), 8);
    $('#drink-group').addEventListener('change', ev => {
      const prev = lastDrink(ev.target.value);
      if (prev && prev.oz) setOz(prev.oz);
    });
    $('#oz-group').addEventListener('change', ev => { $('#f-drink-oz').value = ev.target.value; });
    $('#f-drink-oz').addEventListener('input', () => setRadio(f, 'ozPreset', Number($('#f-drink-oz').value)));
    f.addEventListener('submit', onSubmitDrink);
  }

  function setOz(oz) {
    $('#f-drink-oz').value = oz;
    setRadio(forms.drink, 'ozPreset', oz);
  }

  function updateTodayFluids() {
    const todayKey = dayKey(new Date());
    const today = entriesOf('drink').filter(d => dayKey(new Date(d.ts)) === todayKey);
    const total = today.reduce((s, d) => s + (d.oz || 0), 0);
    const water = today.filter(d => d.drink === 'water').reduce((s, d) => s + (d.oz || 0), 0);
    $('#today-fluids').innerHTML = today.length
      ? `Today so far: <b>${round1(total)} oz</b> total · ${round1(water)} oz water`
      : 'No drinks logged today yet.';
  }

  function resetDrink() {
    $('#f-drink-when').value = toLocalInput(new Date());
    const prev = lastDrink();
    setRadio(forms.drink, 'drink', prev ? prev.drink : 'water');
    setOz(prev && prev.oz ? prev.oz : 8);
    updateTodayFluids();
  }

  function fillDrink(entry) {
    $('#f-drink-when').value = toLocalInput(new Date(entry.ts));
    setRadio(forms.drink, 'drink', entry.drink);
    setOz(entry.oz || 0);
    $('#f-drink-notes').value = entry.notes || '';
  }

  function onSubmitDrink(ev) {
    ev.preventDefault();
    const f = forms.drink;
    const drink = checkedVal(f, 'drink');
    if (!drink) { toast('Pick a drink.'); return; }
    const oz = Number($('#f-drink-oz').value);
    if (!(oz > 0)) { toast('Enter an amount in oz.'); $('#f-drink-oz').focus(); return; }
    const when = readWhen($('#f-drink-when'));
    if (!when) return;
    saveEntry(f, {
      type: 'drink',
      ts: when.toISOString(),
      drink,
      oz,
      notes: $('#f-drink-notes').value.trim()
    }, `${DRINK_BY_ID[drink].label} saved`);
  }

  // --- Daily check-in ---

  function buildDayForm() {
    const f = forms.day;
    $('#stress-group').innerHTML = radios('stress', STRESS.map((s, i) => ({ id: i + 1, label: s })), null);
    $('#sleepq-group').innerHTML = radios('sleepQ', SLEEP_Q.map((s, i) => ({ id: i + 1, label: s })), null);
    makeDeselectable($$('#stress-group input, #sleepq-group input'));
    $('#f-day-date').addEventListener('change', () => loadDay($('#f-day-date').value));
    $$('[data-step]', f).forEach(b => b.addEventListener('click', () => {
      const input = $('#f-sleep-hours');
      const v = Math.min(16, Math.max(0, (Number(input.value) || 7) + Number(b.dataset.step)));
      input.value = v;
    }));
    f.addEventListener('submit', onSubmitDay);
  }

  // Selecting a date loads that day's check-in if there is one.
  function loadDay(key) {
    const existing = key && store.entries.find(e => e.type === 'day' && e.date === key);
    if (existing) { fillForm(existing); return; }
    const f = forms.day;
    f.reset();
    f.elements.id.value = '';
    $('#f-day-date').value = key || dayKey(new Date());
    setEditing('day', false);
  }

  function resetDay() {
    $('#f-day-date').value = dayKey(new Date());
    const existing = store.entries.find(e => e.type === 'day' && e.date === dayKey(new Date()));
    if (existing) {
      // Today's check-in already exists: show it so it can be updated.
      forms.day.elements.id.value = existing.id;
      fillDay(existing);
      setEditing('day', true);
    }
  }

  function fillDay(entry) {
    $('#f-day-date').value = entry.date;
    setRadio(forms.day, 'stress', entry.stress);
    $('#f-sleep-hours').value = entry.sleepHours ?? '';
    setRadio(forms.day, 'sleepQ', entry.sleepQuality);
    $('#f-day-notes').value = entry.notes || '';
  }

  function onSubmitDay(ev) {
    ev.preventDefault();
    const f = forms.day;
    const date = $('#f-day-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a day.'); return; }
    const stress = checkedVal(f, 'stress');
    const sleepQ = checkedVal(f, 'sleepQ');
    const hoursRaw = $('#f-sleep-hours').value;
    const sleepHours = hoursRaw === '' ? null : Number(hoursRaw);
    if (!stress && !sleepQ && sleepHours == null && !$('#f-day-notes').value.trim()) {
      toast('Fill in at least one thing.');
      return;
    }
    if (sleepHours != null && (isNaN(sleepHours) || sleepHours < 0 || sleepHours > 24)) { toast('Sleep hours should be 0–24.'); return; }
    // One check-in per day: the id is derived from the date.
    const id = 'day-' + date;
    const oldId = f.elements.id.value;
    if (oldId && oldId !== id) store.entries = store.entries.filter(e => e.id !== oldId);
    f.elements.id.value = store.entries.some(e => e.id === id) ? id : '';
    saveEntry(f, {
      id,
      type: 'day',
      date,
      ts: dateFromKey(date).toISOString(),
      stress: stress ? Number(stress) : null,
      sleepHours,
      sleepQuality: sleepQ ? Number(sleepQ) : null,
      notes: $('#f-day-notes').value.trim()
    }, 'Check-in saved');
  }

  // ---------- History ----------

  let historyFilter = 'all';

  function renderHistory() {
    const list = $('#history-list');
    const entries = store.entries
      .filter(e => historyFilter === 'all' || e.type === historyFilter)
      .filter(e => ['bm', 'meal', 'drink', 'day'].includes(e.type))
      .sort(byNewest);
    if (!entries.length) {
      list.innerHTML = `<div class="empty"><p>${historyFilter === 'all' ? 'No entries yet.' : 'Nothing of this kind logged yet.'}</p><button class="btn btn-primary" data-goto="log">Log something</button></div>`;
      return;
    }
    const groups = new Map();
    entries.forEach(e => {
      const k = e.type === 'day' ? e.date : dayKey(new Date(e.ts));
      if (!groups.has(k)) groups.set(k, { date: dateFromKey(k), items: [] });
      groups.get(k).items.push(e);
    });

    const hasFood = store.entries.some(e => e.type === 'meal' || e.type === 'drink');
    list.innerHTML = Array.from(groups.values()).map(g => {
      // Check-ins sit at the top of their day.
      g.items.sort((a, b) => ((b.type === 'day') - (a.type === 'day')) || byNewest(a, b));
      const bms = g.items.filter(e => e.type === 'bm');
      const meals = g.items.filter(e => e.type === 'meal').length;
      const oz = g.items.filter(e => e.type === 'drink').reduce((s, d) => s + (d.oz || 0), 0);
      const summary = [];
      if (bms.length) summary.push(`${plural(bms.length, 'BM')} · avg pain ${round1(bms.reduce((s, e) => s + (e.pain || 0), 0) / bms.length)}`);
      if (meals) summary.push(plural(meals, 'meal'));
      if (oz) summary.push(`${round1(oz)} oz`);
      return `
      <div class="day-group">
        <div class="day-head"><h3>${esc(fmtDayHeading(g.date))}</h3><span>${summary.join(' · ')}</span></div>
        ${g.items.map(e => entryHtml(e, hasFood)).join('')}
      </div>`;
    }).join('');
  }

  function entryHtml(e, hasFood) {
    if (e.type === 'meal') return mealHtml(e);
    if (e.type === 'drink') return drinkHtml(e);
    if (e.type === 'day') return dayHtml(e);
    return bmHtml(e, hasFood);
  }

  function entryShell(e, icon, title, body, time) {
    return `
      <button class="entry entry-${e.type}" data-edit="${esc(e.id)}" aria-label="Edit ${esc(title)}">
        ${icon}
        <span class="entry-main">
          <span class="entry-title">${esc(title)}</span>
          ${body}
          ${e.notes ? `<span class="entry-notes">${esc(e.notes)}</span>` : ''}
        </span>
        <span class="entry-time">${time ? esc(time) : ''}</span>
      </button>`;
  }

  function bmHtml(e, hasFood) {
    const b = BRISTOL[e.bristol - 1];
    const tags = [];
    (e.abnormalities || []).forEach(a => {
      const def = ABN_BY_ID[a];
      if (def) tags.push(`<span class="tag ${def.flag ? 'flag' : ''}">${esc(def.label)}</span>`);
    });
    if (e.color && COLOR_BY_ID[e.color]) {
      const c = COLOR_BY_ID[e.color];
      tags.push(`<span class="tag"><i class="color-dot" style="background:${c.hex}"></i>${esc(c.label)}</span>`);
    }
    const meta = [`Pain ${e.pain}/10`];
    if (e.urgency) meta.push(URGENCY[e.urgency]);
    let before = '';
    if (hasFood) {
      const names = [...new Set(intakeBefore(e.ts).flatMap(intakeNames))];
      const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
      before = `<span class="entry-food">${names.length ? `Ate before: ${esc(shown)}` : 'Nothing logged in the hours before'}</span>`;
    }
    return entryShell(e, bristolSvg(e.bristol), `Type ${e.bristol} · ${b.name}`,
      `<span class="entry-meta">${meta.join(' · ')}</span>
       ${tags.length ? `<span class="tags">${tags.join('')}</span>` : ''}${before}`,
      fmtTime(new Date(e.ts)));
  }

  function mealHtml(e) {
    const tags = (e.tags || []).map(t => TAG_BY_ID[t] ? `<span class="tag">${esc(TAG_BY_ID[t].label)}</span>` : '').join('');
    const title = (MEAL_BY_ID[e.mealType] || MEAL_BY_ID.snack).label + (e.portion && e.portion !== 'normal' ? ` · ${e.portion} portion` : '');
    return entryShell(e, ICONS.meal, title,
      `<span class="entry-meta">${esc((e.items || []).join(', '))}</span>${tags ? `<span class="tags">${tags}</span>` : ''}`,
      fmtTime(new Date(e.ts)));
  }

  function drinkHtml(e) {
    const d = DRINK_BY_ID[e.drink] || DRINK_BY_ID.other;
    return entryShell(e, ICONS.drink, `${d.label} · ${round1(e.oz || 0)} oz`, '', fmtTime(new Date(e.ts)));
  }

  function dayHtml(e) {
    const bits = [];
    if (e.stress) bits.push(`Stress: ${STRESS[e.stress - 1]}`);
    if (e.sleepHours != null) bits.push(`Slept ${e.sleepHours} h`);
    if (e.sleepQuality) bits.push(`Sleep: ${SLEEP_Q[e.sleepQuality - 1]}`);
    return entryShell(e, ICONS.day, 'Daily check-in', `<span class="entry-meta">${esc(bits.join(' · '))}</span>`, '');
  }

  // ---------- Insights ----------

  const RANGES = [
    { id: '1', label: 'Today', days: 1 },
    { id: '7', label: '7 days', days: 7 },
    { id: '30', label: '30 days', days: 30 },
    { id: '90', label: '90 days', days: 90 },
    { id: 'all', label: 'All time', days: Infinity }
  ];
  let rangeId = prefGet(RANGE_KEY, '7');
  if (!RANGES.some(r => r.id === rangeId)) rangeId = '7';

  const TIME_OF_DAY = [
    { label: 'Night (12–6am)', from: 0 },
    { label: 'Morning (6am–12)', from: 6 },
    { label: 'Afternoon (12–6pm)', from: 12 },
    { label: 'Evening (6pm–12)', from: 18 }
  ];

  function buildRangeGroup() {
    $('#range-group').innerHTML = RANGES.map(r => `
      <label><input type="radio" name="range" value="${r.id}" ${r.id === rangeId ? 'checked' : ''}><span>${r.label}</span></label>`).join('');
    $('#range-group').addEventListener('change', ev => {
      rangeId = ev.target.value;
      prefSet(RANGE_KEY, rangeId);
      renderInsights();
    });
  }

  // Number of days in the range that you've actually been logging, so days
  // before your first entry don't drag averages down.
  function trackedSpan(rangeDays) {
    const all = bmEntries();
    if (!all.length) return { days: Math.min(rangeDays, 1), clipped: false };
    const first = startOfDay(new Date(all[all.length - 1].ts));
    const sinceFirst = Math.round((startOfDay(new Date()) - first) / 86400000) + 1;
    return { days: Math.max(1, Math.min(rangeDays, sinceFirst)), clipped: sinceFirst < rangeDays && rangeDays !== Infinity, first };
  }

  function computeDays(days) {
    const today = startOfDay(new Date());
    const start = new Date(today); start.setDate(start.getDate() - (days - 1));
    const buckets = [];
    const byKey = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const b = { date: d, key: dayKey(d), items: [] };
      buckets.push(b); byKey[b.key] = b;
    }
    const inRange = bmEntries().filter(e => new Date(e.ts) >= start);
    inRange.forEach(e => {
      const b = byKey[dayKey(new Date(e.ts))];
      if (b) b.items.push(e);
    });
    buckets.forEach(b => {
      b.count = b.items.length;
      b.avgPain = b.count ? round1(b.items.reduce((s, e) => s + (e.pain || 0), 0) / b.count) : null;
      b.maxPain = b.count ? Math.max(...b.items.map(e => e.pain || 0)) : null;
      b.avgBristol = b.count ? round1(b.items.reduce((s, e) => s + e.bristol, 0) / b.count) : null;
      b.blood = b.items.some(hasBlood);
    });
    return { buckets, entries: inRange };
  }

  function renderInsights() {
    const range = RANGES.find(r => r.id === rangeId);
    const span = trackedSpan(range.days);
    const D = span.days;
    const { buckets, entries } = computeDays(D);
    const root = $('#insights');
    const periodText = range.days === 1 ? 'today' : range.days === Infinity ? 'yet' : `in the last ${range.days} days`;

    if (!entries.length) {
      root.innerHTML = `<div class="empty"><p>No entries ${periodText}.</p><button class="btn btn-primary" data-goto="log">Log an entry</button></div>`;
      lastBuckets = null;
      return;
    }

    const n = entries.length;
    const multiDay = D > 1;
    const avgPerDay = round1(n / D);
    const maxInDay = Math.max(...buckets.map(b => b.count));
    const avgBristol = round1(entries.reduce((s, e) => s + e.bristol, 0) / n);
    const avgPain = round1(entries.reduce((s, e) => s + (e.pain || 0), 0) / n);
    const maxPain = Math.max(...entries.map(e => e.pain || 0));
    const typeCounts = [0, 0, 0, 0, 0, 0, 0];
    entries.forEach(e => typeCounts[e.bristol - 1]++);
    const mode = typeCounts.indexOf(Math.max(...typeCounts)) + 1;
    const looseShare = Math.round(100 * entries.filter(e => e.bristol >= 6).length / n);

    // Count of days on which at least one entry matches.
    const daysWith = pred => buckets.filter(b => b.items.some(pred)).length;
    const bloodDays = daysWith(hasBlood);
    const painDays = daysWith(e => e.pain >= 1);
    const has = id => e => (e.abnormalities || []).includes(id);

    const dayRows = [
      { label: 'Any pain (1+)', count: painDays },
      { label: 'Moderate pain (4+)', count: daysWith(e => e.pain >= 4) },
      { label: 'Severe pain (7+)', count: daysWith(e => e.pain >= 7) },
      { label: 'Blood', count: bloodDays, flag: true },
      { label: 'Mucus', count: daysWith(has('mucus')) },
      { label: 'Urgent / accident', count: daysWith(e => e.urgency >= 2) },
      { label: 'Accident', count: daysWith(e => e.urgency === 3) },
      { label: 'Loose (type 6–7)', count: daysWith(e => e.bristol >= 6) },
      { label: 'Hard (type 1–2)', count: daysWith(e => e.bristol <= 2) },
      { label: 'No BM that day', count: buckets.filter(b => !b.count).length }
    ];
    const typeDayRows = BRISTOL.map(b => ({ label: `${b.n} · ${b.short || b.name}`, count: daysWith(e => e.bristol === b.n) }));

    const todCounts = TIME_OF_DAY.map((t, i) => ({
      label: t.label,
      count: entries.filter(e => {
        const h = new Date(e.ts).getHours();
        return h >= t.from && h < (TIME_OF_DAY[i + 1] ? TIME_OF_DAY[i + 1].from : 24);
      }).length
    }));

    const abnCounts = ABNORMALITIES.map(a => ({ label: a.label, count: entries.filter(has(a.id)).length }))
      .filter(a => a.count > 0)
      .sort((a, b) => b.count - a.count);

    const lastTs = new Date(entries[0].ts);
    const ofDays = `of ${D} day${D === 1 ? '' : 's'}`;

    root.innerHTML = `
      ${span.clipped || range.days === Infinity ? `<p class="hint range-note">Covering ${D} day${D === 1 ? '' : 's'} since your first entry on ${esc(span.first.toLocaleDateString())}.</p>` : ''}
      <div class="tiles">
        <div class="tile"><div class="tile-label">Bowel movements</div><div class="tile-value">${n}</div><div class="tile-sub">${multiDay ? `over ${D} days` : `last at ${esc(fmtTime(lastTs))}`}</div></div>
        ${multiDay ? `<div class="tile"><div class="tile-label">Per day</div><div class="tile-value">${avgPerDay}</div><div class="tile-sub">most in one day: ${maxInDay}</div></div>` : ''}
        <div class="tile"><div class="tile-label">Avg Bristol type</div><div class="tile-value">${avgBristol}</div><div class="tile-sub">most often type ${mode} · ${looseShare}% type 6–7</div></div>
        <div class="tile"><div class="tile-label">Avg pain</div><div class="tile-value">${avgPain}</div><div class="tile-sub">peak ${maxPain}/10</div></div>
        ${multiDay ? `<div class="tile"><div class="tile-label">Days with pain</div><div class="tile-value">${painDays}</div><div class="tile-sub">${ofDays}</div></div>` : ''}
        <div class="tile ${bloodDays ? 'alert' : ''}"><div class="tile-label">${multiDay ? 'Days with blood' : 'Blood'}</div><div class="tile-value">${multiDay ? bloodDays : (bloodDays ? 'Yes' : 'No')}</div><div class="tile-sub">${multiDay ? ofDays : 'today'}</div></div>
      </div>

      ${foodDrinkCard(buckets)}

      ${multiDay ? `
      <div class="card">
        <h3>Days with…</h3>
        <p class="hint card-hint">How many of the ${D} days had at least one bowel movement with each.</p>
        ${hbars(dayRows, { max: D, outOf: D })}
        <h4 class="subhead">Days with each Bristol type</h4>
        ${hbars(typeDayRows, { max: D, outOf: D })}
      </div>

      <div class="card">
        <h3>Bowel movements per day</h3>
        <div class="chart-wrap" data-chart="count"></div>
        ${bloodDays ? '<p class="chart-note"><i></i>Day with blood noted</p>' : ''}
      </div>

      <div class="card">
        <h3>Average pain per day</h3>
        <div class="chart-wrap" data-chart="pain"></div>
      </div>` : ''}

      <div class="card">
        <h3>Bristol type mix</h3>
        <p class="hint card-hint">Number of bowel movements of each type.</p>
        ${hbars(BRISTOL.map((b, i) => ({ label: `${b.n} · ${b.short || b.name}`, count: typeCounts[i] })))}
      </div>

      <div class="card">
        <h3>Time of day</h3>
        ${hbars(todCounts)}
      </div>

      <div class="card">
        <h3>Abnormalities</h3>
        ${abnCounts.length ? hbars(abnCounts) : '<p>None recorded in this period.</p>'}
      </div>

      ${multiDay ? `
      <div class="card">
        <details class="table-view">
          <summary>Daily table</summary>
          <table>
            <thead><tr><th>Date</th><th>BMs</th><th>Avg type</th><th>Avg pain</th><th>Max pain</th><th>Blood</th></tr></thead>
            <tbody>
              ${buckets.slice().reverse().map(b => `<tr><td>${esc(fmtShortDate(b.date))}</td><td>${b.count}</td><td>${b.avgBristol ?? '–'}</td><td>${b.avgPain ?? '–'}</td><td>${b.maxPain ?? '–'}</td><td>${b.blood ? 'Yes' : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </details>
      </div>` : ''}`;

    lastBuckets = multiDay ? buckets : null;
    drawCharts();
  }

  // Meals and fluids over the same days as the rest of Insights.
  function foodDrinkCard(buckets) {
    const from = buckets[0].date.getTime();
    const inRange = e => new Date(e.ts).getTime() >= from;
    const meals = entriesOf('meal').filter(inRange);
    const drinks = entriesOf('drink').filter(inRange);
    if (!meals.length && !drinks.length) return '';
    const drinkDays = new Set(drinks.map(d => dayKey(new Date(d.ts)))).size;
    const total = drinks.reduce((s, d) => s + (d.oz || 0), 0);
    const water = drinks.filter(d => d.drink === 'water').reduce((s, d) => s + (d.oz || 0), 0);
    const mealDays = new Set(meals.map(m => dayKey(new Date(m.ts)))).size;
    return `
      <div class="card">
        <h3>Food &amp; drink</h3>
        <div class="mini-stats">
          <div><b>${meals.length}</b><span>meals logged${mealDays ? ` · ${round1(meals.length / mealDays)}/day` : ''}</span></div>
          <div><b>${drinkDays ? round1(total / drinkDays) : 0} oz</b><span>fluids per day${drinkDays ? ` (${plural(drinkDays, 'day')} logged)` : ''}</span></div>
          <div><b>${drinkDays ? round1(water / drinkDays) : 0} oz</b><span>water per day</span></div>
        </div>
        <button class="btn btn-ghost link-btn" data-goto="triggers">See possible food triggers →</button>
      </div>`;
  }

  // Horizontal bars. With `outOf`, values read "3/7" and bars scale to that total.
  function hbars(rows, opts = {}) {
    const max = Math.max(1, opts.max ?? Math.max(...rows.map(r => r.count)));
    return rows.map(r => {
      const val = opts.outOf ? `${r.count}/${opts.outOf}` : r.count;
      const pct = opts.outOf ? ` (${Math.round(100 * r.count / opts.outOf)}%)` : '';
      return `
      <div class="hbar-row${opts.outOf ? ' wide-val' : ''}" title="${esc(r.label)}: ${val}${pct}">
        <span class="hbar-label">${esc(r.label)}</span>
        <span class="hbar-track"><span class="hbar-fill${r.flag ? ' flag' : ''}" style="display:block;width:${r.count ? (100 * r.count / max) : 0}%"></span></span>
        <span class="hbar-val">${val}</span>
      </div>`;
    }).join('');
  }

  let lastBuckets = null;
  function drawCharts() {
    if (!lastBuckets || currentView !== 'insights') return;
    $$('#insights .chart-wrap').forEach(wrap => {
      const kind = wrap.dataset.chart;
      if (kind === 'count') {
        wrap.innerHTML = barChart(wrap.clientWidth, lastBuckets, b => b.count, { integer: true, flags: true });
      } else {
        wrap.innerHTML = barChart(wrap.clientWidth, lastBuckets, b => b.avgPain, { max: 10 });
      }
      bindChartHover(wrap, kind);
    });
  }

  // Single-series daily bar chart with 4px rounded tops anchored to the baseline.
  function barChart(width, buckets, valueOf, opts) {
    const W = Math.max(260, width);
    const H = 150;
    const m = { top: opts.flags ? 14 : 8, right: 4, bottom: 22, left: 26 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;
    const vals = buckets.map(valueOf);
    let max = opts.max ?? Math.max(1, ...vals.map(v => v || 0));
    if (opts.integer) max = Math.max(2, Math.ceil(max));
    const ticks = niceTicks(max, opts.integer);
    max = ticks[ticks.length - 1];

    const step = iw / buckets.length;
    const gap = Math.min(2, step * 0.25);
    const bw = Math.max(1, step - gap);
    const y = v => m.top + ih - (v / max) * ih;

    let s = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily bar chart">`;
    ticks.forEach(t => {
      const ty = y(t);
      s += `<line class="${t === 0 ? 'baseline' : 'gridline'}" x1="${m.left}" x2="${W - m.right}" y1="${ty}" y2="${ty}"/>`;
      s += `<text x="${m.left - 6}" y="${ty + 4}" text-anchor="end">${t}</text>`;
    });

    // x labels: pick ~5 evenly spaced dates
    const labelEvery = Math.ceil(buckets.length / 5);
    buckets.forEach((b, i) => {
      const x = m.left + i * step;
      const v = vals[i];
      if (i % labelEvery === 0 || i === buckets.length - 1) {
        if (i === buckets.length - 1 || buckets.length - 1 - i >= labelEvery * 0.6) {
          s += `<text x="${x + step / 2}" y="${H - 6}" text-anchor="middle">${esc(fmtShortDate(b.date))}</text>`;
        }
      }
      // invisible full-column hit target (bigger than the mark)
      s += `<rect class="hit" data-i="${i}" x="${x}" y="${m.top}" width="${step}" height="${ih}"/>`;
      if (v) {
        const top = y(v);
        const h = m.top + ih - top;
        const r = Math.min(4, bw / 2, h);
        const x0 = x + gap / 2, x1 = x0 + bw, yb = m.top + ih;
        s += `<path class="bar" data-i="${i}" d="M${x0},${yb}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${yb}Z"/>`;
      }
      if (opts.flags && b.blood) {
        const cy = v ? y(v) - 7 : m.top + ih - 7;
        s += `<circle class="flag-dot" cx="${x + step / 2}" cy="${Math.max(5, cy)}" r="4.5"/>`;
      }
    });
    s += '</svg>';
    return s;
  }

  function niceTicks(max, integer) {
    if (integer) {
      const stepT = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
      const top = Math.ceil(max / stepT) * stepT;
      const out = [];
      for (let t = 0; t <= top; t += stepT) out.push(t);
      return out;
    }
    if (max === 10) return [0, 5, 10];
    return [0, max / 2, max].map(round1);
  }

  function bindChartHover(wrap, kind) {
    const tip = $('#tooltip');
    const svg = wrap.querySelector('svg');
    if (!svg) return;
    const show = ev => {
      const t = ev.target.closest('[data-i]');
      if (!t) return hide();
      const b = lastBuckets[Number(t.dataset.i)];
      $$('.bar.hover', svg).forEach(x => x.classList.remove('hover'));
      const bar = svg.querySelector(`.bar[data-i="${t.dataset.i}"]`);
      if (bar) bar.classList.add('hover');
      const lines = [`<b>${esc(fmtShortDate(b.date))}</b>`];
      if (kind === 'count') {
        lines.push(`${b.count} BM${b.count === 1 ? '' : 's'}${b.count ? ` · avg type ${b.avgBristol}` : ''}`);
        if (b.blood) lines.push('Blood noted');
      } else {
        lines.push(b.count ? `Avg pain <b>${b.avgPain}</b>/10` : 'No entries');
      }
      tip.innerHTML = lines.join('<br>');
      tip.classList.add('show');
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = ev.clientX + 12, yPos = ev.clientY - th - 12;
      if (x + tw > window.innerWidth - 8) x = ev.clientX - tw - 12;
      if (yPos < 8) yPos = ev.clientY + 16;
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = yPos + 'px';
    };
    const hide = () => {
      tip.classList.remove('show');
      $$('.bar.hover', svg).forEach(x => x.classList.remove('hover'));
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }

  // ---------- Triggers ----------
  //
  // For each food, tag and drink, compare bowel movements that happened within
  // the reaction window after eating it ("after") with all other bowel
  // movements in the same period ("other times"). A BM counts as a problem if
  // it was loose, painful (4+), had blood/mucus, or was urgent.

  const MIN_TIMES = 3;      // eaten at least this often to judge
  const MIN_BMS = 3;        // and at least this many BMs on each side
  const TRIGGER_DIFF = 0.15; // problem rate at least 15 points higher
  const FINE_DIFF = 0.05;
  const GOAL_FOOD_DAYS = 14;

  function rates(bms) {
    const n = bms.length;
    const r = { n, any: n ? bms.filter(isProblem).length / n : 0 };
    PROBLEMS.forEach(p => { r[p.id] = n ? bms.filter(p.test).length / n : 0; });
    return r;
  }

  function analyzeTriggers() {
    const { start, end } = getWindow();
    const intake = store.entries.filter(e => e.type === 'meal' || (e.type === 'drink' && e.drink !== 'water'));
    if (!intake.length) return null;

    // Exposure keys -> list of times eaten.
    const exposures = new Map();
    const expose = (key, label, kind, t) => {
      if (!exposures.has(key)) exposures.set(key, { key, label, kind, times: [] });
      exposures.get(key).times.push(t);
    };
    intake.forEach(e => {
      const t = new Date(e.ts).getTime();
      const keys = new Map();
      if (e.type === 'meal') {
        (e.items || []).forEach(i => keys.set('f:' + i, [cap(i), 'food']));
        (e.tags || []).forEach(tag => TAG_BY_ID[tag] && keys.set('t:' + tag, [TAG_BY_ID[tag].label, 'tag']));
      } else {
        const d = DRINK_BY_ID[e.drink] || DRINK_BY_ID.other;
        if (d.id !== 'other') keys.set('f:' + d.label.toLowerCase(), [d.label, 'food']);
        d.tags.forEach(tag => keys.set('t:' + tag, [TAG_BY_ID[tag].label, 'tag']));
      }
      keys.forEach(([label, kind], key) => expose(key, label, kind, t));
    });

    // Only judge BMs from the period when food was being logged.
    const times = intake.map(e => new Date(e.ts).getTime());
    const from = Math.min(...times) + start * HOUR;
    const to = Math.min(Date.now(), Math.max(...times) + end * HOUR);
    const bms = bmEntries().map(e => ({ ...e, t: new Date(e.ts).getTime() })).filter(e => e.t >= from && e.t <= to);
    const foodDays = new Set(intake.map(e => dayKey(new Date(e.ts)))).size;

    const results = [];
    exposures.forEach(x => {
      const after = [], other = [];
      bms.forEach(bm => {
        const hit = x.times.some(t => { const dt = bm.t - t; return dt >= start * HOUR && dt <= end * HOUR; });
        (hit ? after : other).push(bm);
      });
      const ra = rates(after), ro = rates(other);
      const diff = ra.any - ro.any;
      const timesEaten = x.times.length;
      let status = 'unclear';
      if (timesEaten < MIN_TIMES || ra.n < MIN_BMS || ro.n < MIN_BMS) status = 'early';
      else if (diff >= TRIGGER_DIFF) status = 'trigger';
      else if (diff <= FINE_DIFF && timesEaten >= 5) status = 'fine';
      results.push({ ...x, timesEaten, after: ra, other: ro, diff, status });
    });
    results.sort((a, b) => b.diff - a.diff || b.timesEaten - a.timesEaten);

    return { start, end, bms, baseline: rates(bms), foodDays, intakeCount: intake.length, results };
  }

  function confidence(r) {
    if (r.timesEaten >= 10 && r.after.n >= 8) return ['Stronger pattern', 'conf-high'];
    if (r.timesEaten >= 5) return ['Some evidence', 'conf-mid'];
    return ['Early signal', 'conf-low'];
  }

  function compareBars(aLabel, a, bLabel, b) {
    return `
      <div class="cmp">
        <div class="cmp-row"><span class="cmp-label">${esc(aLabel)}</span><span class="cmp-track"><span class="cmp-fill" style="width:${100 * a}%"></span></span><span class="cmp-val">${pct(a)}</span></div>
        <div class="cmp-row"><span class="cmp-label">${esc(bLabel)}</span><span class="cmp-track"><span class="cmp-fill base" style="width:${100 * b}%"></span></span><span class="cmp-val">${pct(b)}</span></div>
      </div>`;
  }

  function triggerCard(r, win) {
    const [confLabel, confCls] = confidence(r);
    const worse = PROBLEMS.filter(p => r.after[p.id] > r.other[p.id] + 0.001)
      .map(p => `${p.label}: ${pct(r.after[p.id])} vs ${pct(r.other[p.id])}`);
    return `
      <div class="trigger-card">
        <div class="trigger-head">
          <h4>${esc(r.label)}${r.kind === 'tag' ? ' <span class="kind">tag</span>' : ''}</h4>
          <span class="conf ${confCls}">${confLabel}</span>
        </div>
        <p class="trigger-meta">Had ${plural(r.timesEaten, 'time')} · ${plural(r.after.n, 'BM')} within ${win}</p>
        ${compareBars('After', r.after.any, 'Other times', r.other.any)}
        ${worse.length ? `<p class="trigger-why">${esc(worse.join(' · '))}</p>` : ''}
      </div>`;
  }

  function stressSleepCard(bms) {
    const checkins = new Map(entriesOf('day').map(d => [d.date, d]));
    if (!checkins.size) {
      return `<div class="card"><h3>Stress &amp; sleep</h3><p>Use the <b>Check-in</b> option on the Log tab to rate stress and sleep. Once you have a few days, this compares how your bowel movements look on high-stress and poor-sleep days.</p></div>`;
    }
    const withDay = bmEntries().map(bm => ({ bm, day: checkins.get(dayKey(new Date(bm.ts))) })).filter(x => x.day);
    const compare = (label, isBad, badLabel, okLabel) => {
      const rel = withDay.filter(x => isBad(x.day) != null);
      const bad = rel.filter(x => isBad(x.day)).map(x => x.bm);
      const ok = rel.filter(x => isBad(x.day) === false).map(x => x.bm);
      if (bad.length < MIN_BMS || ok.length < MIN_BMS) {
        return `<div class="ss-block"><h4>${label}</h4><p class="hint">Not enough yet — ${plural(bad.length, 'BM')} on ${badLabel.toLowerCase()} days and ${ok.length} on other days (need ${MIN_BMS}+ each).</p></div>`;
      }
      const rb = rates(bad), ro = rates(ok);
      return `<div class="ss-block"><h4>${label}</h4>${compareBars(badLabel, rb.any, okLabel, ro.any)}
        <p class="hint">${plural(rb.n, 'BM')} vs ${plural(ro.n, 'BM')}. Avg pain ${round1(bad.reduce((s, e) => s + (e.pain || 0), 0) / rb.n)} vs ${round1(ok.reduce((s, e) => s + (e.pain || 0), 0) / ro.n)}.</p></div>`;
    };
    return `
      <div class="card">
        <h3>Stress &amp; sleep</h3>
        <p class="hint card-hint">Share of bowel movements with a problem, on days you checked in.</p>
        ${compare('Stress', d => (d.stress ? d.stress >= 4 : null), 'High stress', 'Lower stress')}
        ${compare('Sleep', d => {
          if (d.sleepHours == null && !d.sleepQuality) return null;
          return (d.sleepHours != null && d.sleepHours < 6) || (d.sleepQuality != null && d.sleepQuality <= 2);
        }, 'Poor sleep', 'OK sleep')}
        <p class="hint">High stress = High/Very high. Poor sleep = under 6 hours or rated Poor/Terrible.</p>
      </div>`;
  }

  function renderTriggers() {
    const root = $('#triggers');
    const a = analyzeTriggers();
    const win = (() => { const w = getWindow(); return `${w.start}–${w.end} h`; })();

    if (!a) {
      root.innerHTML = `
        <div class="empty">
          <p>Log what you eat and drink, and this tab will show which foods tend to come before bad bowel movements.</p>
          <button class="btn btn-primary" data-goto-log="meal">Log food</button>
        </div>
        ${stressSleepCard([])}`;
      return;
    }

    const triggers = a.results.filter(r => r.status === 'trigger');
    const fine = a.results.filter(r => r.status === 'fine');
    const early = a.results.filter(r => r.status === 'early');
    const judged = a.results.filter(r => r.status !== 'early');
    const progress = Math.min(1, a.foodDays / GOAL_FOOD_DAYS);

    root.innerHTML = `
      <div class="card">
        <h3>How this works</h3>
        <p>Each food is compared by looking at bowel movements <b>${win} after</b> you had it versus all your other bowel movements. A bowel movement counts as a <b>problem</b> if it was loose (type 6–7), pain 4+, had blood or mucus, or was urgent.</p>
        <p class="baseline">Overall: <b>${pct(a.baseline.any)}</b> of ${plural(a.baseline.n, 'bowel movement')} while logging food had a problem.</p>
        ${progress < 1 ? `
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${GOAL_FOOD_DAYS}" aria-valuenow="${a.foodDays}"><span style="width:${100 * progress}%"></span></div>
          <p class="hint">${plural(a.foodDays, 'day')} of food logged. Results get more trustworthy after about ${GOAL_FOOD_DAYS} days — keep going.</p>` : ''}
      </div>

      <div class="card">
        <h3>Possible triggers</h3>
        ${triggers.length
          ? `<p class="hint card-hint">Problems were noticeably more common after these. Try cutting one out for a couple of weeks and see if things change — and talk to your care team before big diet changes.</p>${triggers.map(r => triggerCard(r, win)).join('')}`
          : `<p>${judged.length ? 'Nothing stands out yet — no food is clearly followed by more problems than usual.' : `Nothing to judge yet. A food needs to be had ${MIN_TIMES}+ times with bowel movements both after it and at other times.`}</p>`}
      </div>

      ${fine.length ? `
      <div class="card">
        <h3>Probably fine</h3>
        <p class="hint card-hint">Had 5+ times with no more problems than usual.</p>
        <div class="item-chips static">${fine.map(r => `<span class="item-chip">${esc(r.label)} <small>${r.timesEaten}×</small></span>`).join('')}</div>
      </div>` : ''}

      ${early.length ? `
      <div class="card">
        <h3>Not enough data yet</h3>
        <p class="hint card-hint">Had fewer than ${MIN_TIMES} times, or not enough bowel movements to compare.</p>
        <div class="item-chips static">${early.slice().sort((x, y) => y.timesEaten - x.timesEaten).slice(0, 40).map(r => `<span class="item-chip">${esc(r.label)} <small>${r.timesEaten}×</small></span>`).join('')}</div>
      </div>` : ''}

      ${judged.length ? `
      <div class="card">
        <details class="table-view">
          <summary>All foods &amp; tags compared</summary>
          <table>
            <thead><tr><th>Food / tag</th><th>Had</th><th>BMs after</th><th>Problem after</th><th>Other times</th></tr></thead>
            <tbody>${judged.map(r => `<tr><td>${esc(r.label)}${r.kind === 'tag' ? ' (tag)' : ''}</td><td>${r.timesEaten}</td><td>${r.after.n}</td><td>${pct(r.after.any)}</td><td>${pct(r.other.any)}</td></tr>`).join('')}</tbody>
          </table>
        </details>
      </div>` : ''}

      ${stressSleepCard(a.bms)}

      <div class="card subtle">
        <h3>Keep in mind</h3>
        <p class="hint">These are patterns, not proof. During a flare almost everything can look like a trigger, and foods you often eat together (like pizza and soda) get linked together. Change the ${win} window on the Data tab if your reactions are usually faster or slower.</p>
      </div>`;
  }

  // ---------- Settings / data ----------

  function buildThemeGroup() {
    const cur = prefGet(THEME_KEY, 'system');
    $('#theme-group').innerHTML = radios('theme', [{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], cur);
    $('#theme-group').addEventListener('change', ev => {
      prefSet(THEME_KEY, ev.target.value);
      applyTheme();
    });
  }

  function applyTheme() {
    const t = prefGet(THEME_KEY, 'system');
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function buildWindowSettings() {
    const onChange = () => {
      const s = Number($('#f-win-start').value), e = Number($('#f-win-end').value);
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e > 72 || s >= e) {
        toast('Use a start of 0+ hours, an end up to 72, and start before end.');
        renderSettings();
        return;
      }
      store.settings.windowStart = s;
      store.settings.windowEnd = e;
      if (saveStore()) toast(`Window set to ${s}–${e} hours after eating`);
    };
    $('#f-win-start').addEventListener('change', onChange);
    $('#f-win-end').addEventListener('change', onChange);
    $('#btn-win-reset').addEventListener('click', () => {
      Object.assign(store.settings, DEFAULT_WINDOW);
      saveStore();
      renderSettings();
      toast('Window reset to 2–24 hours');
    });
  }

  function renderSettings() {
    const counts = ['bm', 'meal', 'drink', 'day'].map(t => entriesOf(t).length);
    const all = store.entries.slice().sort(byNewest);
    $('#data-summary').textContent = all.length
      ? `${counts[0]} bowel movements, ${counts[1]} meals, ${counts[2]} drinks, ${counts[3]} check-ins — from ${new Date(all[all.length - 1].ts).toLocaleDateString()} to ${new Date(all[0].ts).toLocaleDateString()}.`
      : 'No entries yet.';
    const w = getWindow();
    $('#f-win-start').value = w.start;
    $('#f-win-end').value = w.end;
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    download(`gut-log-backup-${dayKey(new Date())}.json`, JSON.stringify(store, null, 2), 'application/json');
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    const header = ['type', 'date', 'time', 'bristol_type', 'bristol_description', 'pain_0_10', 'urgency', 'abnormalities', 'color',
      'meal', 'foods', 'food_tags', 'portion', 'drink', 'amount_oz', 'stress_1_5', 'sleep_hours', 'sleep_quality_1_5', 'notes'];
    const TYPE_NAMES = { bm: 'bowel movement', meal: 'food', drink: 'drink', day: 'check-in' };
    const rows = store.entries.filter(e => TYPE_NAMES[e.type]).sort((a, b) => a.ts.localeCompare(b.ts)).map(e => {
      const d = new Date(e.ts);
      const row = {
        type: TYPE_NAMES[e.type],
        date: e.type === 'day' ? e.date : dayKey(d),
        time: e.type === 'day' ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        notes: e.notes
      };
      if (e.type === 'bm') Object.assign(row, {
        bristol_type: e.bristol, bristol_description: BRISTOL[e.bristol - 1].desc, pain_0_10: e.pain,
        urgency: URGENCY[e.urgency || 0],
        abnormalities: (e.abnormalities || []).map(a => ABN_BY_ID[a] ? ABN_BY_ID[a].label : a).join('; '),
        color: e.color && COLOR_BY_ID[e.color] ? COLOR_BY_ID[e.color].label : ''
      });
      if (e.type === 'meal') Object.assign(row, {
        meal: (MEAL_BY_ID[e.mealType] || {}).label, foods: (e.items || []).join('; '),
        food_tags: (e.tags || []).map(t => TAG_BY_ID[t] ? TAG_BY_ID[t].label : t).join('; '), portion: e.portion
      });
      if (e.type === 'drink') Object.assign(row, { drink: (DRINK_BY_ID[e.drink] || {}).label, amount_oz: e.oz });
      if (e.type === 'day') Object.assign(row, { stress_1_5: e.stress, sleep_hours: e.sleepHours, sleep_quality_1_5: e.sleepQuality });
      return header.map(h => csvCell(row[h])).join(',');
    });
    download(`gut-log-${dayKey(new Date())}.csv`, [header.join(','), ...rows].join('\n'), 'text/csv');
  }

  function isValidEntry(e) {
    if (!e || typeof e.id !== 'string' || typeof e.type !== 'string' || typeof e.ts !== 'string' || isNaN(new Date(e.ts))) return false;
    if (e.type === 'bm') return Number.isInteger(e.bristol) && e.bristol >= 1 && e.bristol <= 7;
    if (e.type === 'meal') return Array.isArray(e.items);
    if (e.type === 'drink') return typeof e.drink === 'string';
    if (e.type === 'day') return typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date);
    return true; // unknown future types are kept as-is
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { toast('That file isn’t valid JSON.'); return; }
      const incoming = Array.isArray(data) ? data : data && data.entries;
      if (!Array.isArray(incoming)) { toast('No entries found in that file.'); return; }
      const valid = incoming.filter(isValidEntry);
      const byId = new Map(store.entries.map(e => [e.id, e]));
      let added = 0, updated = 0;
      valid.forEach(e => {
        const existing = byId.get(e.id);
        if (!existing) { byId.set(e.id, e); added++; }
        else if ((e.updatedAt || '') > (existing.updatedAt || '')) { byId.set(e.id, e); updated++; }
      });
      store.entries = Array.from(byId.values());
      // Keep this device's learned food tags, but pick up any new ones.
      if (data && data.learnedTags && typeof data.learnedTags === 'object') {
        store.learnedTags = { ...data.learnedTags, ...store.learnedTags };
      }
      if (saveStore()) {
        toast(`Imported: ${added} new, ${updated} updated${valid.length < incoming.length ? `, ${incoming.length - valid.length} skipped` : ''}.`);
        renderSettings();
        updateHeader();
        refreshLogExtras();
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!store.entries.length) { toast('Nothing to delete.'); return; }
    if (!confirm(`Delete all ${store.entries.length} entries? Download a backup first if you might want them later.`)) return;
    if (!confirm('Are you sure? This permanently erases your log on this device.')) return;
    store = { ...emptyStore(), settings: store.settings };
    saveStore();
    resetAllForms();
    renderSettings();
    updateHeader();
    toast('All entries deleted');
  }

  // ---------- Header ----------

  function updateHeader() {
    const todayKey = dayKey(new Date());
    const today = store.entries.filter(e => e.type !== 'day' && dayKey(new Date(e.ts)) === todayKey);
    const bms = today.filter(e => e.type === 'bm').length;
    const meals = today.filter(e => e.type === 'meal').length;
    $('#header-sub').textContent = `Today: ${plural(bms, 'BM')} · ${plural(meals, 'meal')}`;
  }

  // ---------- Init ----------

  function init() {
    applyTheme();
    buildBmForm();
    buildMealForm();
    buildDrinkForm();
    buildDayForm();
    buildRangeGroup();
    buildThemeGroup();
    buildWindowSettings();
    resetAllForms();
    setLogType('bm');
    updateHeader();

    $('#log-switch').addEventListener('change', ev => {
      // Switching type drops any half-finished edit.
      Object.keys(forms).forEach(t => { if (forms[t].elements.id.value && t !== 'day') resetForm(t); });
      setLogType(ev.target.value);
      refreshLogExtras();
    });
    $$('.btn-now').forEach(b => b.addEventListener('click', () => {
      const input = document.getElementById(b.dataset.for);
      input.value = toLocalInput(new Date());
      input.dispatchEvent(new Event('change'));
    }));
    $$('.btn-cancel').forEach(b => b.addEventListener('click', () => {
      resetForm(b.closest('form').dataset.type);
      showView('history');
    }));
    $$('.btn-delete').forEach(b => b.addEventListener('click', onDelete));
    $('#history-filter').addEventListener('change', ev => {
      historyFilter = ev.target.value;
      renderHistory();
    });

    $$('.tab').forEach(t => t.addEventListener('click', () => {
      if (t.dataset.view === 'log') Object.keys(forms).forEach(type => { if (forms[type].elements.id.value && type !== 'day') resetForm(type); });
      showView(t.dataset.view);
    }));
    document.addEventListener('click', ev => {
      const go = ev.target.closest('[data-goto]');
      if (go) showView(go.dataset.goto);
      const goLog = ev.target.closest('[data-goto-log]');
      if (goLog) { setLogType(goLog.dataset.gotoLog); showView('log'); }
      const edit = ev.target.closest('[data-edit]');
      if (edit) {
        const entry = store.entries.find(e => e.id === edit.dataset.edit);
        if (entry) { fillForm(entry); showView('log'); }
      }
    });

    $('#btn-export-json').addEventListener('click', exportJson);
    $('#btn-export-csv').addEventListener('click', exportCsv);
    $('#f-import').addEventListener('change', ev => {
      const f = ev.target.files[0];
      if (f) importJson(f);
      ev.target.value = '';
    });
    $('#btn-clear').addEventListener('click', clearAll);

    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 150); });
    window.addEventListener('scroll', () => $('#tooltip').classList.remove('show'), { passive: true });

    // Keep data in sync when other tabs (or the installed app) change it.
    window.addEventListener('storage', ev => {
      if (ev.key !== STORE_KEY) return;
      store = loadStore();
      updateHeader();
      if (currentView === 'history') renderHistory();
      if (currentView === 'insights') renderInsights();
      if (currentView === 'triggers') renderTriggers();
      if (currentView === 'log') refreshLogExtras();
    });

    // Ask the browser not to evict our data under storage pressure.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
    }
  }

  init();
})();
