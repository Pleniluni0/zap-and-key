# ⚡ Zap & Key ⌨️

**Browser extension to zap annoying elements and bind keyboard shortcuts to buttons — with per-domain persistence.**

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
│  ▸ otro.com (2 guardados /       │
│    2 activos)  [▶️] [🗑️]       │
│                                  │
│  ⌨️ Atajos de Tecla             │
│  ▸ example.com (2 atajos)        │
│    [→] Botón: Siguiente   [🗑️]  │
│    [↵] Botón: Enviar      [🗑️]  │
│                                  │
│  [📤 Exportar] [📥 Importar]    │
└──────────────────────────────────┘
```

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+X` | Toggle Zap Mode |
| `Escape` | Cancel any active mode |
| *Your custom keys* | Trigger assigned buttons (per domain) |

---

## 🧱 Architecture

```
zap-and-key/
├── manifest.json          # MV3 manifest
├── src/
│   ├── content.js         # Main engine (zap, keybinds, observer, overlay)
│   └── background.js      # Service worker (Alt+X shortcut)
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic (CRUD rules, keybinds, export/import)
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
```

---

## 🛠️ Storage keys

| Key | Type | Description |
|-----|------|-------------|
| `zap_rules` | `Record<domain, string[]>` | CSS selectors to hide |
| `zap_paused` | `Record<domain, boolean>` | Paused domains |
| `zap_keybinds` | `Record<domain, Array<{key, selector, label}>>` | Key→element mappings |

---

## 📤 Export / Import

- **Export** downloads a `.json` file with all rules, paused state, and keybinds
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
