# Handoff: LPGP Tracker — Dark Terminal Redesign

## Overview
This is a **pure visual redesign** of the LPGP Tracker (TrackerLPGP repo) — an internal HR/operations app that handles employee time tracking, salary management, hotel/event expenses, days-off calendar, and admin access.

The new look is a dark "finance terminal" aesthetic: deep midnight surfaces, mono numerics, restrained accent colors, Lucide-style line icons (no emoji). The goal is to replace the current indigo-on-light-grid look with something that feels more like Linear, Stripe Dashboard, or a Bloomberg terminal — without changing any business logic or breaking the existing data.

## ⚠️ CRITICAL — Scope & Safety Rules

**TOUCH ONLY THESE 3 FILES:**
- `public/index.html`
- `public/style.css`
- `public/login.html`

**DO NOT TOUCH:**
- `server.js` (Express server + Neon DB queries)
- `database.js` (schema + migrations)
- `public/app.js` (127KB of vanilla-JS UI logic — the part that makes everything work)
- `package.json`, `vercel.json`, `.gitignore`
- The Neon Postgres database itself

**Why this matters:** All employee data, payroll history, hotel expenses, day-off bookings, etc. live in the Postgres DB. The data layer must not be touched. `app.js` reads/writes the DOM by element ID and class name — if you change those, the app breaks. This handoff is exclusively a **CSS + minor HTML markup swap**.

## About the Design Files
The files in `reference/` are **design references created in HTML/React** — a working prototype showing the intended look, interactions, and visual system. They are **not** production code to copy-paste.

Your task is to **port the visual system onto the existing vanilla-JS app** by:
1. Rewriting `public/style.css` from scratch with the new design tokens, while targeting every class name `app.js` currently emits.
2. Lightly editing `public/index.html` to swap emoji icons for inline SVG (Lucide-style) and adjust nav/topbar structure. Element IDs must be preserved 1:1.
3. Rewriting `public/login.html` in the same aesthetic.

## Fidelity
**High-fidelity.** Exact colors, type pairing, spacing, and component anatomy are documented below and visible in `reference/LPGP Tracker Redesign.html`. Aim for pixel-near-match. The reference prototype is built in React for clarity — your output is plain HTML + CSS using `app.js`'s existing markup.

---

## Design Tokens (verbatim — paste into `:root` of style.css)

```css
:root {
  /* SURFACES — default "midnight" palette */
  --bg:            #0a0d14;
  --bg-2:          #0f131c;
  --surface:       #11151e;
  --surface-2:     #161b27;
  --surface-3:     #1c2230;
  --border:        #1f2533;
  --border-bright: #2a3142;
  --line:          #161b27;

  /* TYPE */
  --text:          #e6e8ee;
  --text-2:        #b8bdca;
  --muted:         #7a8294;
  --dim:           #4d5567;

  /* ACCENTS */
  --accent:        #6ee7d4;             /* teal/mint — primary CTAs, active state */
  --accent-soft:   rgba(110,231,212,0.12);
  --accent-line:   rgba(110,231,212,0.32);

  --positive:      #5fd396;             /* green — paid, surplus */
  --positive-soft: rgba(95,211,150,0.10);
  --negative:      #f06b73;             /* red — deductions, unpaid */
  --negative-soft: rgba(240,107,115,0.10);
  --warning:       #f5b860;             /* amber — pending, partial */
  --warning-soft:  rgba(245,184,96,0.10);
  --info:          #7eb6ff;             /* blue — payroll type, informational */
  --info-soft:     rgba(126,182,255,0.10);

  /* legacy color tokens the app already uses — re-map them so app.js
     keeps working without edits. KEEP THESE NAMES. */
  --primary:        var(--accent);
  --primary-dark:   #2d9a86;
  --primary-dim:    var(--accent-soft);
  --primary-light:  var(--accent-soft);
  --danger:         var(--negative);
  --danger-light:   var(--negative-soft);
  --success:        var(--positive);
  --success-light:  var(--positive-soft);

  /* SCALE */
  --sidebar-w:     232px;
  --topbar-h:      56px;
  --radius:        10px;
  --radius-sm:     6px;
  --radius-lg:     14px;
  --row-pad-y:     11px;
  --row-pad-x:     14px;
  --card-pad:      20px;
  --gap:           16px;

  /* TYPE STACKS */
  --font-sans:     'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono:     'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* SHADOWS */
  --shadow-sm:     0 1px 3px rgba(0,0,0,0.4);
  --shadow:        0 4px 16px rgba(0,0,0,0.5);
  --shadow-lg:     0 20px 60px rgba(0,0,0,0.6);
}
```

**Important: keep the `--primary`, `--danger`, `--success` legacy aliases.** `app.js` uses `var(--primary)` and `var(--muted)` in many inline `style=""` strings. Aliasing them to the new accent/red/green keeps those inline styles correct.

---

## Typography

| Use | Family | Size | Weight | Letter-spacing |
|---|---|---|---|---|
| Page title (h1) | Inter | 22px | 600 | -0.5px |
| Card title | Inter | 12.5px | 600 | -0.1px |
| Body | Inter | 13px | 400 | normal |
| Table cell | Inter | 12.5px | 400/500 | normal |
| **Numerics (everything)** | **JetBrains Mono** | inherit | inherit | normal, tnum |
| Micro-labels (eyebrows) | JetBrains Mono | 10px | 600 | 0.8–1.2px UPPERCASE |
| Crumb / "// May 2026" | JetBrains Mono | 11px | 500 | 0.6px UPPERCASE |
| Buttons | Inter | 12px | 500 | normal |
| Form labels | JetBrains Mono | 10px | 600 | 0.8px UPPERCASE |
| Sidebar nav item | Inter | 12.5px | 500 | normal |
| Section labels in sidebar | JetBrains Mono | 9.5px | 600 | 1.4px UPPERCASE |

Load fonts:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
```

**Tabular numerics rule:** anywhere a number appears (£ amounts, minute counts, dates, percentages, table values), wrap it in mono. Add a `.num` utility class to your CSS:
```css
.num, td.num, .stat-value, .dash-hero-value, .dash-mini-value,
.soc-row .v, [class*="-value"], [class*="-amount"] {
  font-family: var(--font-mono);
  font-feature-settings: "tnum", "zero";
}
```

---

## Icon System

**Replace every emoji** in the sidebar/topbar/buttons with inline Lucide-style SVGs (1.5px stroke, currentColor, 16px default).

A complete icon set is in `reference/redesign/icons.jsx` — all paths are standard SVG `<path>` elements. To use in vanilla HTML, inline them. Example for "Dashboard":

```html
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="7" height="9"/>
  <rect x="14" y="3" width="7" height="5"/>
  <rect x="14" y="12" width="7" height="9"/>
  <rect x="3" y="16" width="7" height="5"/>
</svg>
```

### Emoji → Icon mapping (in current `index.html`)

| Old emoji | Old location | New icon name (see icons.jsx) |
|---|---|---|
| ⏱ | sidebar-logo-icon | `command` or keep as "L" monogram |
| 📊 | Dashboard nav | `dashboard` |
| ⏱️ | Daily Tracking nav | `clock` |
| 📅 | Calendar nav | `calendar` |
| 💰 | Salary nav | `wallet` |
| 👥 | Employees nav | `users` |
| 🏨 | Hotel Expenses nav | `hotel` |
| 📋 | Reports nav | `report` |
| 🔐 | Admin Users nav | `shield` |
| 💷 | Salary mini-card | `wallet` (or `banknote`) |
| 🔔 / ✅ | Salary alert mini-card | `bell` / `check` |
| ⚠️ | Dash panel header | `alert` |
| ✕ | Modal close, etc. | `x` |

For the dynamically generated mini-cards in app.js (lines ~337, 345, 353), `app.js` emits `<div class="dash-mini-icon">💷</div>` directly. **Leave these emoji** — replacing them requires editing `app.js`, which is out of scope. Instead, style `.dash-mini-icon` to make the emoji look intentional: small (18px), low opacity (0.7), monochrome-grayscale filter.

```css
.dash-mini-icon {
  font-size: 18px;
  opacity: 0.55;
  filter: grayscale(1);
}
```

The nav icons in `index.html` are static markup — those you should swap to SVG.

---

## Layout System

### App shell

```
┌─────────────┬────────────────────────────────────────┐
│             │  TOPBAR (56px) — crumb + search + user │
│  SIDEBAR    ├────────────────────────────────────────┤
│   (232px)   │                                        │
│             │  CONTENT (scrollable, max-w 1480px)    │
│             │                                        │
└─────────────┴────────────────────────────────────────┘
```

Body must be `overflow: hidden`; the content column is the only scroll container.

```css
.app { display: flex; min-height: 100vh; height: 100vh; overflow: hidden; }
.sidebar { width: var(--sidebar-w); flex-shrink: 0; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.content { flex: 1; overflow-y: auto; padding: 22px 26px 60px; }
```

### Sidebar anatomy

- Background `--bg-2` (#0f131c), border-right `--border`.
- Logo block at top with 28×28 mint-gradient square ("L" monogram in JetBrains Mono 13px bold), brand wordmark in Inter 13/600 next to it. Sub-label in mono 10px uppercase ("Tracker · ops").
- Nav grouped into **Workspace** / **Finance** / **Admin** sections with mono uppercase section headers (9.5px, 1.4px tracking, `--dim` color).
- Nav items: 7px padding, 12.5px Inter, color `--text-2`. Active state: `--surface-2` background, inset 1px `--border-bright` ring, **2px mint vertical accent bar** absolutely positioned at `left: -8px` of the item (or `left: 0` when sidebar is collapsed).
- Icon left-aligned, 16px, color `--muted` (or `--accent` when active).
- Footer with shift/payroll/self-emp stats in mono key-value rows, then Sign Out button.

See `reference/redesign/shell.jsx` `Sidebar` component for exact markup.

### Topbar

- 56px height, `--bg-2` background, border-bottom `--border`.
- Left: crumb (mono 11px UPPERCASE `--muted`, e.g. "WORKSPACE / DASHBOARD") above page title (Inter 14/600 `--text`).
- Center spacer.
- Right cluster: search box → live date/time (mono 11px with a green pulse dot) → bell icon button → user pill (avatar + name + role chip + chevron).

### Page head pattern

Every page starts with:
```html
<div class="page-head">
  <div>
    <h1>Dashboard <span class="tag">May 2026</span></h1>
    <div class="sub">// Operations overview · live · 12 active employees</div>
  </div>
  <div class="actions">
    <button class="btn">Export</button>
    <button class="btn btn-primary">+ New record</button>
  </div>
</div>
```

- `h1`: Inter 22/600, -0.5px tracking.
- `.tag`: small mint pill, mono 10px UPPERCASE, with `--accent-soft` bg + `--accent-line` border.
- `.sub`: mono 12px `--muted`, prefixed with `// ` (terminal-comment vibe).

---

## Component Library

### Buttons

```css
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px;
  border-radius: 7px;
  font: 500 12px/1 var(--font-sans);
  border: 1px solid var(--border-bright);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
  transition: all .12s;
}
.btn:hover { background: var(--surface-2); color: var(--text); }

.btn-primary {
  background: var(--accent); color: #0a0d14;
  border-color: var(--accent); font-weight: 600;
}
.btn-primary:hover { background: #82eddc; }

.btn-ghost { background: transparent; border-color: transparent; color: var(--muted); }
.btn-ghost:hover { background: var(--surface-2); color: var(--text); }

.btn-danger { color: var(--negative); border-color: rgba(240,107,115,0.4); background: transparent; }
.btn-danger:hover { background: var(--negative-soft); }

.btn-sm { padding: 4px 8px; font-size: 11px; }
```

### Badges / Pills

`app.js` emits these badge classes — all must look great in dark mode:

| Class | Use | Background | Color |
|---|---|---|---|
| `.badge` (base) | wraps all | `var(--surface-2)` | `var(--text-2)` |
| `.badge-blue` | payroll, info | `var(--info-soft)` | `var(--info)` |
| `.badge-yellow` | partial, half day, warning | `var(--warning-soft)` | `var(--warning)` |
| `.badge-red` | unpaid, full day, error | `var(--negative-soft)` | `var(--negative)` |
| `.badge-green` | paid, OK | `var(--positive-soft)` | `var(--positive)` |
| `.badge-grey` | permanent, neutral | `var(--surface-2)` | `var(--text-2)` |

```css
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  font: 600 10px/1 var(--font-mono);
  padding: 3px 7px;
  border-radius: 4px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  border: 1px solid transparent;
}
```

### Cards

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.card-header {  /* app.js uses this name */
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
}
.card-title { font: 600 12.5px/1 var(--font-sans); color: var(--text); }
```

### Tables

```css
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
thead th {
  text-align: left; padding: 10px var(--row-pad-x);
  font: 600 10px/1 var(--font-mono);
  letter-spacing: 0.8px; text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
  white-space: nowrap;
  position: sticky; top: 0; z-index: 1;
}
tbody td {
  padding: var(--row-pad-y) var(--row-pad-x);
  border-bottom: 1px solid var(--line);
  color: var(--text-2);
}
tbody tr:hover { background: var(--surface-2); }
tbody tr:last-child td { border-bottom: none; }
.table-wrap { overflow-x: auto; }
```

### Forms (inside modals)

```css
.form-group label {
  font: 600 10px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--muted);
  display: block; margin-bottom: 5px;
}
.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  background: var(--bg-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
  font: 400 12.5px/1.4 var(--font-sans);
  outline: none;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.form-group input[type=number] { font-family: var(--font-mono); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
```

### Modal

```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(5,7,12,0.7);
  backdrop-filter: blur(6px);
  display: none;       /* app.js toggles this with classList */
  align-items: center; justify-content: center;
  z-index: 200; padding: 20px;
}
.modal-overlay.active { display: flex; }
.modal {
  background: var(--surface);
  border: 1px solid var(--border-bright);
  border-radius: var(--radius-lg);
  width: 540px; max-width: 100%;
  max-height: 90vh; overflow-y: auto;
  box-shadow: var(--shadow-lg);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; border-bottom: 1px solid var(--border);
}
.modal-header h2 { font: 600 14px/1 var(--font-sans); color: var(--text); }
.modal-close {
  width: 28px; height: 28px; border-radius: 6px;
  display: grid; place-items: center;
  background: var(--bg-2); border: 1px solid var(--border);
  color: var(--muted); cursor: pointer;
}
.modal-close:hover { color: var(--text); }
```

### Dashboard-specific (from app.js)

`app.js` lines 280–360 emit a `.dash-bento` grid with `.dash-hero-card` and three `.dash-mini-card`s:

```css
.dash-bento {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
  margin-bottom: var(--gap);
}
.dash-mini-grid {
  display: grid;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 12px;
}

.dash-hero-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px;
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; gap: 14px;
}
.dash-hero-glow {
  position: absolute; top: -80px; right: -80px;
  width: 280px; height: 280px; border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 70%);
  pointer-events: none;
}
.dash-hero-label {
  font: 600 10px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: 1.2px;
  color: var(--muted);
}
.dash-hero-value {
  font: 600 64px/1 var(--font-mono);
  color: var(--text); letter-spacing: -2px;
}
.dash-hero-pills { display: flex; gap: 8px; }
.dash-hero-pill {
  font: 600 11px/1 var(--font-mono);
  padding: 5px 9px; border-radius: 5px;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.dash-hero-pill--blue { background: var(--info-soft); color: var(--info); }
.dash-hero-pill--amber { background: var(--warning-soft); color: var(--warning); }
.dash-hero-footer { font: 500 11px/1 var(--font-mono); color: var(--dim); margin-top: auto; }

.dash-mini-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  display: flex; align-items: center; gap: 12px;
  cursor: pointer; transition: border-color .12s, background .12s;
}
.dash-mini-card:hover { border-color: var(--border-bright); background: var(--surface-2); }
.dash-mini-card.dash-mini--indigo { border-left: 2px solid var(--accent); }
.dash-mini-card.dash-mini--green  { border-left: 2px solid var(--positive); }
.dash-mini-card.dash-mini--alert  { border-left: 2px solid var(--negative); }
.dash-mini-icon { font-size: 18px; opacity: 0.55; filter: grayscale(1); width: 28px; text-align: center; }
.dash-mini-label { font: 600 10px/1 var(--font-mono); text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); margin-bottom: 4px; }
.dash-mini-value { font: 600 18px/1 var(--font-mono); color: var(--text); letter-spacing: -0.3px; margin-bottom: 3px; }
.dash-mini-sub   { font: 500 10.5px/1 var(--font-mono); color: var(--dim); }
```

### Dashboard alert panels (`.dash-panel--alert`, `.dash-panel-row`, etc.)

```css
.dash-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.dash-panel--alert { border-color: rgba(245,184,96,0.3); }
.dash-panel-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
}
.dash-panel-icon { color: var(--warning); }       /* leave emoji or swap to SVG via JS later */
.dash-panel-title { font: 600 12.5px/1 var(--font-sans); color: var(--text); flex: 1; }
.dash-panel-count {
  font: 600 11px/1 var(--font-mono);
  padding: 2px 7px; border-radius: 4px;
  background: var(--warning-soft); color: var(--warning);
}
.dash-panel-body { padding: 4px 0; }
.dash-panel-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.dash-panel-row:last-child { border-bottom: none; }
```

### Salary overview cards (`.salary-overview-card`, `.soc-*`)

```css
.salary-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.salary-overview-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.salary-overview-card.soc-gbp-total { border-color: var(--accent-line); }
.soc-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
  font: 600 12px/1 var(--font-sans); color: var(--text);
}
.soc-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 16px;
  font: 500 12px/1 var(--font-sans);
  border-bottom: 1px dashed var(--border);
}
.soc-row:last-child { border-bottom: none; }
.soc-row .k { color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
.soc-row .v { color: var(--text); font-family: var(--font-mono); font-weight: 500; }
```

### Salary tabs

```css
.salary-tabs {
  display: flex; gap: 2px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px; margin-bottom: 16px;
  width: fit-content;
}
.salary-tab {
  padding: 5px 12px;
  font: 500 11.5px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: 0.4px;
  color: var(--muted);
  cursor: pointer;
  border-radius: 5px;
  background: transparent; border: none;
}
.salary-tab.active { background: var(--surface-3); color: var(--text); }
```

### Hotel rows (`hotel-row-paid`, `hotel-row-partial`)

These are `<tr>` modifier classes on the hotel table:
```css
#hotelTable tbody tr.hotel-row-paid    { background: rgba(95,211,150,0.03); }
#hotelTable tbody tr.hotel-row-partial { background: rgba(245,184,96,0.03); }
```

### Calendar (`#calGrid`, `.cal-chip`, `cal-reminder-dot`, `chip-full`, `chip-half`)

```css
.cal-grid-wrap { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.cal-header-row {
  display: grid; grid-template-columns: repeat(7, 1fr);
  background: var(--bg-2); border-bottom: 1px solid var(--border);
}
.cal-header-row > div {
  padding: 8px 10px;
  font: 600 10px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: 1px;
  color: var(--muted);
}
.cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 1px; background: var(--border);
}
/* each cell will be set by app.js — give it a class hook target */
.cal-grid > div {
  background: var(--surface);
  min-height: 92px; padding: 8px 10px;
  cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
}
.cal-grid > div:hover { background: var(--surface-2); }
.cal-chip {
  display: inline-block;
  font: 600 9.5px/1 var(--font-mono);
  padding: 2px 5px; border-radius: 3px;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.chip-full { background: var(--info-soft); color: var(--info); }
.chip-half { background: var(--warning-soft); color: var(--warning); }
.cal-reminder-dot.cat-rent     { background: var(--accent); }
.cal-reminder-dot.cat-utility  { background: var(--warning); }
.cal-reminder-dot.cat-subscription { background: var(--info); }
.cal-reminder-dot.cat-deposit  { background: var(--positive); }
.cal-reminder-dot.cat-other    { background: var(--text-2); }
```

### Stats grid (`.stats-grid`, `.stat-card`, `.stat-card.blue/.yellow/.red/.green`)

```css
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: var(--gap);
}
.stat-card {
  background: var(--surface);
  padding: 18px 18px 16px;
  display: flex; flex-direction: column; gap: 6px;
  min-height: 96px;
}
.stat-label {
  font: 600 10px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: 1px;
  color: var(--muted);
}
.stat-value {
  font: 600 26px/1.1 var(--font-mono);
  color: var(--text); letter-spacing: -0.5px;
}
.stat-card.blue   { box-shadow: inset 2px 0 0 var(--info); }
.stat-card.yellow { box-shadow: inset 2px 0 0 var(--warning); }
.stat-card.red    { box-shadow: inset 2px 0 0 var(--negative); }
.stat-card.green  { box-shadow: inset 2px 0 0 var(--positive); }
```

### Toast (`#toastContainer`)

```css
#toastContainer {
  position: fixed; bottom: 24px; right: 24px;
  display: flex; flex-direction: column; gap: 8px;
  z-index: 300;
}
.toast {
  background: var(--surface-2);
  border: 1px solid var(--border-bright);
  border-radius: 9px;
  padding: 10px 14px;
  font: 500 12px/1 var(--font-sans);
  color: var(--text);
  box-shadow: var(--shadow);
  animation: toastIn .25s ease;
}
.toast.success { border-left: 2px solid var(--positive); }
.toast.error   { border-left: 2px solid var(--negative); }
.toast.info    { border-left: 2px solid var(--info); }
@keyframes toastIn { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
```

### Adjustments / Notes lists (`.adj-list`, `.adj-item`, `.adj-amount`)

```css
.adj-list { display: flex; flex-direction: column; gap: 6px; }
.adj-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
}
.adj-amount {
  font: 600 11.5px/1 var(--font-mono);
  padding: 2px 7px; border-radius: 4px;
  margin-right: 4px;
}
.adj-amount.positive { background: var(--negative-soft); color: var(--negative); }  /* adds deduction */
.adj-amount.negative { background: var(--positive-soft); color: var(--positive); }  /* removes */
```

### Deduction box (`.deduction-box`, `.deduction-row`)

```css
.deduction-box {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-top: 16px;
}
.deduction-row {
  display: flex; justify-content: space-between;
  padding: 5px 0;
  font: 500 12px/1.3 var(--font-mono);
  border-bottom: 1px dashed var(--border);
}
.deduction-row:last-child, .deduction-row.total { border-bottom: none; }
.deduction-row.total {
  margin-top: 6px; padding-top: 10px;
  border-top: 1px solid var(--border);
  font-weight: 700; color: var(--text);
}
```

### Login page

Full-bleed midnight background, centered card. See `reference/redesign/styles.css` line 75–145 for the original card pattern — re-skin to the new tokens:

```css
.login-wrap {
  min-height: 100vh;
  background: var(--bg);
  background-image:
    radial-gradient(800px 500px at 70% 10%, var(--accent-soft), transparent 60%),
    radial-gradient(600px 400px at 20% 90%, var(--info-soft), transparent 60%);
  display: grid; place-items: center;
}
.login-card {
  background: var(--surface);
  border: 1px solid var(--border-bright);
  border-radius: var(--radius-lg);
  padding: 36px 32px;
  width: 380px; max-width: 95vw;
  box-shadow: var(--shadow-lg);
}
.login-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
.login-logo-icon {
  width: 36px; height: 36px; border-radius: 8px;
  background: linear-gradient(140deg, var(--accent), #2d9a86);
  color: #0a0d14; font: 700 14px/1 var(--font-mono);
  display: grid; place-items: center;
  box-shadow: 0 0 0 1px var(--accent-line), 0 4px 16px var(--accent-soft);
}
/* preserve the rest of the existing login HTML/IDs — login.js or inline script handles auth */
```

---

## Bottom navigation (mobile) — `.bottom-nav`, `.bottom-nav-item`

```css
.bottom-nav { display: none; }     /* hidden on desktop */
@media (max-width: 768px) {
  .sidebar { display: none; }
  .bottom-nav {
    display: grid; grid-template-columns: repeat(5, 1fr);
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--bg-2);
    border-top: 1px solid var(--border);
    padding: 8px 4px; z-index: 50;
  }
  .bottom-nav-item {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 6px 0;
    color: var(--muted);
    font: 500 10px/1 var(--font-sans);
    cursor: pointer;
  }
  .bottom-nav-item.active { color: var(--accent); }
  .bottom-nav-icon { font-size: 18px; }    /* keeps emoji visible on mobile */
}
```

---

## Hamburger / mobile drawer

```css
.hamburger {
  display: none;     /* show on mobile, hide on desktop */
  width: 36px; height: 36px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 7px;
  padding: 9px;
  flex-direction: column; gap: 4px;
  cursor: pointer;
}
.hamburger span {
  height: 1.5px; background: var(--text); border-radius: 1px;
  transition: transform .2s, opacity .2s;
}
@media (max-width: 768px) { .hamburger { display: flex; } }

.nav-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 90;
  display: none;
}
.nav-overlay.open { display: block; }
.sidebar.open { transform: translateX(0); }
@media (max-width: 768px) {
  .sidebar {
    position: fixed; top: 0; bottom: 0; left: 0;
    transform: translateX(-100%);
    z-index: 100;
    transition: transform .2s;
  }
}
```

---

## Element IDs that MUST be preserved in index.html

`app.js` reads/writes these — change any of them and the app breaks. Full list:

```
userLabel, todayDate, pageTitle, hamburgerBtn, navOverlay, logoutBtn
salaryNavBadge, salaryBottomBadge, toastContainer

# Dashboard
dashStats, contractExpiryPanel, headcountPanel, dashTable

# Daily Tracking
trackEmp, trackMonth, empStatsBar, daysOffBanner, trackTableTitle, trackTable, trackEmpty
paymentsSection, salaryInfo, paymentsTable, paymentsEmpty

# Salary
salaryReminderPanel, salaryReminderTitle, salaryReminderRows
salaryYear, salaryEmpFilter, salarySearch, salaryTotals, salaryCards

# Employees
empSearch, empTable

# Reports
repFrom, repTo, repEmp, reportContent

# Calendar
calMonthLabel, calEmpFilter, calGrid, calSummary

# Admins
adminTable

# Hotels
hotelStatusFilter, hotelSearch, hotelSummary, hotelTable, hotelTableBody, hotelRowCount, hotelEmpty

# Modal containers
recordModal, adjModal, empModal, noteModal, paymentModal, adminModal,
officeDeductModal, bonusModal, salaryPayModal, dayModal, calReminderModal,
hotelModal, terminateModal

# Modal form inputs — see existing index.html lines 195-650 for the full list;
# all current IDs must remain (recId, recEmpId, recDate, recDayOff, recBreak,
# recPhone, recWasted, recLate, recNotes, empId, empName, empStartDate,
# empType, empCurrency, empAnnualSalary, empPensionRate, empJobTitle,
# empDepartment, empPhone, empEmail, empContractEnd, empSalaryEffective,
# empSalaryReason, salaryChangeFields, empModalTitle, pensionRateField,
# termEmpId, termEmpName, termDate, termReason, termNotes,
# payEmpId, payYear, payMonth, payAmount, payNotes,
# newAdminUser, newAdminPass, newAdminRole,
# odEmpId, odDescription, odAmount, odDate, odNotes,
# bonusEmpId, bonusAmount, bonusDate, bonusReason, bonusNotes,
# spEmpId, spYear, spMonth, spAmount, spNotes, salaryPayModalTitle,
# dayModalTitle, dayModalContent, dayModalBookBtn,
# crTitle, crCategory, crDate, crRecurrence, crAmount, crCurrency, crNotes,
# noteEmpId, noteType, noteText,
# adjMinutes, adjReason, adjModalSubtitle, adjList,
# hotelEditId, hotelEventName, hotelHotelName, hotelCost, hotelStatus,
# hotelAvCurrency, hotelAvAmount, hotelAvBilling, hotelPaidCurrency,
# hotelPaidAmount, hotelStaffHotel, hotelFlights, hotelPrinting, hotelNotes,
# hotelModalTitle)
```

The full list of input IDs is visible in the existing `public/index.html` — every input/select/textarea inside a `.modal` retains its ID exactly.

---

## Class names that MUST keep working (app.js emits them dynamically)

These appear in `app.js` inside `innerHTML` template strings — your CSS must style them:

**Layout / panels:** `dash-bento`, `dash-hero-card`, `dash-hero-glow`, `dash-hero-label`, `dash-hero-value`, `dash-hero-pills`, `dash-hero-pill`, `dash-hero-pill--blue`, `dash-hero-pill--amber`, `dash-hero-footer`, `dash-mini-grid`, `dash-mini-card`, `dash-mini--indigo`, `dash-mini--green`, `dash-mini--alert`, `dash-mini-icon`, `dash-mini-body`, `dash-mini-label`, `dash-mini-value`, `dash-mini-sub`, `dash-panel`, `dash-panel--alert`, `dash-panel-header`, `dash-panel-icon`, `dash-panel-title`, `dash-panel-count`, `dash-panel-body`, `dash-panel-row`, `dash-two-col`

**Sidebar user:** `sidebar-user-pill`, `sidebar-user-avatar`, `sidebar-user-name`

**Generic:** `card`, `card-header`, `card-title`, `table-wrap`, `stat-card`, `stat-label`, `stat-value`, `empty-state`, `skeleton`, `hidden`, `text-danger`, `fw-bold`, `nav-badge`, `nav-badge-bottom`

**Badges:** `badge`, `badge-blue`, `badge-yellow`, `badge-red`, `badge-green`, `badge-grey`

**Buttons:** `btn`, `btn-primary`, `btn-ghost`, `btn-danger`, `btn-sm`

**Salary:** `salary-overview-card`, `salary-overview-grid`, `soc-header`, `soc-row`, `soc-gbp-total`, `salary-tabs`, `salary-tab`, `salary-card` (per-employee detail card — see app.js lines 1100+ for full markup), `salary-reminder-panel`, `salary-reminder-header`, `salary-reminder-icon`, `salary-reminder-title`, `salary-reminder-dismiss`

**Hotels:** `hotel-row-paid`, `hotel-row-partial`

**Calendar:** `cal-grid`, `cal-grid-wrap`, `cal-header-row`, `cal-chip`, `chip-full`, `chip-half`, `cal-reminder-dot`, `cat-rent`, `cat-utility`, `cat-subscription`, `cat-deposit`, `cat-other`

**Forms/modals:** `modal-overlay`, `modal`, `modal-header`, `modal-close`, `form-group`, `form-row`, `filter-bar`, `section-title`, `modal-section-label`

**Hotel modal:** `hotel-modal`, `hm-section`, `hm-body`, `hm-2col`, `hm-3col`, `hm-col-title`, `hm-pay-fields`, `hm-currency-sel`, `hm-currency-amt`, `hm-billing-sel`, `hm-footer`

**Misc:** `deduction-box`, `deduction-row`, `adj-list`, `adj-item`, `adj-amount`, `positive`, `negative`

**Skeletons:** `skeleton` — pulsing loading placeholder.
```css
.skeleton {
  background: linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%);
  background-size: 200% 100%;
  animation: skeleton 1.5s ease-in-out infinite;
  border-radius: var(--radius);
}
@keyframes skeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

---

## Suggested implementation order

1. **Write the new `public/style.css` from scratch.** Start with `:root` tokens, then layout (`.app`, `.sidebar`, `.main`, `.topbar`, `.content`), then components in this order: buttons, badges, forms, tables, cards, modals, dashboard tiles, salary, hotels, calendar, login. Use the existing `public/style.css` (currently 69KB) as a checklist — every selector there has to have a new dark-theme equivalent.

2. **Edit `public/index.html` minimally.** The structural skeleton stays the same. Changes:
   - Swap emoji nav icons (lines 16–26) for inline SVGs from the icon table above.
   - Update the brand block: keep the logo container but swap the `⏱` emoji for an "L" monogram or a small SVG.
   - Topbar: add a search box element and date pulse indicator (see `reference/redesign/shell.jsx` Topbar component).
   - Add the page-head `.sub` micro-label pattern to each `<div class="page" id="page-*">`.
   - Don't remove or rename any existing IDs/classes.

3. **Rewrite `public/login.html`** in the new aesthetic. The auth POST logic at the bottom is fine — leave it alone.

4. **Test against real data**: log in, click every nav item, open every modal, add a record, log a payment, add a hotel expense. If any DOM element looks broken, it means a class name in `app.js` wasn't styled — search `app.js` for the class and add CSS for it.

5. **Optional polish — DO NOT do until everything above works:** swap a few emoji-in-`innerHTML` strings for inline SVG (e.g. `<span class="dash-panel-icon">⚠️</span>` → SVG alert icon). These require minimal `app.js` edits but cross the "don't touch app.js" line, so check with the user first.

---

## What's in `reference/`

- `LPGP Tracker Redesign.html` — the working React prototype. Open it to see every page rendered, with Tweaks panel for palette/density/sidebar/layout variations.
- `redesign/styles.css` — the prototype's CSS. Don't copy verbatim (it uses different class names like `.sb-item`, `.tbl`, `.pill`) — instead use it as a visual reference and lift the design tokens.
- `redesign/icons.jsx` — the full Lucide icon set (extract `<path>` content for inline SVG use).
- `redesign/data.jsx` — sample data shape (not relevant for the port; your DB has the real schema).
- `redesign/shell.jsx`, `pages-1.jsx`, `pages-2.jsx`, `pages-3.jsx`, `app.jsx` — component breakdown showing intended structure per page.

---

## Acceptance criteria

- [ ] All 8 pages render and look like the reference prototype (dark, mono numerics, line icons).
- [ ] All modals open, all form inputs are styled, every Save/Cancel works as before.
- [ ] All toasts, badges, alert banners look correct in dark mode.
- [ ] Login page matches the new aesthetic.
- [ ] Mobile/responsive: bottom nav appears under 768px, sidebar drawer opens via hamburger.
- [ ] No console errors. No JS edited. No data lost.
- [ ] `git diff` only touches `public/index.html`, `public/style.css`, `public/login.html` (and nothing else).
