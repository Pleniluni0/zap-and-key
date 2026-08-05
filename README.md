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

```
┌──────────────────────────────────┐
│       ⚡ Zap & Key ⌨️            │
│                                  │
│  [⚡ Zap Mode]  [⌨️ Key Bind]   │
│                                  │
│  🗑️ Elementos Bloqueados        │
│  ▸ example.com (5 guardados /     │
│    3 activos)  [⏸️] [🗑️]       │
│                                  │
│  ⌨️ Atajos de Tecla             │
│  ▸ example.com (2 atajos)        │
│    [→] Botón: Siguiente   [✕]   │
│    [↵] Botón: Enviar      [✕]   │
│                                  │
│  🤖 Modo Automático             │
│  Velocidad: [🐢🐌🚶🚀💨]        │
│  Espera (s): [2] [Atajo: ...]   │
│  Tecla Sig.: [→ → Siguiente]    │
│  [▶ Iniciar]  [■ Parar]         │
│                                  │
│  [📤 Exportar] [📥 Importar]    │
└──────────────────────────────────┘
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
```

---

## 🛠️ Storage keys

| Key | Type | Description |
|-----|------|-------------|
| `zap_rules` | `Record<domain, string[]>` | CSS selectors to hide |
| `zap_paused` | `Record<domain, boolean>` | Paused domains |
| `zap_keybinds` | `Record<domain, Array<{key, selector, label}>>` | Key→element mappings |
| `zap_auto_config` | `Record<domain, {speed, nextKey, waitMs, enabled, autoShortcut}>` | Auto-scroll settings per domain |

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
