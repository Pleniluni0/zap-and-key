# ⚡ Zap & Key ⌨️

**Browser extension to zap annoying elements, bind keyboard shortcuts to buttons, and auto-scroll with auto-advance — all with per-domain persistence.**

[![Chrome](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome)](https://chromewebstore.google.com)
[![Manifest](https://img.shields.io/badge/manifest-v3-green)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

---

## 🎯 What it does

### ⚡ Zap Mode — Remove anything
Click-to-remove any HTML element from a page. The extension generates a resilient CSS selector and hides the element permanently for that domain. Reload the page — it stays gone.

| Feature | Detail |
|---------|--------|
| 🖱️ One-click removal | Click any element to hide it instantly |
| 💾 Per-domain persistence | Rules stored in `chrome.storage.local` |
| 🔄 Undo toast | "Elemento eliminado — Deshacer" with 5s timeout |
| ⏸️ Pause per domain | Temporarily disable rules without deleting them |
| 🧠 Smart selectors | Prefers `data-testid`, `aria-label`, semantic classes over `nth-of-type` |
| 🌳 Shadow DOM aware | Detects elements inside shadow roots |
| 👁️ MutationObserver | Re-applies rules when SPAs (React/Vue) re-render the DOM |

### ⌨️ Key Bind Mode — Click with your keyboard
Assign any keyboard key to any button/link on a page. Press the key and the extension clicks the element for you.

| Feature | Detail |
|---------|--------|
| 🎯 Click-to-assign | Click a button → press a key → done |
| 🔵 Key overlay | Visual prompt: *"Pulse una tecla para asignar"* |
| 🧠 Input-aware | Won't fire while typing in `<input>` or `<textarea>` |
| 🏷️ Key badges | Displays `→`, `↵`, `␣`, `F2`, etc. in the popup |
| 💾 Per-domain persistence | Keybinds saved per domain |

### 🤖 Auto Mode — Hands-free reading
Ideal for comics and manga! Auto-scrolls the page at configurable speed, then automatically advances to the next page.

| Feature | Detail |
|---------|--------|
| 📜 Smooth auto-scroll | 5 speeds: Lento, Suave, Medio, Ágil, Rápido |
| ⏱️ Configurable wait | 0.5–10s pause at the bottom before advancing |
| 🔗 Auto-advance | Clicks the "Next" button using an existing keybind |
| 🔢 Countdown badge | Circular badge shows seconds remaining before page change |
| 🔄 Auto-resume | Automatically restarts scrolling on the next page |
| ⌨️ Custom shortcut | Configurable keyboard shortcut to toggle auto-scroll (per domain) |
| 💾 Per-domain config | Speed, wait time, next-key, and shortcut saved per domain |

### 📖 Reading History — Track your progress
Automatically detects series and chapter from the page URL or title, so you always know where you left off.

| Feature | Detail |
|---------|--------|
| 🧠 Smart detection | Parses URL patterns + `<meta og:title>` + `<h1>` + `<title>` |
| 🔗 Compound slugs | Supports `{series}_{timestamp}-{ch}_{page}` format (manhwaweb, etc.) |
| 🌐 Multi-site | Works on any comic/manga site (Spanish, English, Japanese) |
| 📊 Per-series tracking | Tracks each series independently, even on the same domain |
| 📁 Grouped by domain | History entries are grouped and collapsible by domain in its own tab |
| 🖱️ One-click resume | Click any entry to jump straight to your last chapter |
| 🗑️ Manageable | Delete individual entries or wipe an entire domain at once |
| ⏱️ Timestamps | Shows "hace 5m", "hace 2h", "ayer", "hace 3d", etc. |
| 💾 LRU capped | Keeps the latest 100 entries |

---

## 🚀 Install

### From source (developer mode)
1. Clone or download this repo
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the project folder
5. Pin the extension to your toolbar

### From Chrome Web Store
*Coming soon*

---

## 🧭 Popup layout

The popup has **3 tabs** for better organization:

```
┌──────────────────────────────────────┐
│          ⚡ Zap & Key ⌨️             │
│  [⚡ Zap & Key] [🤖 Auto] [📖 Hist]  │
├──────────────────────────────────────┤
│                                      │
│  TAB 1 — Zap & Key (default)         │
│  ┌────────────────────────────────┐  │
│  │ [⚡ Zap Mode]  [⌨️ Key Bind]   │  │
│  │                                │  │
│  │ 🗑️ Elementos Bloqueados       │  │
│  │ ▸ example.com (5 guardados)    │  │
│  │   [⏸️] [🗑️]                   │  │
│  │                                │  │
│  │ ⌨️ Atajos de Tecla            │  │
│  │ ▸ example.com (2 atajos)       │  │
│  │   [→] Siguiente         [✕]   │  │
│  │                                │  │
│  │ [📤 Exportar] [📥 Importar]    │  │
│  └────────────────────────────────┘  │
│                                      │
│  TAB 2 — Auto                        │
│  ┌────────────────────────────────┐  │
│  │ Velocidad: [🐢🐌🚶🚀💨]        │  │
│  │ Espera (s): [2] [Atajo: ...]   │  │
│  │ Tecla Sig.: [→ Siguiente]      │  │
│  │ [▶ Iniciar]  [■ Parar]         │  │
│  └────────────────────────────────┘  │
│                                      │
│  TAB 3 — Historial                   │
│  ┌────────────────────────────────┐  │
│  │ ▸ tusmangas.com (2) ← actual   │  │
│  │   One Piece [Cap.1088] hace 2h │  │
│  │   Solo Leveling [Cap.142] ayer │  │
│  │ ▸ manhwaweb.com (1)            │  │
│  │   Manual Supervivencia [Cap.4] │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| *Custom (per domain)* | Toggle Auto-Scroll (configure in popup) |
| *Your custom keys* | Trigger assigned buttons (per domain) |
| `Escape` | Cancel any active mode |

---

## 🧱 Architecture

```
zap-and-key/
├── manifest.json          # MV3 manifest
├── src/
│   ├── content.js         # Main engine (zap, keybinds, auto-scroll, observer, overlay)
│   └── background.js      # Service worker
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic (CRUD, auto-mode, shortcut capture, export/import)
│   └── style.css          # Popup styling
├── icons/
│   ├── icon16.png         # Toolbar icon
│   ├── icon48.png         # Extensions page icon
│   └── icon128.png        # Web Store / details icon
└── README.md
```

### Data flow
```
User click → content.js → generateSelector()
    → chrome.storage.local.set({ zap_rules: { domain: [selectors] } })
    → inject <style> with display:none !important
    → MutationObserver watches for DOM changes (SPAs)
    → onChanged listener syncs across tabs

User assigns keybind → showKeybindPrompt() → saveKeybind()
    → chrome.storage.local.set({ zap_keybinds: { domain: [{key, selector, label}] } })
    → setupKeybindListener() adds keydown handler

Auto-scroll start → requestAnimationFrame scroll loop
    → on bottom: countdown badge → click next-button (via keybind selector)
    → auto-resume on next page via loadAutoConfig()

Page load → detectSeriesChapter() → parse URL/title patterns
    → recordReadingHistory() → zap_reading_history storage
    → Popup shows 📖 Historial with click-to-resume
```

---

## 🛠️ Storage keys

| Key | Type | Description |
|-----|------|-------------|
| `zap_rules` | `Record<domain, string[]>` | CSS selectors to hide |
| `zap_paused` | `Record<domain, boolean>` | Paused domains |
| `zap_keybinds` | `Record<domain, Array<{key, selector, label}>>` | Key→element mappings |
| `zap_auto_config` | `Record<domain, {speed, nextKey, waitMs, enabled, autoShortcut}>` | Auto-scroll settings per domain |
| `zap_reading_history` | `Record<slug, {series, chapterNumber, chapterLabel, domain, url, timestamp}>` | Reading progress tracker |

---

## 📤 Export / Import

- **Export** downloads a `.json` file with all rules, paused state, keybinds, and auto-config
- **Import** merges into existing data (shows confirmation first)

---

## 🌐 Browser support

| Browser | Status |
|---------|--------|
| Chrome 88+ | ✅ Full support |
| Edge 88+ | ✅ Full support |
| Brave | ✅ Full support |
| Opera | ✅ Full support |
| Firefox | ⚠️ MV3 only (MV2 not implemented) |

---

## 📝 License

MIT — do whatever you want. PRs welcome!

---

## 🔗 Links

- [GitHub Repository](https://github.com/Pleniluni0/zap-and-key)
- [Report an issue](https://github.com/Pleniluni0/zap-and-key/issues)
