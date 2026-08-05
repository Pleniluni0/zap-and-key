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

// ── Auto-scroll state ──
let _autoScrollActive = false;
let _autoScrollRafId = null;
let _autoConfig = {};  // hostname → { speed, nextKey, waitMs, enabled }
let _autoScrollAtBottom = false;
let _autoScrollBottomTimer = null;
let _autoScrollCountdownInterval = null;

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

        // ── Auto-scroll ──
        case "startAutoScroll":
            startAutoScroll(request.speed, request.nextKey, request.waitMs, request.saveConfig);
            sendResponse({ success: true, active: _autoScrollActive });
            break;

        case "stopAutoScroll":
            stopAutoScroll(request.saveConfig);
            sendResponse({ success: true, active: _autoScrollActive });
            break;

        case "toggleAutoScroll":
            toggleAutoScroll();
            sendResponse({ success: true, active: _autoScrollActive });
            break;

        case "getAutoStatus":
            sendResponse({
                active: _autoScrollActive,
                config: _autoConfig[window.location.hostname] || null
            });
            break;

        case "refreshAutoShortcut":
            loadAutoConfig();
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
    const outlineColor = isKeybindMode ? "#2c3e50" : "#ff0000";
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
        const bg = isKeybind ? "#2c3e50" : "#ff0000";
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

    const slot = _acquireToastSlot('zap-keybind-toast');
    const topOffset = 20 + slot * 56;

    const toast = document.createElement('div');
    toast.id = 'zap-keybind-toast';
    toast.innerHTML = `<span>⌨️ <strong>${keyDisplay}</strong> asignado a «${escapeHtml(label)}»</span>`;

    Object.assign(toast.style, {
        position: 'fixed',
        top: topOffset + 'px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#2c3e50',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '8px',
        zIndex: '2147483647',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        animation: 'zap-fade-in-top 0.2s ease-out'
    });

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'zap-fade-out-top 0.2s ease-out';
        setTimeout(() => {
            toast.remove();
            _releaseToastSlot('zap-keybind-toast');
        }, 200);
    }, 3500);
}

function showKeybindActivationToast(keyDisplay, label) {
    const id = 'zap-activation-toast';
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const slot = _acquireToastSlot(id);
    const topOffset = 20 + slot * 56;

    const toast = document.createElement('div');
    toast.id = id;
    toast.innerHTML = `<span>⚡ <strong>${keyDisplay}</strong> → ${escapeHtml(label)}</span>`;

    Object.assign(toast.style, {
        position: 'fixed',
        top: topOffset + 'px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#2c3e50',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '8px',
        zIndex: '2147483647',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        animation: 'zap-fade-in-top 0.2s ease-out'
    });

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'zap-fade-out-top 0.2s ease-out';
        setTimeout(() => {
            toast.remove();
            _releaseToastSlot(id);
        }, 200);
    }, 2000);
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

                    // Show activation toast
                    showKeybindActivationToast(formatKeyDisplay(e.key), bind.label);

                    // Visual feedback: brief blue glow
                    const prevOutline = el.style.outline;
                    const prevTransition = el.style.transition;
                    el.style.transition = 'outline 0.15s';
                    el.style.outline = '3px solid #2c3e50';
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

// ============ TOAST STACKING ============
let _toastSlots = []; // tracks active toast IDs, index = vertical slot

function _acquireToastSlot(id) {
    // Remove from any existing slot first
    _releaseToastSlot(id);
    _toastSlots.push(id);
    return _toastSlots.length - 1; // 0 = topmost
}

function _releaseToastSlot(id) {
    const idx = _toastSlots.indexOf(id);
    if (idx !== -1) _toastSlots.splice(idx, 1);
}

// ============ UNDO TOAST ============
function showUndoToast(selector) {
    const existing = document.getElementById('zap-undo-toast');
    if (existing) existing.remove();
    if (undoTimeout) clearTimeout(undoTimeout);

    const slot = _acquireToastSlot('zap-undo-toast');
    const topOffset = 20 + slot * 56; // stack vertically

    const toast = document.createElement('div');
    toast.id = 'zap-undo-toast';
    toast.innerHTML = `
        <span style="flex:1">Elemento eliminado</span>
        <button id="zap-undo-btn">Deshacer</button>
    `;
    Object.assign(toast.style, {
        position: 'fixed',
        top: topOffset + 'px',
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
        _releaseToastSlot('zap-undo-toast');
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
                from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes zap-fade-out {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to   { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            }
            @keyframes zap-fade-in-top {
                from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes zap-fade-out-top {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to   { opacity: 0; transform: translateX(-50%) translateY(-10px); }
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
            _releaseToastSlot('zap-undo-toast');
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

// ============ AUTO-SCROLL ENGINE ============
const AUTO_SPEEDS = {
    slow: 0.8,       // px per frame (~50 px/s at 60fps)
    slowMedium: 1.4,  // ~85 px/s
    medium: 2,        // ~120 px/s
    mediumFast: 3,    // ~180 px/s
    fast: 4           // ~240 px/s
};

function loadAutoConfig() {
    const hostname = window.location.hostname;
    chrome.storage.local.get(['zap_auto_config'], (result) => {
        _autoConfig = result.zap_auto_config || {};
        const domainConfig = _autoConfig[hostname];
        setupAutoShortcutListener();
        if (domainConfig && domainConfig.enabled) {
            console.log('Zap & Key: Auto-scroll resuming for', hostname);
            startAutoScroll(domainConfig.speed, domainConfig.nextKey, domainConfig.waitMs, false);
        }
        // Track reading history on page load (with or without auto-scroll)
        trackCurrentPage();
    });
}

function saveAutoConfig(hostname, config) {
    _autoConfig[hostname] = { ...(_autoConfig[hostname] || {}), ...config };
    chrome.storage.local.set({ zap_auto_config: _autoConfig }, () => {
        setupAutoShortcutListener();
    });
}

function startAutoScroll(speed, nextKey, waitMs, saveConfig) {
    const hostname = window.location.hostname;

    if (_autoScrollActive) stopAutoScroll(false);

    const pxPerFrame = AUTO_SPEEDS[speed] || AUTO_SPEEDS.medium;
    const wait = (typeof waitMs === 'number' && waitMs >= 500) ? waitMs : 2000;

    _autoScrollActive = true;
    _autoScrollAtBottom = false;

    if (saveConfig !== false) {
        saveAutoConfig(hostname, { speed, nextKey, waitMs, enabled: true });
    }

    updateAutoBadge(true);

    function scrollStep() {
        if (!_autoScrollActive) return;

        const before = window.scrollY;
        window.scrollBy(0, pxPerFrame);
        const after = window.scrollY;

        // Detect if we reached the bottom (scroll didn't move, or we're at bottom)
        const atBottom =
            (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 5) ||
            (before === after && window.scrollY > 0);

        if (atBottom && !_autoScrollAtBottom) {
            _autoScrollAtBottom = true;
            onAutoScrollReachBottom(nextKey, wait);
            return; // Stop the RAF loop; will be restarted after navigation or if bottom resolves
        }

        if (!atBottom) {
            _autoScrollAtBottom = false;
            if (_autoScrollBottomTimer) {
                clearTimeout(_autoScrollBottomTimer);
                _autoScrollBottomTimer = null;
            }
            if (_autoScrollCountdownInterval) {
                clearInterval(_autoScrollCountdownInterval);
                _autoScrollCountdownInterval = null;
                updateAutoBadge(true); // restore normal badge
            }
        }

        _autoScrollRafId = requestAnimationFrame(scrollStep);
    }

    _autoScrollRafId = requestAnimationFrame(scrollStep);
    console.log(`Zap & Key: Auto-scroll started (${speed}, nextKey=${nextKey}, wait=${wait}ms)`);
}

function stopAutoScroll(saveConfig) {
    _autoScrollActive = false;

    if (_autoScrollRafId) {
        cancelAnimationFrame(_autoScrollRafId);
        _autoScrollRafId = null;
    }

    if (_autoScrollBottomTimer) {
        clearTimeout(_autoScrollBottomTimer);
        _autoScrollBottomTimer = null;
    }

    if (_autoScrollCountdownInterval) {
        clearInterval(_autoScrollCountdownInterval);
        _autoScrollCountdownInterval = null;
    }

    _autoScrollAtBottom = false;

    updateAutoBadge(false);

    if (saveConfig !== false) {
        const hostname = window.location.hostname;
        if (_autoConfig[hostname]) {
            _autoConfig[hostname].enabled = false;
            chrome.storage.local.set({ zap_auto_config: _autoConfig });
        }
    }

    console.log('Zap & Key: Auto-scroll stopped');
}

function toggleAutoScroll() {
    if (_autoScrollActive) {
        stopAutoScroll(true);
    } else {
        const hostname = window.location.hostname;
        const config = _autoConfig[hostname];
        if (config) {
            startAutoScroll(config.speed, config.nextKey, config.waitMs, true);
        } else {
            // Fallback: use defaults (no keybind needed for just scrolling)
            startAutoScroll('medium', null, 2000, true);
        }
    }
}

function onAutoScrollReachBottom(nextKey, waitMs) {
    console.log(`Zap & Key: Bottom reached, waiting ${waitMs}ms...`);

    const totalSeconds = Math.ceil(waitMs / 1000);
    let remaining = totalSeconds;

    // Show initial countdown on badge
    updateAutoBadgeCountdown(remaining);

    _autoScrollCountdownInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(_autoScrollCountdownInterval);
            _autoScrollCountdownInterval = null;

            if (!_autoScrollActive) return;

            if (nextKey) {
                // Simulate the keybind — find and click the element directly
                const hostname = window.location.hostname;
                const binds = _keybindsCache[hostname] || [];
                const bind = binds.find(b => b.key === nextKey);

                if (bind) {
                    try {
                        const el = document.querySelector(bind.selector);
                        if (el) {
                            console.log(`Zap & Key: Auto-scroll triggering next: ${nextKey} → ${bind.selector}`);
                            el.click();
                            // Auto-scroll will resume on the next page via loadAutoConfig()
                            return;
                        }
                    } catch (_) { /* selector invalid */ }
                }
                console.warn(`Zap & Key: Auto-scroll next key "${nextKey}" not found in keybinds`);
            }

            // If we're still on the same page (no navigation happened), restart scroll
            _autoScrollAtBottom = false;
            _autoScrollBottomTimer = null;
            updateAutoBadge(true); // restore normal badge
        } else {
            updateAutoBadgeCountdown(remaining);
        }
    }, 1000);
}

function updateAutoBadge(active) {
    const badgeId = 'zap-auto-badge';

    if (active) {
        const existing = document.getElementById(badgeId);
        if (existing) {
            existing.innerHTML = '⏸';
            existing.title = 'Parar Auto-Scroll';
            existing.style.fontSize = '16px';
            existing.style.fontWeight = 'normal';
            existing.style.background = '#8e44ad';
            existing.style.animation = '';
            return;
        }

        const badge = document.createElement('div');
        badge.id = badgeId;
        badge.innerHTML = '⏸';
        badge.title = 'Parar Auto-Scroll';

        Object.assign(badge.style, {
            position: 'fixed',
            bottom: '12px',
            left: '12px',
            width: '34px',
            height: '34px',
            background: '#8e44ad',
            color: '#ffffff',
            zIndex: '2147483646',
            fontFamily: 'sans-serif',
            fontSize: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderRadius: '50%',
            boxShadow: '0 4px 8px rgba(0,0,0,0.35)',
            opacity: '0.8',
            transition: 'opacity 0.2s, transform 0.2s',
            pointerEvents: 'auto',
            userSelect: 'none',
            lineHeight: '1'
        });

        badge.addEventListener('mouseenter', () => {
            badge.style.opacity = '1';
            badge.style.transform = 'scale(1.12)';
        });
        badge.addEventListener('mouseleave', () => {
            badge.style.opacity = '0.8';
            badge.style.transform = 'scale(1)';
        });
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleAutoScroll();
        });

        document.body.appendChild(badge);
    } else {
        const badge = document.getElementById(badgeId);
        if (badge) badge.remove();
    }
}

function updateAutoBadgeCountdown(seconds) {
    const badgeId = 'zap-auto-badge';
    const badge = document.getElementById(badgeId);

    if (!badge) {
        // Fallback: create it if missing (shouldn't happen normally)
        updateAutoBadge(true);
        return updateAutoBadgeCountdown(seconds);
    }

    badge.innerHTML = seconds;
    badge.title = `Cambiando en ${seconds}s — Click para cancelar`;
    badge.style.fontSize = '18px';
    badge.style.fontWeight = 'bold';
    badge.style.background = '#e67e22';
    badge.style.animation = 'zap-countdown-pulse 0.5s ease-in-out';

    // Add keyframes if not present
    if (!document.getElementById('zap-countdown-kf')) {
        const kf = document.createElement('style');
        kf.id = 'zap-countdown-kf';
        kf.textContent = `
            @keyframes zap-countdown-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.18); }
            }
        `;
        document.head.appendChild(kf);
    }

    // Remove pulse after first iteration so it's subtle
    setTimeout(() => {
        if (badge && badge.style.animation === 'zap-countdown-pulse 0.5s ease-in-out') {
            badge.style.animation = '';
        }
    }, 500);
}

// ============ AUTO-SCROLL CUSTOM SHORTCUT LISTENER ============
let _autoShortcutHandler = null;

function setupAutoShortcutListener() {
    removeAutoShortcutListener();
    const hostname = window.location.hostname;
    const cfg = _autoConfig[hostname];
    if (!cfg || !cfg.autoShortcut) return;

    const sc = cfg.autoShortcut;
    if (!sc.key) return;

    _autoShortcutHandler = function(e) {
        // Don't fire in inputs
        if (document.activeElement) {
            const tag = document.activeElement.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
                document.activeElement.isContentEditable) {
                return;
            }
        }
        // Don't fire when keybind prompt is open
        if (_capturingKeybind) return;

        const ctrlOk = sc.ctrlKey ? e.ctrlKey : !e.ctrlKey;
        const altOk = sc.altKey ? e.altKey : !e.altKey;
        const shiftOk = sc.shiftKey ? e.shiftKey : !e.shiftKey;
        const metaOk = sc.metaKey ? e.metaKey : !e.metaKey;
        const keyOk = e.key === sc.key;

        if (ctrlOk && altOk && shiftOk && metaOk && keyOk) {
            e.preventDefault();
            e.stopPropagation();
            toggleAutoScroll();
        }
    };

    document.addEventListener('keydown', _autoShortcutHandler, true);
}

function removeAutoShortcutListener() {
    if (_autoShortcutHandler) {
        document.removeEventListener('keydown', _autoShortcutHandler, true);
        _autoShortcutHandler = null;
    }
}
// ============ READING HISTORY TRACKING ============
// ── Helpers for series/chapter detection ──

function getMetaContent(property) {
    const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
    return el ? (el.getAttribute('content') || '').trim() : '';
}

function getFirstH1() {
    const h1 = document.querySelector('h1');
    return h1 ? (h1.textContent || '').trim() : '';
}

// Words that don't identify a series (Spanish + English)
const GENERIC_SLUGS = /^(manga|comic|series|leer|ver|read|view|watch|chapter|capitulo|catalog|library|blog|post|article|page|item|product|detail|entry|news|story|content|home|index|search|tag|category|archive|buscar|categoria|pagina|entrada)$/i;

// ── Try to extract {series, chapterNumber} from a text string ──
function extractFromText(text) {
    if (!text) return null;
    const patterns = [
        // "La leyenda de la espada del norte - Capítulo 31"
        /(.+?)\s*[-–—|:]\s*(?:cap[ií]tulo|cap\.?|chapter|ch\.?|episodio|ep\.?|episode|volumen|vol\.?)\s*(\d+(?:[.,]\d+)?)/i,
        // "Capítulo 31 - La leyenda de la espada del norte" (chapter keyword must be at start)
        /^(?:cap[ií]tulo|cap\.?|chapter|ch\.?|episodio|ep\.?|episode|volumen|vol\.?)\s*(\d+(?:[.,]\d+)?)\s*[-–—|:]\s*(.+)/i,
        // "La leyenda de la espada del norte Capítulo 31" (no separator)
        /(.+?)\s+(?:cap[ií]tulo|cap\.?|chapter|ch\.?|episodio|ep\.?|episode|volumen|vol\.?)\s+(\d+(?:[.,]\d+)?)/i
    ];
    for (const pat of patterns) {
        const m = text.match(pat);
        if (m) {
            // Figure out which group is series and which is chapter
            let seriesName, chapterStr;
            if (isNaN(parseFloat(m[1]))) {
                // First group is text (series name)
                seriesName = m[1];
                chapterStr = m[2];
            } else {
                // First group is a number (chapter)
                chapterStr = m[1];
                seriesName = m[2];
            }
            const chapterNum = parseFloat(chapterStr.replace(',', '.'));
            seriesName = (seriesName || '').trim();
            // Remove site-name suffix after | and trailing junk
            seriesName = seriesName.replace(/\s*\|.*$/, '').trim();
            seriesName = seriesName.replace(/\s*(?:online|sub|español|english|raw|hd|full|gratis)\s*$/i, '').trim();
            if (seriesName && !isNaN(chapterNum) && chapterNum > 0) {
                return { series: seriesName, chapterNumber: chapterNum };
            }
        }
    }
    return null;
}

// ── Score a candidate (higher = better) ──
function scoreCandidate(candidate, sourceWeight) {
    if (!candidate || !candidate.series || isNaN(candidate.chapterNumber)) return -1000;
    let score = 0;

    // Chapter number plausibility: 1–9999 is a real chapter; >9999 is likely a DB id
    const ch = candidate.chapterNumber;
    if (ch >= 1 && ch <= 9999 && Number.isInteger(ch)) {
        score += 50;
    } else if (ch > 9999) {
        score -= 200; // Almost certainly an ID, not a chapter
    } else {
        score += 20; // Decimals (e.g. ch 12.5) — plausible but unusual
    }

    // Series name quality: must be meaningful, not a generic path segment
    const series = candidate.series;
    if (series.length >= 2 && !GENERIC_SLUGS.test(series)) {
        score += 30;
    } else if (GENERIC_SLUGS.test(series)) {
        score -= 100;
    }

    // Source weight: og:title=20  h1=15  title=10  url=5  url-plain=0
    score += sourceWeight;

    return score;
}

function detectSeriesChapter() {
    const url = window.location.href;
    const candidates = [];

    // ── Source 1: og:title meta tag (highest quality) ──
    const ogTitle = getMetaContent('og:title');
    if (ogTitle) {
        const extracted = extractFromText(ogTitle);
        if (extracted) candidates.push({ ...extracted, source: 'og:title', weight: 20 });
    }

    // ── Source 2: First <h1> ──
    const h1 = getFirstH1();
    if (h1 && h1 !== ogTitle) {
        const extracted = extractFromText(h1);
        if (extracted) candidates.push({ ...extracted, source: 'h1', weight: 15 });
    }

    // ── Source 3: <title> ──
    const title = document.title || '';
    if (title && title !== ogTitle && title !== h1) {
        const extracted = extractFromText(title);
        if (extracted) candidates.push({ ...extracted, source: 'title', weight: 10 });
    }

    // ── Source 4: URL path segments ──
    try {
        const pathname = new URL(url).pathname;
        const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);

        // 4a: Explicit chapter pattern (e.g. "capitulo-42", "chapter-1088")
        for (let i = segments.length - 1; i >= 0; i--) {
            const seg = decodeURIComponent(segments[i]);
            const match = seg.match(/(?:capitulo|cap|chapter|ch|c|episodio|ep|episode|volumen|vol)[-_.\s]*(\d+(?:[.,]\d+)?)/i);
            if (match) {
                const chapterNum = parseFloat(match[1].replace(',', '.'));
                let seriesSeg = (i > 0) ? decodeURIComponent(segments[i - 1]) : '';
                if (!seriesSeg || GENERIC_SLUGS.test(seriesSeg)) {
                    seriesSeg = segments.find(s => !GENERIC_SLUGS.test(decodeURIComponent(s))) || segments[0];
                }
                candidates.push({
                    series: humanizeSlug(seriesSeg),
                    chapterNumber: chapterNum,
                    source: 'url-explicit',
                    weight: 5
                });
                break;
            }
        }

        // 4b: Plain numeric last segment — only if no explicit pattern matched
        if (!candidates.some(c => c.source === 'url-explicit')) {
            const lastSeg = decodeURIComponent(segments[segments.length - 1]);
            const plainMatch = lastSeg.match(/^(\d+(?:[.,]\d+)?)$/);
            if (plainMatch && segments.length >= 2) {
                const chapterNum = parseFloat(plainMatch[1].replace(',', '.'));
                const seriesSeg = decodeURIComponent(segments[segments.length - 2]);
                // Only consider if chapterNum is plausible AND series name is meaningful
                if (chapterNum <= 9999 && !GENERIC_SLUGS.test(seriesSeg)) {
                    candidates.push({
                        series: humanizeSlug(seriesSeg),
                        chapterNumber: chapterNum,
                        source: 'url-plain',
                        weight: 0
                    });
                }
            }
        }
    } catch (_) { /* URL parse error — continue */ }

    // ── Pick the best candidate ──
    let best = null;
    let bestScore = -1000;

    for (const c of candidates) {
        const score = scoreCandidate(c, c.weight);
        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }

    // Minimum score threshold: reject low-confidence matches
    // (og:title + plausible chapter + good series = ~100; url-plain + good series = ~80)
    if (best && bestScore >= 40) {
        return {
            series: best.series,
            chapterNumber: best.chapterNumber,
            chapterLabel: `Capítulo ${best.chapterNumber}`,
            domain: window.location.hostname,
            url: url
        };
    }

    return null; // Could not detect with enough confidence
}

function humanizeSlug(slug) {
    return slug
        .replace(/[-_]/g, ' ')
        .replace(/%20/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .replace(/\s+/g, ' ')
        .trim();
}

function makeSeriesSlug(seriesName) {
    return seriesName
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function recordReadingHistory(detected) {
    if (!detected) return;
    const { series, chapterNumber, chapterLabel, domain, url } = detected;

    chrome.storage.local.get(['zap_reading_history'], (result) => {
        const history = result.zap_reading_history || {};
        const slug = makeSeriesSlug(series + '-' + domain); // domain-scoped slug

        const existing = history[slug];
        // Only update if chapter changed
        if (existing && existing.chapterNumber === chapterNumber) return;

        history[slug] = {
            series,
            chapterNumber,
            chapterLabel,
            domain,
            url,
            timestamp: Date.now()
        };

        // Keep max 100 entries (LRU)
        const entries = Object.entries(history)
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .slice(0, 100);
        const trimmed = Object.fromEntries(entries);

        chrome.storage.local.set({ zap_reading_history: trimmed }, () => {
            console.log(`Zap & Key: Reading history recorded: "${series}" → ${chapterLabel}`);
        });
    });
}

function trackCurrentPage() {
    const detected = detectSeriesChapter();
    recordReadingHistory(detected);
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
loadAutoConfig();
