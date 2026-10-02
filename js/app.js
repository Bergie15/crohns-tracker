/*
 * Gut Log — a private, on-device bowel movement tracker.
 *
 * Data model (stored in localStorage under STORE_KEY):
 *   { version: 1, entries: Entry[] }
 *
 * Every entry has a `type` so new kinds of records (e.g. 'meal') can live in
 * the same list later and be correlated with bowel movements by timestamp.
 *
 *   BM entry: {
 *     id, type: 'bm', ts (ISO string), bristol (1-7), pain (0-10),
 *     urgency (0-3), abnormalities: string[], color: string|null,
 *     notes: string, createdAt, updatedAt
 *   }
 */
(function () {
  'use strict';

  const STORE_KEY = 'gutlog.v1';
  const THEME_KEY = 'gutlog.theme';
  const RANGE_KEY = 'gutlog.range';

  // ---------- Reference data ----------

  const BRISTOL = [
    { n: 1, name: 'Separate hard lumps', desc: 'Hard lumps, like nuts — hard to pass', group: 'Constipated' },
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

  // ---------- Storage ----------

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { version: 1, entries: [] };
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries)) return { version: 1, entries: [] };
      return data;
    } catch (e) {
      console.error('Could not read saved data', e);
      return { version: 1, entries: [] };
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

  function bmEntries() {
    return store.entries.filter(e => e.type === 'bm').sort((a, b) => b.ts.localeCompare(a.ts));
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  // ---------- Log form ----------

  const form = $('#bm-form');

  function buildForm() {
    $('#bristol-grid').innerHTML = BRISTOL.map(b => `
      <label class="bristol-opt">
        <input type="radio" name="bristol" value="${b.n}" aria-label="Type ${b.n}: ${esc(b.desc)}">
        <span class="bristol-card">
          ${bristolSvg(b.n)}
          <span class="bt-num">Type ${b.n}</span>
          <span class="bt-desc">${esc(b.desc)}</span>
        </span>
      </label>`).join('');

    $('#urgency-group').innerHTML = URGENCY.map((u, i) => `
      <label><input type="radio" name="urgency" value="${i}" ${i === 0 ? 'checked' : ''}><span>${u}</span></label>`).join('');

    $('#abn-group').innerHTML = ABNORMALITIES.map(a => `
      <label class="${a.flag ? 'flag' : ''}"><input type="checkbox" name="abn" value="${a.id}"><span>${esc(a.label)}</span></label>`).join('');

    $('#color-group').innerHTML = COLORS.map(c => `
      <label><input type="radio" name="color" value="${c.id}"><span><i class="color-dot" style="background:${c.hex}"></i>${esc(c.label)}</span></label>`).join('');

    // Allow deselecting the optional color by tapping it again.
    $$('#color-group input').forEach(input => {
      input.addEventListener('pointerdown', () => { input.dataset.wasChecked = input.checked ? '1' : ''; });
      input.addEventListener('click', () => {
        if (input.dataset.wasChecked) { input.checked = false; input.dataset.wasChecked = ''; }
      });
    });

    $('#bristol-grid').addEventListener('change', updateBristolHint);
    $('#f-pain').addEventListener('input', updatePainOut);
    $('#btn-now').addEventListener('click', () => { $('#f-when').value = toLocalInput(new Date()); });
    $('#btn-cancel').addEventListener('click', () => { resetForm(); showView('history'); });
    $('#btn-delete').addEventListener('click', onDelete);
    form.addEventListener('submit', onSubmit);
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

  function resetForm() {
    form.reset();
    form.elements.id.value = '';
    $('#f-when').value = toLocalInput(new Date());
    $('#log-title').textContent = 'Log a bowel movement';
    $('#btn-save').textContent = 'Save entry';
    $('#btn-cancel').classList.add('hidden');
    $('#btn-delete').classList.add('hidden');
    updatePainOut();
    updateBristolHint();
  }

  function fillForm(entry) {
    form.reset();
    form.elements.id.value = entry.id;
    $('#f-when').value = toLocalInput(new Date(entry.ts));
    const b = form.querySelector(`input[name="bristol"][value="${entry.bristol}"]`);
    if (b) b.checked = true;
    $('#f-pain').value = entry.pain ?? 0;
    const u = form.querySelector(`input[name="urgency"][value="${entry.urgency ?? 0}"]`);
    if (u) u.checked = true;
    (entry.abnormalities || []).forEach(a => {
      const cb = form.querySelector(`input[name="abn"][value="${a}"]`);
      if (cb) cb.checked = true;
    });
    if (entry.color) {
      const c = form.querySelector(`input[name="color"][value="${entry.color}"]`);
      if (c) c.checked = true;
    }
    $('#f-notes').value = entry.notes || '';
    $('#log-title').textContent = 'Edit entry';
    $('#btn-save').textContent = 'Save changes';
    $('#btn-cancel').classList.remove('hidden');
    $('#btn-delete').classList.remove('hidden');
    updatePainOut();
    updateBristolHint();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const bristolEl = form.querySelector('input[name="bristol"]:checked');
    if (!bristolEl) {
      toast('Pick a Bristol stool type first.');
      $('#bristol-grid').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const when = $('#f-when').value ? new Date($('#f-when').value) : new Date();
    if (isNaN(when)) { toast('That date/time doesn’t look right.'); return; }

    const now = new Date().toISOString();
    const id = form.elements.id.value;
    const data = {
      type: 'bm',
      ts: when.toISOString(),
      bristol: Number(bristolEl.value),
      pain: Number($('#f-pain').value),
      urgency: Number((form.querySelector('input[name="urgency"]:checked') || {}).value || 0),
      abnormalities: $$('input[name="abn"]:checked', form).map(i => i.value),
      color: (form.querySelector('input[name="color"]:checked') || {}).value || null,
      notes: $('#f-notes').value.trim(),
      updatedAt: now
    };

    if (id) {
      const idx = store.entries.findIndex(e => e.id === id);
      if (idx >= 0) store.entries[idx] = { ...store.entries[idx], ...data };
    } else {
      store.entries.push({ id: uid(), createdAt: now, ...data });
    }
    if (!saveStore()) return;

    toast(id ? 'Entry updated' : 'Entry saved');
    resetForm();
    updateHeader();
    if (id) showView('history');
  }

  function onDelete() {
    const id = form.elements.id.value;
    if (!id) return;
    if (!confirm('Delete this entry? This can’t be undone.')) return;
    store.entries = store.entries.filter(e => e.id !== id);
    saveStore();
    toast('Entry deleted');
    resetForm();
    updateHeader();
    showView('history');
  }

  // ---------- History ----------

  function renderHistory() {
    const list = $('#history-list');
    const entries = bmEntries();
    if (!entries.length) {
      list.innerHTML = `<div class="empty"><p>No entries yet.</p><button class="btn btn-primary" data-goto="log">Log your first one</button></div>`;
      return;
    }
    const groups = new Map();
    entries.forEach(e => {
      const d = new Date(e.ts);
      const k = dayKey(d);
      if (!groups.has(k)) groups.set(k, { date: d, items: [] });
      groups.get(k).items.push(e);
    });

    list.innerHTML = Array.from(groups.values()).map(g => {
      const painAvg = round1(g.items.reduce((s, e) => s + (e.pain || 0), 0) / g.items.length);
      return `
      <div class="day-group">
        <div class="day-head"><h3>${esc(fmtDayHeading(g.date))}</h3><span>${g.items.length} BM${g.items.length > 1 ? 's' : ''} · avg pain ${painAvg}</span></div>
        ${g.items.map(entryHtml).join('')}
      </div>`;
    }).join('');
  }

  function entryHtml(e) {
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
    return `
      <button class="entry" data-edit="${esc(e.id)}" aria-label="Edit entry from ${esc(fmtTime(new Date(e.ts)))}">
        ${bristolSvg(e.bristol)}
        <span class="entry-main">
          <span class="entry-title">Type ${e.bristol} · ${esc(b.name)}</span><br>
          <span class="entry-meta">${meta.join(' · ')}</span>
          ${tags.length ? `<span class="tags">${tags.join('')}</span>` : ''}
          ${e.notes ? `<span class="entry-notes" style="display:block">${esc(e.notes)}</span>` : ''}
        </span>
        <span class="entry-time">${esc(fmtTime(new Date(e.ts)))}</span>
      </button>`;
  }

  // ---------- Insights ----------

  const RANGES = [
    { id: '7', label: '7 days', days: 7 },
    { id: '30', label: '30 days', days: 30 },
    { id: '90', label: '90 days', days: 90 }
  ];
  let rangeId = prefGet(RANGE_KEY, '30');
  if (!RANGES.some(r => r.id === rangeId)) rangeId = '30';

  function buildRangeGroup() {
    $('#range-group').innerHTML = RANGES.map(r => `
      <label><input type="radio" name="range" value="${r.id}" ${r.id === rangeId ? 'checked' : ''}><span>${r.label}</span></label>`).join('');
    $('#range-group').addEventListener('change', ev => {
      rangeId = ev.target.value;
      prefSet(RANGE_KEY, rangeId);
      renderInsights();
    });
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
      b.avgBristol = b.count ? round1(b.items.reduce((s, e) => s + e.bristol, 0) / b.count) : null;
      b.blood = b.items.some(hasBlood);
    });
    return { buckets, entries: inRange };
  }

  function renderInsights() {
    const range = RANGES.find(r => r.id === rangeId);
    const { buckets, entries } = computeDays(range.days);
    const root = $('#insights');

    if (!entries.length) {
      root.innerHTML = `<div class="empty"><p>No entries in the last ${range.days} days.</p><button class="btn btn-primary" data-goto="log">Log an entry</button></div>`;
      return;
    }

    const n = entries.length;
    const avgPerDay = round1(n / range.days);
    const avgBristol = round1(entries.reduce((s, e) => s + e.bristol, 0) / n);
    const avgPain = round1(entries.reduce((s, e) => s + (e.pain || 0), 0) / n);
    const maxPain = Math.max(...entries.map(e => e.pain || 0));
    const typeCounts = [0, 0, 0, 0, 0, 0, 0];
    entries.forEach(e => typeCounts[e.bristol - 1]++);
    const mode = typeCounts.indexOf(Math.max(...typeCounts)) + 1;
    const bloodDays = buckets.filter(b => b.blood).length;
    const looseShare = Math.round(100 * entries.filter(e => e.bristol >= 6).length / n);

    const abnCounts = ABNORMALITIES.map(a => ({ label: a.label, count: entries.filter(e => (e.abnormalities || []).includes(a.id)).length }))
      .filter(a => a.count > 0)
      .sort((a, b) => b.count - a.count);

    root.innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="tile-label">Bowel movements</div><div class="tile-value">${n}</div><div class="tile-sub">${avgPerDay} per day</div></div>
        <div class="tile"><div class="tile-label">Avg Bristol type</div><div class="tile-value">${avgBristol}</div><div class="tile-sub">most often type ${mode} · ${looseShare}% type 6–7</div></div>
        <div class="tile"><div class="tile-label">Avg pain</div><div class="tile-value">${avgPain}</div><div class="tile-sub">peak ${maxPain}/10</div></div>
        <div class="tile ${bloodDays ? 'alert' : ''}"><div class="tile-label">Days with blood</div><div class="tile-value">${bloodDays}</div><div class="tile-sub">of ${range.days} days</div></div>
      </div>

      <div class="card">
        <h3>Bowel movements per day</h3>
        <div class="chart-wrap" data-chart="count"></div>
        ${bloodDays ? '<p class="chart-note"><i></i>Day with blood noted</p>' : ''}
      </div>

      <div class="card">
        <h3>Average pain per day</h3>
        <div class="chart-wrap" data-chart="pain"></div>
      </div>

      <div class="card">
        <h3>Bristol type mix</h3>
        ${hbars(BRISTOL.map((b, i) => ({ label: `${b.n} · ${b.name}`, count: typeCounts[i] })), n)}
      </div>

      <div class="card">
        <h3>Abnormalities</h3>
        ${abnCounts.length ? hbars(abnCounts, n) : '<p>None recorded in this period.</p>'}
      </div>

      <div class="card">
        <details class="table-view">
          <summary>Daily table</summary>
          <table>
            <thead><tr><th>Date</th><th>BMs</th><th>Avg type</th><th>Avg pain</th><th>Blood</th></tr></thead>
            <tbody>
              ${buckets.slice().reverse().map(b => `<tr><td>${esc(fmtShortDate(b.date))}</td><td>${b.count}</td><td>${b.avgBristol ?? '–'}</td><td>${b.avgPain ?? '–'}</td><td>${b.blood ? 'Yes' : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </details>
      </div>`;

    lastBuckets = buckets;
    drawCharts();
  }

  function hbars(rows, total) {
    const max = Math.max(1, ...rows.map(r => r.count));
    return rows.map(r => `
      <div class="hbar-row" title="${esc(r.label)}: ${r.count} of ${total}">
        <span class="hbar-label">${esc(r.label)}</span>
        <span class="hbar-track"><span class="hbar-fill" style="display:block;width:${r.count ? (100 * r.count / max) : 0}%"></span></span>
        <span class="hbar-val">${r.count}</span>
      </div>`).join('');
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

  // ---------- Settings / data ----------

  function buildThemeGroup() {
    const cur = prefGet(THEME_KEY, 'system');
    $('#theme-group').innerHTML = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `
      <label><input type="radio" name="theme" value="${v}" ${v === cur ? 'checked' : ''}><span>${l}</span></label>`).join('');
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

  function renderSettings() {
    const entries = bmEntries();
    $('#data-summary').textContent = entries.length
      ? `${entries.length} entries, from ${new Date(entries[entries.length - 1].ts).toLocaleDateString()} to ${new Date(entries[0].ts).toLocaleDateString()}.`
      : 'No entries yet.';
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
    const header = ['date', 'time', 'bristol_type', 'bristol_description', 'pain_0_10', 'urgency', 'abnormalities', 'color', 'notes'];
    const rows = bmEntries().slice().reverse().map(e => {
      const d = new Date(e.ts);
      return [
        dayKey(d), `${pad(d.getHours())}:${pad(d.getMinutes())}`, e.bristol, BRISTOL[e.bristol - 1].desc,
        e.pain, URGENCY[e.urgency || 0],
        (e.abnormalities || []).map(a => ABN_BY_ID[a] ? ABN_BY_ID[a].label : a).join('; '),
        e.color && COLOR_BY_ID[e.color] ? COLOR_BY_ID[e.color].label : '',
        e.notes
      ].map(csvCell).join(',');
    });
    download(`gut-log-${dayKey(new Date())}.csv`, [header.join(','), ...rows].join('\n'), 'text/csv');
  }

  function isValidEntry(e) {
    return e && typeof e.id === 'string' && typeof e.type === 'string' && typeof e.ts === 'string' && !isNaN(new Date(e.ts)) &&
      (e.type !== 'bm' || (Number.isInteger(e.bristol) && e.bristol >= 1 && e.bristol <= 7));
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
      if (saveStore()) {
        toast(`Imported: ${added} new, ${updated} updated${valid.length < incoming.length ? `, ${incoming.length - valid.length} skipped` : ''}.`);
        renderSettings();
        updateHeader();
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!store.entries.length) { toast('Nothing to delete.'); return; }
    if (!confirm(`Delete all ${store.entries.length} entries? Download a backup first if you might want them later.`)) return;
    if (!confirm('Are you sure? This permanently erases your log on this device.')) return;
    store = { version: 1, entries: [] };
    saveStore();
    renderSettings();
    updateHeader();
    toast('All entries deleted');
  }

  // ---------- Header ----------

  function updateHeader() {
    const todayKey = dayKey(new Date());
    const today = bmEntries().filter(e => dayKey(new Date(e.ts)) === todayKey).length;
    $('#header-sub').textContent = `${today} logged today`;
  }

  // ---------- Init ----------

  function init() {
    applyTheme();
    buildForm();
    buildRangeGroup();
    buildThemeGroup();
    resetForm();
    updateHeader();

    $$('.tab').forEach(t => t.addEventListener('click', () => {
      if (t.dataset.view === 'log' && form.elements.id.value) resetForm();
      showView(t.dataset.view);
    }));
    document.addEventListener('click', ev => {
      const go = ev.target.closest('[data-goto]');
      if (go) showView(go.dataset.goto);
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

    // Keep data when other tabs (or the installed app) change it.
    window.addEventListener('storage', ev => {
      if (ev.key !== STORE_KEY) return;
      store = loadStore();
      updateHeader();
      if (currentView === 'history') renderHistory();
      if (currentView === 'insights') renderInsights();
    });

    // Ask the browser not to evict our data under storage pressure.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
    }
  }

  init();
})();
