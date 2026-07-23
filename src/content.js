console.log("Zap & Key content script loaded");

// ============ STATE ============
let isZapMode = false;
let isKeybindMode = false;
let hoveredElement = null;
let lastZappedSelector = null;
let lastZappedElement = null;
let undoTimeout = null;
let _pausedCache = false;
let _keybindsCache = {};       // hostname → [{selector, key, label}]
let _capturingKeybind = false; // true while the "press a key" overlay is open
let _keydownHandlerBound = null;

// ============ MUTATION OBSERVER (SPA resilience) ============
const domObserver = new MutationObserver(() => {
    if (!document.getElementById('zap-element-styles') && !_pausedCache) {
        loadRules();
    }
});
domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
});

// ============ MESSAGE HANDLERS ============
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        // ── Zap mode ──
        case "toggleZap":
            if (isKeybindMode) exitKeybindMode();
            if (typeof request.value !== 'undefined') {
                isZapMode = request.value;
            } else {
                isZapMode = !isZapMode;
            }
            if (isZapMode) {
                enableZapListeners();
            } else {
                disableZapListeners();
            }
            sendResponse({
                status: "Zap Mode " + (isZapMode ? "ON" : "OFF"),
                zapMode: isZapMode,
                keybindMode: isKeybindMode
            });
            break;

        // ── Keybind mode ──
        case "toggleKeybind":
            if (isZapMode) {
                disableZapListeners();
                isZapMode = false;
            }
            if (typeof request.value !== 'undefined') {
                isKeybindMode = request.value;
            } else {
                isKeybindMode = !isKeybindMode;
            }
            if (isKeybindMode) {
                enterKeybindMode();
            } else {
                exitKeybindMode();
            }
            sendResponse({
                status: "Keybind Mode " + (isKeybindMode ? "ON" : "OFF"),
                zapMode: isZapMode,
                keybindMode: isKeybindMode
            });
            break;

        // ── Status ──
        case "getStatus":
            sendResponse({
                zapMode: isZapMode,
                keybindMode: isKeybindMode,
                paused: _pausedCache
            });
            break;

        // ── Active count (zapped elements) ──
        case "getActiveCount":
            sendResponse({
                count: countActiveRules()
            });
            break;

        // ── Pause / unpause domain ──
        case "pauseDomain":
            togglePauseStore(request.hostname, request.paused);
            sendResponse({ success: true });
            break;

        // ── Undo ──
        case "undoLastZap":
            undoLastZap();
            sendResponse({ success: true });
            break;

        // ── Keybind CRUD (called from popup) ──
        case "deleteKeybind":
            deleteKeybindFromStore(request.hostname, request.index);
            sendResponse({ success: true });
            break;
    }
    return true;
});

// ============ ZAP MODE LISTENERS ============
function enableZapListeners() {
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    updateModeUI("zap", true);
}

function disableZapListeners() {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    if (hoveredElement) {
        hoveredElement.style.outline = "";
        hoveredElement = null;
    }
    updateModeUI("zap", false);
}

// ============ KEYBIND MODE ============
function enterKeybindMode() {
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("click", onKeybindClick, true);
    document.addEventListener("keydown", onKeybindModeKeyDown, true);
    updateModeUI("keybind", true);
}

function exitKeybindMode() {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("click", onKeybindClick, true);
    document.removeEventListener("keydown", onKeybindModeKeyDown, true);
    if (hoveredElement) {
        hoveredElement.style.outline = "";
        hoveredElement = null;
    }
    hideKeybindPrompt();
    updateModeUI("keybind", false);
}

function onKeybindModeKeyDown(e) {
    if (e.key === "Escape" && !_capturingKeybind) {
        e.preventDefault();
        e.stopPropagation();
        isKeybindMode = false;
        exitKeybindMode();
        console.log("Zap & Key: Keybind mode cancelled via Escape");
    }
}

// ============ SHARED MOUSE HANDLERS (both modes) ============
function onMouseOver(e) {
    if (!isZapMode && !isKeybindMode) return;
    const outlineColor = isKeybindMode ? "#3498db" : "#ff0000";
    e.target.style.outline = `2px solid ${outlineColor}`;
    hoveredElement = e.target;
}

function onMouseOut(e) {
    if (!isZapMode && !isKeybindMode) return;
    e.target.style.outline = "";
}

function onKeyDown(e) {
    if (e.key === "Escape" && !_capturingKeybind) {
        e.preventDefault();
        e.stopPropagation();
        isZapMode = false;
        disableZapListeners();
        console.log("Zap & Key: Zap mode cancelled via Escape");
    }
}

// ============ MODE UI (badge + cursor) ============
function updateModeUI(mode, active) {
    const styleId = 'zap-cursor-style';
    const badgeId = 'zap-badge';

    if (active) {
        // Remove any existing style/badge so we build fresh
        const oldStyle = document.getElementById(styleId);
        if (oldStyle) oldStyle.remove();
        const oldBadge = document.getElementById(badgeId);
        if (oldBadge) oldBadge.remove();

        const isKeybind = mode === "keybind";
        const cursor = "crosshair";
        const bg = isKeybind ? "#2980b9" : "#ff0000";
        const label = isKeybind ? "KEY BIND MODE ON (ESC to exit)" : "ZAP MODE ON (ESC to exit)";

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            * { cursor: ${cursor} !important; }
            #${badgeId} {
                position: fixed;
                top: 10px;
                right: 10px;
                background: ${bg};
                color: #ffffff;
                padding: 8px 12px;
                z-index: 2147483647;
                font-family: sans-serif;
                font-size: 14px;
                font-weight: bold;
                pointer-events: none;
                border-radius: 4px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
        `;
        document.head.appendChild(style);

        const badge = document.createElement('div');
        badge.id = badgeId;
        badge.innerText = label;
        document.body.appendChild(badge);
    } else {
        const style = document.getElementById(styleId);
        if (style) style.remove();
        const badge = document.getElementById(badgeId);
        if (badge) badge.remove();
    }
}

// ============ ZAP CLICK HANDLER ============
function onClick(e) {
    if (!isZapMode) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target;

    const selector = generateSelector(target);
    console.log("Zap & Key: Selector generated:", selector);

    saveRule(selector);

    lastZappedSelector = selector;
    lastZappedElement = target;

    target.style.setProperty('display', 'none', 'important');

    showUndoToast(selector);

    target.style.outline = "";
    isZapMode = false;
    disableZapListeners();
}

// ============ KEYBIND CLICK HANDLER ============
function onKeybindClick(e) {
    if (!isKeybindMode) return;
    if (_capturingKeybind) return; // already showing the prompt

    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    const selector = generateSelector(target);
    const label = elementLabel(target);

    console.log("Zap & Key: Keybind target:", selector, "label:", label);

    // Temporarily suppress escape-to-cancel so it doesn't close the prompt
    showKeybindPrompt(selector, label, target);

    target.style.outline = "";
}

// ============ KEYBIND PROMPT OVERLAY ============
function showKeybindPrompt(selector, label, element) {
    hideKeybindPrompt();
    _capturingKeybind = true;

    const overlay = document.createElement('div');
    overlay.id = 'zap-keybind-overlay';
    overlay.innerHTML = `
        <div style="
            background: #2c3e50;
            color: #fff;
            padding: 28px 32px;
            border-radius: 12px;
            text-align: center;
            font-family: sans-serif;
            box-shadow: 0 8px 30px rgba(0,0,0,0.4);
            min-width: 300px;
        ">
            <div style="font-size: 16px; margin-bottom: 6px;">Pulse una tecla para asignar</div>
            <div style="font-size: 22px; margin-bottom: 4px; font-weight: bold;">⌨️</div>
            <div style="
                font-size: 12px;
                color: #bdc3c7;
                margin-bottom: 12px;
                max-width: 280px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            " title="${escapeAttr(selector)}">${escapeHtml(label)}</div>
            <div id="zap-keybind-key-hint" style="
                font-size: 14px;
                color: #3498db;
                min-height: 20px;
                margin-bottom: 12px;
            ">Esperando tecla…</div>
            <button id="zap-keybind-cancel" style="
                background: #7f8c8d;
                color: #fff;
                border: none;
                padding: 8px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: bold;
            ">Cancelar</button>
        </div>
    `;

    Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0,0,0,0.55)',
        zIndex: '2147483647',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    });

    // Click outside → cancel
    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
            hideKeybindPrompt();
            isKeybindMode = false;
            exitKeybindMode();
        }
    });

    // Cancel button
    overlay.querySelector('#zap-keybind-cancel').addEventListener('click', () => {
        hideKeybindPrompt();
        isKeybindMode = false;
        exitKeybindMode();
    });

    // Capture next keydown
    function onCaptureKeydown(ev) {
        ev.preventDefault();
        ev.stopPropagation();

        const key = ev.key;

        // Ignore modifier-only presses
        if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return;

        const hint = document.getElementById('zap-keybind-key-hint');
        if (hint) {
            hint.textContent = `✔ ${formatKeyDisplay(key)}`;
            hint.style.color = '#2ecc71';
        }

        document.removeEventListener('keydown', onCaptureKeydown, true);

        // Save the keybind
        const hostname = window.location.hostname;
        saveKeybind(hostname, selector, key, label, element);

        // Small delay so the user sees the confirmation
        setTimeout(() => {
            hideKeybindPrompt();
            isKeybindMode = false;
            exitKeybindMode();
            _capturingKeybind = false;
        }, 600);
    }

    document.addEventListener('keydown', onCaptureKeydown, true);
    overlay._captureHandler = onCaptureKeydown;
    document.body.appendChild(overlay);
}

function hideKeybindPrompt() {
    const overlay = document.getElementById('zap-keybind-overlay');
    if (overlay) {
        if (overlay._captureHandler) {
            document.removeEventListener('keydown', overlay._captureHandler, true);
        }
        overlay.remove();
    }
    _capturingKeybind = false;
}

function elementLabel(el) {
    const tag = el.nodeName.toLowerCase();
    const text = (el.textContent || '').trim().slice(0, 40);

    if (tag === 'button') return `Botón: ${text || '(sin texto)'}`;
    if (tag === 'a') return `Enlace: ${text || '(sin texto)'}`;
    if (tag === 'input') {
        const type = el.getAttribute('type') || 'text';
        const val = el.getAttribute('value') || el.getAttribute('placeholder') || '';
        return `Input[${type}]: ${val.slice(0, 30) || '(sin valor)'}`;
    }
    if (tag === 'select') return `Select: ${el.getAttribute('name') || '(sin nombre)'}`;
    if (tag === 'textarea') return `Textarea: ${el.getAttribute('name') || '(sin nombre)'}`;

    // Generic: tag + class hint
    const cls = el.className && typeof el.className === 'string'
        ? el.className.trim().split(/\s+/)[0]
        : '';
    return `${tag}${cls ? '.' + cls : ''}: ${text || '(sin texto)'}`;
}

function formatKeyDisplay(key) {
    const map = {
        'ArrowRight': '→',
        'ArrowLeft': '←',
        'ArrowUp': '↑',
        'ArrowDown': '↓',
        'Enter': '↵ Enter',
        ' ': 'Space',
        'Escape': 'Esc',
        'Backspace': '⌫',
        'Delete': '⌦',
        'Tab': '↹ Tab',
        'PageUp': 'PgUp',
        'PageDown': 'PgDn',
        'Home': 'Home',
        'End': 'End',
        'Insert': 'Ins',
        'CapsLock': 'Caps',
        'NumLock': 'NumLk',
        'ScrollLock': 'ScrLk',
    };
    if (map[key]) return map[key];
    if (key.startsWith('F') && /^F\d{1,2}$/.test(key)) return key;
    if (key.length === 1) return key.toUpperCase();
    return key;
}

// ============ KEYBIND PERSISTENCE ============
function saveKeybind(hostname, selector, key, label, element) {
    chrome.storage.local.get(['zap_keybinds'], (result) => {
        const allBinds = result.zap_keybinds || {};
        const domainBinds = allBinds[hostname] || [];

        // Overwrite if same key already exists for this domain
        const existingIdx = domainBinds.findIndex(b => b.key === key);

        const newBind = { selector, key, label };

        if (existingIdx !== -1) {
            domainBinds[existingIdx] = newBind;
        } else {
            domainBinds.push(newBind);
        }

        allBinds[hostname] = domainBinds;
        chrome.storage.local.set({ zap_keybinds: allBinds }, () => {
            console.log("Zap & Key: Keybind saved:", formatKeyDisplay(key), "→", selector);
            _keybindsCache[hostname] = domainBinds;
            setupKeybindListener();

            // Show brief toast
            showKeybindToast(formatKeyDisplay(key), label);
        });
    });
}

function deleteKeybindFromStore(hostname, index) {
    chrome.storage.local.get(['zap_keybinds'], (result) => {
        const allBinds = result.zap_keybinds || {};
        const domainBinds = allBinds[hostname] || [];
        domainBinds.splice(index, 1);

        if (domainBinds.length === 0) {
            delete allBinds[hostname];
        } else {
            allBinds[hostname] = domainBinds;
        }

        chrome.storage.local.set({ zap_keybinds: allBinds }, () => {
            _keybindsCache[hostname] = domainBinds;
            setupKeybindListener();
        });
    });
}

function showKeybindToast(keyDisplay, label) {
    const existing = document.getElementById('zap-keybind-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'zap-keybind-toast';
    toast.innerHTML = `<span>⌨️ <strong>${keyDisplay}</strong> asignado a «${escapeHtml(label)}»</span>`;

    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#2980b9',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '8px',
        zIndex: '2147483647',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        animation: 'zap-fade-in 0.2s ease-out'
    });

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'zap-fade-out 0.2s ease-out';
        setTimeout(() => toast.remove(), 200);
    }, 3500);
}

// ============ KEYBIND KEYDOWN LISTENER (active on pages with binds) ============
function setupKeybindListener() {
    const hostname = window.location.hostname;
    const binds = _keybindsCache[hostname] || [];

    // Remove old listener if any
    removeKeybindListener();

    if (binds.length === 0) return;

    _keydownHandlerBound = handleKeybindKeydown;
    document.addEventListener('keydown', _keydownHandlerBound, true);
    console.log(`Zap & Key: ${binds.length} keybind(s) active on ${hostname}`);
}

function removeKeybindListener() {
    if (_keydownHandlerBound) {
        document.removeEventListener('keydown', _keydownHandlerBound, true);
        _keydownHandlerBound = null;
    }
}

function handleKeybindKeydown(e) {
    // Skip if the keybind prompt overlay is visible
    if (_capturingKeybind) return;

    // Skip if user is typing in an input/textarea/contenteditable
    if (document.activeElement) {
        const tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
            document.activeElement.isContentEditable) {
            return;
        }
    }

    // Skip if a modifier is held (avoid conflicts with browser/OS shortcuts)
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const hostname = window.location.hostname;
    const binds = _keybindsCache[hostname] || [];
    if (binds.length === 0) return;

    for (const bind of binds) {
        if (bind.key === e.key) {
            try {
                const el = document.querySelector(bind.selector);
                if (el) {
                    e.preventDefault();
                    e.stopPropagation();

                    // Visual feedback: brief blue glow
                    const prevOutline = el.style.outline;
                    const prevTransition = el.style.transition;
                    el.style.transition = 'outline 0.15s';
                    el.style.outline = '3px solid #3498db';
                    setTimeout(() => {
                        el.style.outline = prevOutline;
                        el.style.transition = prevTransition;
                    }, 300);

                    el.click();
                    console.log(`Zap & Key: ${formatKeyDisplay(e.key)} → clicked`, bind.selector);
                    return; // only trigger first match
                }
            } catch (_) { /* selector invalid — skip */ }
        }
    }
}

// ============ LOAD KEYBINDS ============
function loadKeybinds() {
    const hostname = window.location.hostname;
    chrome.storage.local.get(['zap_keybinds'], (result) => {
        const allBinds = result.zap_keybinds || {};
        _keybindsCache[hostname] = allBinds[hostname] || [];
        setupKeybindListener();
    });
}

// ============ UNDO TOAST ============
function showUndoToast(selector) {
    const existing = document.getElementById('zap-undo-toast');
    if (existing) existing.remove();
    if (undoTimeout) clearTimeout(undoTimeout);

    const toast = document.createElement('div');
    toast.id = 'zap-undo-toast';
    toast.innerHTML = `
        <span style="flex:1">Elemento eliminado</span>
        <button id="zap-undo-btn">Deshacer</button>
    `;
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#2c3e50',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '8px',
        zIndex: '2147483647',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        minWidth: '280px'
    });

    const undoBtn = toast.querySelector('#zap-undo-btn');
    Object.assign(undoBtn.style, {
        background: '#e74c3c',
        color: '#fff',
        border: 'none',
        padding: '6px 14px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '13px',
        flexShrink: '0'
    });
    undoBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        undoLastZap();
        toast.remove();
        if (undoTimeout) clearTimeout(undoTimeout);
    });
    undoBtn.addEventListener('mouseenter', () => {
        undoBtn.style.background = '#c0392b';
    });
    undoBtn.addEventListener('mouseleave', () => {
        undoBtn.style.background = '#e74c3c';
    });

    if (!document.getElementById('zap-toast-keyframes')) {
        const kf = document.createElement('style');
        kf.id = 'zap-toast-keyframes';
        kf.textContent = `
            @keyframes zap-fade-in {
                from { opacity: 0; transform: translateX(-50%) translateY(10px); }
                to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes zap-fade-out {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to   { opacity: 0; transform: translateX(-50%) translateY(10px); }
            }
        `;
        document.head.appendChild(kf);
    }
    toast.style.animation = 'zap-fade-in 0.2s ease-out';

    document.body.appendChild(toast);

    undoTimeout = setTimeout(() => {
        toast.style.animation = 'zap-fade-out 0.2s ease-out';
        setTimeout(() => {
            toast.remove();
            lastZappedSelector = null;
            lastZappedElement = null;
        }, 200);
    }, 5000);
}

function undoLastZap() {
    if (!lastZappedSelector) return;

    const hostname = window.location.hostname;
    chrome.storage.local.get([hostname], (result) => {
        const rules = result[hostname] || [];
        const idx = rules.indexOf(lastZappedSelector);
        if (idx !== -1) {
            rules.splice(idx, 1);
            if (rules.length === 0) {
                chrome.storage.local.remove(hostname, () => {
                    applyRules([]);
                });
            } else {
                chrome.storage.local.set({ [hostname]: rules }, () => {
                    applyRules(rules);
                });
            }
        }

        if (lastZappedElement && lastZappedElement.style) {
            lastZappedElement.style.removeProperty('display');
        }

        lastZappedSelector = null;
        lastZappedElement = null;
        console.log("Zap & Key: Undo successful");
    });
}

// ============ PAUSE / UNPAUSE ============
function togglePauseStore(hostname, paused) {
    chrome.storage.local.get(['zap_paused'], (result) => {
        const pausedObj = result.zap_paused || {};
        if (paused) {
            pausedObj[hostname] = true;
        } else {
            delete pausedObj[hostname];
        }
        chrome.storage.local.set({ zap_paused: pausedObj }, () => {
            _pausedCache = paused;
            if (paused) {
                const style = document.getElementById('zap-element-styles');
                if (style) style.remove();
            } else {
                loadRules();
            }
        });
    });
}

// ============ ZAP PERSISTENCE ============
function loadRules() {
    const hostname = window.location.hostname;
    chrome.storage.local.get([hostname, 'zap_paused'], (result) => {
        const paused = result.zap_paused || {};
        _pausedCache = !!paused[hostname];

        if (_pausedCache) {
            const style = document.getElementById('zap-element-styles');
            if (style) style.remove();
            return;
        }

        const rules = result[hostname] || [];
        applyRules(rules);
    });
}

function applyRules(rules) {
    if (_pausedCache) {
        const style = document.getElementById('zap-element-styles');
        if (style) style.remove();
        return;
    }

    let style = document.getElementById('zap-element-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'zap-element-styles';
        document.head.appendChild(style);
    }

    const css = rules.map(r => `${r} { display: none !important; }`).join('\n');
    style.textContent = css;
    console.log(`Zap & Key: ${rules.length} zap rules applied.`);
}

function saveRule(selector) {
    const hostname = window.location.hostname;
    chrome.storage.local.get([hostname], (result) => {
        const rules = result[hostname] || [];

        if (!rules.includes(selector)) {
            rules.push(selector);
            chrome.storage.local.set({ [hostname]: rules }, () => {
                console.log("Zap & Key: Rule saved.");
                applyRules(rules);
            });
        }
    });
}

function countActiveRules() {
    const style = document.getElementById('zap-element-styles');
    if (!style || !style.textContent) return 0;

    const rules = style.textContent.split('\n').filter(line => line.trim());
    let count = 0;
    for (const rule of rules) {
        const selector = rule.replace(/\s*\{\s*display:\s*none\s*!important\s*;\s*\}\s*$/, '').trim();
        if (!selector) continue;
        try {
            count += document.querySelectorAll(selector).length;
        } catch (_) { /* invalid selector — skip */ }
    }
    return count;
}

// ============ SELECTOR GENERATOR (with Shadow DOM awareness + stable attrs) ============
function generateSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

    if (el.nodeName.toLowerCase() === 'body') return 'body';
    if (el.nodeName.toLowerCase() === 'html') return 'html';

    const root = el.getRootNode();
    if (root && root !== document && root instanceof ShadowRoot) {
        console.warn(
            "Zap & Key: Element is inside a Shadow DOM. " +
            "CSS injection / keybind may not reach it. Trying best-effort selector."
        );
    }

    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        return '#' + CSS.escape(el.id);
    }

    const path = [];
    let current = el;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
        let segment = current.nodeName.toLowerCase();

        if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
            path.unshift('#' + CSS.escape(current.id));
            break;
        }

        if (current.hasAttribute('data-testid')) {
            segment += `[data-testid="${CSS.escape(current.getAttribute('data-testid'))}"]`;
            path.unshift(segment);
            current = current.parentElement;
            if (current && current.nodeName.toLowerCase() === 'html') break;
            continue;
        }
        if (current.hasAttribute('data-cy')) {
            segment += `[data-cy="${CSS.escape(current.getAttribute('data-cy'))}"]`;
            path.unshift(segment);
            current = current.parentElement;
            if (current && current.nodeName.toLowerCase() === 'html') break;
            continue;
        }

        if (current.hasAttribute('aria-label')) {
            segment += `[aria-label="${CSS.escape(current.getAttribute('aria-label'))}"]`;
        }

        if (current.classList.length > 0) {
            const stable = Array.from(current.classList).filter(c =>
                !/^\d/.test(c) && !/^[a-f0-9]{5,}$/i.test(c)
            );
            if (stable.length > 0) {
                segment += '.' + stable.slice(0, 2).map(c => CSS.escape(c)).join('.');
            }
        }

        let sibling = current, nth = 1;
        while ((sibling = sibling.previousElementSibling)) {
            if (sibling.nodeName.toLowerCase() === current.nodeName.toLowerCase()) nth++;
        }
        if (nth > 1) {
            segment += `:nth-of-type(${nth})`;
        }

        path.unshift(segment);
        current = current.parentElement;

        if (current && current.nodeName.toLowerCase() === 'html') break;
    }

    return path.join(" > ");
}

// ============ UTILS ============
function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============ STORAGE CHANGE LISTENER ============
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    // Zap rules
    if (changes[window.location.hostname]) {
        applyRules(changes[window.location.hostname].newValue || []);
    }

    // Paused state
    if (changes['zap_paused']) {
        const paused = changes['zap_paused'].newValue || {};
        _pausedCache = !!paused[window.location.hostname];
        if (_pausedCache) {
            const style = document.getElementById('zap-element-styles');
            if (style) style.remove();
        } else {
            loadRules();
        }
    }

    // Keybinds
    if (changes['zap_keybinds']) {
        const allBinds = changes['zap_keybinds'].newValue || {};
        _keybindsCache[window.location.hostname] = allBinds[window.location.hostname] || [];
        setupKeybindListener();
    }
});

// ============ INIT ============
loadRules();
loadKeybinds();
