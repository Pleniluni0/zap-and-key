document.addEventListener('DOMContentLoaded', () => {
    // ============ DOM refs ============
    const toggleZapBtn = document.getElementById('toggleZap');
    const toggleKeybindBtn = document.getElementById('toggleKeybind');
    const rulesListContainer = document.getElementById('rulesList');
    const zapEmptyState = document.getElementById('zapEmptyState');
    const keybindsListContainer = document.getElementById('keybindsList');
    const keybindsEmptyState = document.getElementById('keybindsEmptyState');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    const confirmModal = document.getElementById('confirmModal');
    const confirmMsg = document.getElementById('confirmMsg');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');

    let isZapActive = false;
    let isKeybindActive = false;
    let allRules = {};
    let allKeybinds = {};
    let activeCounts = {};       // hostname -> active element count
    let pausedDomains = {};      // hostname -> bool
    let pendingConfirm = null;   // { hostname } for domain-delete modal
    let currentHostname = '';

    // ============ QUERY CONTENT SCRIPT STATUS ============
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        try {
            currentHostname = new URL(tabs[0].url).hostname;
        } catch (_) {
            currentHostname = '';
        }

        chrome.tabs.sendMessage(tabs[0].id, { action: "getStatus" })
            .then((response) => {
                if (response) {
                    if (response.zapMode !== undefined) {
                        isZapActive = response.zapMode;
                        updateZapButton();
                    }
                    if (response.keybindMode !== undefined) {
                        isKeybindActive = response.keybindMode;
                        updateKeybindButton();
                    }
                }
            })
            .catch(() => {
                // Content script not available
                disableButton(toggleZapBtn);
                disableButton(toggleKeybindBtn);
            });
    });

    function disableButton(btn) {
        btn.disabled = true;
        btn.textContent = 'No disponible';
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.title = 'No disponible en esta página';
    }

    // ============ TOGGLE ZAP ============
    toggleZapBtn.addEventListener('click', () => {
        if (toggleZapBtn.disabled) return;
        isZapActive = !isZapActive;
        updateZapButton();

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "toggleZap",
                value: isZapActive
            }).catch(() => {});
        });

        if (isZapActive) window.close();
    });

    function updateZapButton() {
        if (isZapActive) {
            toggleZapBtn.textContent = '⚡ Zap Mode: ON';
            toggleZapBtn.classList.add('active');
            toggleKeybindBtn.classList.remove('active');
        } else {
            toggleZapBtn.textContent = 'Activar Zap Mode';
            toggleZapBtn.classList.remove('active');
        }
    }

    // ============ TOGGLE KEYBIND ============
    toggleKeybindBtn.addEventListener('click', () => {
        if (toggleKeybindBtn.disabled) return;
        isKeybindActive = !isKeybindActive;
        updateKeybindButton();

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "toggleKeybind",
                value: isKeybindActive
            }).catch(() => {});
        });

        if (isKeybindActive) window.close();
    });

    function updateKeybindButton() {
        if (isKeybindActive) {
            toggleKeybindBtn.textContent = '⌨️ Key Bind Mode: ON';
            toggleKeybindBtn.classList.add('active');
            toggleZapBtn.classList.remove('active');
        } else {
            toggleKeybindBtn.textContent = 'Activar Key Bind Mode';
            toggleKeybindBtn.classList.remove('active');
        }
    }

    // ============ LOAD ALL DATA ============
    function loadAll() {
        chrome.storage.local.get(null, (items) => {
            // Separate known keys
            pausedDomains = items.zap_paused || {};
            allKeybinds = items.zap_keybinds || {};
            delete items.zap_paused;
            delete items.zap_keybinds;

            allRules = items;
            renderZapRules();
            renderKeybinds();
            loadHistory();

            // Query active zap count for current tab
            if (currentHostname) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) return;
                    chrome.tabs.sendMessage(tabs[0].id, { action: "getActiveCount" })
                        .then((response) => {
                            activeCounts[currentHostname] = response ? response.count : 0;
                            renderZapRules();
                        })
                        .catch(() => {});
                });
            }
        });
    }

    // ============ RENDER ZAP RULES ============
    function renderZapRules() {
        rulesListContainer.innerHTML = '';
        const hostnames = Object.keys(allRules).filter(h => {
            const rules = allRules[h];
            return Array.isArray(rules) && rules.length > 0;
        });

        if (hostnames.length === 0) {
            zapEmptyState.style.display = 'block';
            return;
        }
        zapEmptyState.style.display = 'none';

        hostnames.forEach(hostname => {
            const rules = allRules[hostname];
            if (!Array.isArray(rules) || rules.length === 0) return;

            const isPaused = !!pausedDomains[hostname];
            const isCurrent = hostname === currentHostname;
            const stored = rules.length;
            const active = isCurrent ? (activeCounts[hostname] ?? '...') : '';

            const details = document.createElement('details');
            details.open = isCurrent;

            const summary = document.createElement('summary');
            const domainHeader = document.createElement('div');
            domainHeader.className = 'domain-header';

            const domainName = document.createElement('span');
            domainName.className = 'domain-name';
            let countText = `${hostname} (${stored} guardados`;
            if (isCurrent && active !== '') {
                countText += ` / ${active} activos`;
            }
            countText += ')';
            if (isPaused) countText += ' ⏸️';
            domainName.textContent = countText;

            // Pause toggle
            const pauseBtn = document.createElement('button');
            pauseBtn.className = 'pause-btn';
            pauseBtn.innerHTML = isPaused ? '▶️' : '⏸️';
            pauseBtn.title = isPaused ? 'Reanudar reglas' : 'Pausar reglas';
            pauseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePause(hostname, !isPaused);
            });

            // Delete domain
            const deleteDomainBtn = document.createElement('button');
            deleteDomainBtn.className = 'delete-domain-btn';
            deleteDomainBtn.innerHTML = '🗑️';
            deleteDomainBtn.title = 'Eliminar todas las reglas de este dominio';
            deleteDomainBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openConfirmModal(hostname);
            });

            domainHeader.appendChild(domainName);
            domainHeader.appendChild(pauseBtn);
            domainHeader.appendChild(deleteDomainBtn);
            summary.appendChild(domainHeader);
            details.appendChild(summary);

            const ul = document.createElement('ul');
            rules.forEach((rule, index) => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span class="rule-text" title="${escapeHtml(rule)}">${truncateText(rule, 40)}</span>
                    <button class="delete-btn" title="Eliminar regla">✕</button>
                `;
                li.querySelector('.delete-btn').addEventListener('click', () => {
                    deleteZapRule(index, hostname);
                });
                ul.appendChild(li);
            });

            details.appendChild(ul);
            rulesListContainer.appendChild(details);
        });
    }

    // ============ RENDER KEYBINDS ============
    function renderKeybinds() {
        keybindsListContainer.innerHTML = '';
        const hostnames = Object.keys(allKeybinds).filter(h => {
            const binds = allKeybinds[h];
            return Array.isArray(binds) && binds.length > 0;
        });

        if (hostnames.length === 0) {
            keybindsEmptyState.style.display = 'block';
            return;
        }
        keybindsEmptyState.style.display = 'none';

        hostnames.forEach(hostname => {
            const binds = allKeybinds[hostname];
            if (!Array.isArray(binds) || binds.length === 0) return;

            const isCurrent = hostname === currentHostname;

            const details = document.createElement('details');
            details.open = isCurrent;

            const summary = document.createElement('summary');
            const domainHeader = document.createElement('div');
            domainHeader.className = 'domain-header';

            const domainName = document.createElement('span');
            domainName.className = 'domain-name';
            domainName.textContent = `${hostname} (${binds.length} atajos)`;

            // Delete all keybinds for this domain
            const deleteDomainBtn = document.createElement('button');
            deleteDomainBtn.className = 'delete-domain-btn';
            deleteDomainBtn.innerHTML = '🗑️';
            deleteDomainBtn.title = 'Eliminar todos los atajos de este dominio';
            deleteDomainBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openConfirmKeybindsModal(hostname);
            });

            domainHeader.appendChild(domainName);
            domainHeader.appendChild(deleteDomainBtn);
            summary.appendChild(domainHeader);
            details.appendChild(summary);

            const ul = document.createElement('ul');
            binds.forEach((bind, index) => {
                const li = document.createElement('li');
                li.className = 'keybind-li';

                const keyBadge = document.createElement('span');
                keyBadge.className = 'key-badge';
                keyBadge.textContent = formatKeyDisplay(bind.key);
                keyBadge.title = `Tecla: ${bind.key}`;

                const labelSpan = document.createElement('span');
                labelSpan.className = 'rule-text keybind-label';
                labelSpan.textContent = bind.label || bind.selector;
                labelSpan.title = `Selector: ${bind.selector}`;

                const delBtn = document.createElement('button');
                delBtn.className = 'delete-btn';
                delBtn.innerHTML = '✕';
                delBtn.title = 'Eliminar atajo';
                delBtn.addEventListener('click', () => {
                    deleteKeybind(hostname, index);
                });

                li.appendChild(keyBadge);
                li.appendChild(labelSpan);
                li.appendChild(delBtn);
                ul.appendChild(li);
            });

            details.appendChild(ul);
            keybindsListContainer.appendChild(details);
        });
    }

    // ============ KEY DISPLAY FORMATTER ============
    function formatKeyDisplay(key) {
        const map = {
            'ArrowRight': '→',
            'ArrowLeft': '←',
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'Enter': '↵',
            ' ': '␣',
            'Escape': 'Esc',
            'Backspace': '⌫',
            'Delete': '⌦',
            'Tab': '↹',
            'PageUp': 'PgUp',
            'PageDown': 'PgDn',
            'Home': 'Home',
            'End': 'End',
            'Insert': 'Ins',
        };
        if (map[key]) return map[key];
        if (key.startsWith('F') && /^F\d{1,2}$/.test(key)) return key;
        if (key.length === 1) return key.toUpperCase();
        return key;
    }

    // ============ ZAP CRUD ============
    function deleteZapRule(index, hostname) {
        chrome.storage.local.get([hostname], (result) => {
            const rules = result[hostname] || [];
            rules.splice(index, 1);
            if (rules.length === 0) {
                chrome.storage.local.remove(hostname, () => loadAll());
            } else {
                chrome.storage.local.set({ [hostname]: rules }, () => loadAll());
            }
        });
    }

    function deleteDomain(hostname) {
        chrome.storage.local.remove(hostname, () => loadAll());
    }

    function togglePause(hostname, paused) {
        chrome.storage.local.get(['zap_paused'], (result) => {
            const obj = result.zap_paused || {};
            if (paused) {
                obj[hostname] = true;
            } else {
                delete obj[hostname];
            }
            chrome.storage.local.set({ zap_paused: obj }, () => {
                pausedDomains[hostname] = paused;
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) return;
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "pauseDomain",
                        hostname: hostname,
                        paused: paused
                    }).catch(() => {});
                });
                loadAll();
            });
        });
    }

    // ============ KEYBIND CRUD ============
    function deleteKeybind(hostname, index) {
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
                allKeybinds = allBinds;

                // Notify content script to update its cache
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) return;
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "deleteKeybind",
                        hostname: hostname,
                        index: index
                    }).catch(() => {});
                });

                loadAll();
            });
        });
    }

    function deleteKeybindsDomain(hostname) {
        chrome.storage.local.get(['zap_keybinds'], (result) => {
            const allBinds = result.zap_keybinds || {};
            delete allBinds[hostname];
            chrome.storage.local.set({ zap_keybinds: allBinds }, () => {
                allKeybinds = allBinds;
                loadAll();
            });
        });
    }

    // ============ AUTO MODE ============
    const autoSpeed = document.getElementById('autoSpeed');
    const autoWait = document.getElementById('autoWait');
    const autoNextKey = document.getElementById('autoNextKey');
    const autoPlay = document.getElementById('autoPlay');
    const autoStop = document.getElementById('autoStop');
    const autoShortcutBtn = document.getElementById('autoShortcutBtn');

    let autoActive = false;
    let capturingShortcut = false;
    let currentShortcut = null;  // { key, ctrlKey, altKey, shiftKey, metaKey } or null

    function shortcutDisplay(sc) {
        if (!sc || !sc.key) return 'Atajo: Ninguno';
        const parts = [];
        if (sc.ctrlKey) parts.push('Ctrl');
        if (sc.altKey) parts.push('Alt');
        if (sc.shiftKey) parts.push('Shift');
        if (sc.metaKey) parts.push('Win');
        parts.push(sc.key.length === 1 ? sc.key.toUpperCase() : formatKeyDisplay(sc.key));
        return 'Atajo: ' + parts.join('+');
    }

    autoShortcutBtn.addEventListener('click', () => {
        if (capturingShortcut) {
            // Cancel capture
            capturingShortcut = false;
            autoShortcutBtn.textContent = shortcutDisplay(currentShortcut);
            autoShortcutBtn.classList.remove('capturing');
            return;
        }

        capturingShortcut = true;
        autoShortcutBtn.textContent = 'Pulsa tecla(s)...';
        autoShortcutBtn.classList.add('capturing');
    });

    // Capture keydown on the whole popup for shortcut recording
    document.addEventListener('keydown', (e) => {
        if (!capturingShortcut) return;

        // Ignore pure modifier presses
        if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
        // Escape cancels
        if (e.key === 'Escape') {
            capturingShortcut = false;
            autoShortcutBtn.textContent = shortcutDisplay(currentShortcut);
            autoShortcutBtn.classList.remove('capturing');
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        currentShortcut = {
            key: e.key,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey
        };

        capturingShortcut = false;
        autoShortcutBtn.textContent = shortcutDisplay(currentShortcut);
        autoShortcutBtn.classList.remove('capturing');

        // Persist immediately
        saveAutoShortcutToStorage();
    }, true);

    // Allow right-click on shortcut button to clear it
    autoShortcutBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        currentShortcut = null;
        autoShortcutBtn.textContent = 'Atajo: Ninguno';
        capturingShortcut = false;
        autoShortcutBtn.classList.remove('capturing');
        saveAutoShortcutToStorage();
    });

    function saveAutoShortcutToStorage() {
        if (!currentHostname) return;
        chrome.storage.local.get(['zap_auto_config'], (result) => {
            const config = result.zap_auto_config || {};
            const domainConfig = config[currentHostname] || {};
            domainConfig.autoShortcut = currentShortcut || undefined;
            if (!currentShortcut) delete domainConfig.autoShortcut;
            config[currentHostname] = domainConfig;
            chrome.storage.local.set({ zap_auto_config: config }, () => {
                // Notify content script to refresh shortcut listener
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) return;
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "refreshAutoShortcut"
                    }).catch(() => {});
                });
            });
        });
    }

    function populateAutoNextKey() {
        const binds = allKeybinds[currentHostname] || [];
        // Save current selection
        const currentVal = autoNextKey.value;

        autoNextKey.innerHTML = '<option value="">-- Sin keybind --</option>';

        binds.forEach(bind => {
            const option = document.createElement('option');
            option.value = bind.key;
            option.textContent = `${formatKeyDisplay(bind.key)} → ${bind.label}`;
            autoNextKey.appendChild(option);
        });

        // Restore previous selection if still valid
        if (binds.some(b => b.key === currentVal)) {
            autoNextKey.value = currentVal;
        }
    }

    function loadAutoConfig() {
        chrome.storage.local.get(['zap_auto_config'], (result) => {
            const config = result.zap_auto_config || {};
            const domainConfig = config[currentHostname];

            if (domainConfig) {
                if (domainConfig.speed) autoSpeed.value = domainConfig.speed;
                if (domainConfig.waitMs) autoWait.value = domainConfig.waitMs / 1000;
                // Key selection will be populated after keybinds load
                setTimeout(() => {
                    if (domainConfig.nextKey) {
                        autoNextKey.value = domainConfig.nextKey;
                    }
                }, 100);
                // Restore shortcut
                if (domainConfig.autoShortcut) {
                    currentShortcut = domainConfig.autoShortcut;
                    autoShortcutBtn.textContent = shortcutDisplay(currentShortcut);
                }
            }

            // Check if auto-scroll is active
            if (currentHostname) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) return;
                    chrome.tabs.sendMessage(tabs[0].id, { action: "getAutoStatus" })
                        .then((response) => {
                            if (response) {
                                autoActive = response.active;
                                updateAutoButtons();
                            }
                        })
                        .catch(() => {});
                });
            }
        });
    }

    function updateAutoButtons() {
        if (autoActive) {
            autoPlay.textContent = '▶ Auto ON';
            autoPlay.classList.add('active');
            autoStop.style.display = 'inline-block';
            autoPlay.style.flex = '2';
        } else {
            autoPlay.textContent = '▶ Iniciar';
            autoPlay.classList.remove('active');
            autoStop.style.display = 'none';
            autoPlay.style.flex = '1';
        }
    }

    autoPlay.addEventListener('click', () => {
        if (autoPlay.disabled) return;

        const speed = autoSpeed.value;
        const waitMs = Math.max(500, Math.min(10000, parseFloat(autoWait.value) * 1000 || 2000));
        const nextKey = autoNextKey.value || null;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "startAutoScroll",
                speed: speed,
                nextKey: nextKey,
                waitMs: waitMs,
                saveConfig: true
            }).then((response) => {
                if (response) {
                    autoActive = response.active;
                    updateAutoButtons();
                }
            }).catch(() => {});
        });

        window.close();
    });

    autoStop.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "stopAutoScroll",
                saveConfig: true
            }).then((response) => {
                if (response) {
                    autoActive = response.active;
                    updateAutoButtons();
                }
            }).catch(() => {});
        });

        window.close();
    });

    // Populate the next-key dropdown whenever keybinds are loaded
    const originalRenderKeybinds = renderKeybinds;
    renderKeybinds = function () {
        originalRenderKeybinds();
        populateAutoNextKey();
    };

    // ============ CONFIRMATION MODALS ============
    function openConfirmModal(hostname) {
        pendingConfirm = { type: 'zap', hostname };
        confirmMsg.textContent = `¿Eliminar TODAS las reglas zap de «${hostname}»?`;
        confirmModal.style.display = 'flex';
        confirmYes.focus();
    }

    function openConfirmKeybindsModal(hostname) {
        pendingConfirm = { type: 'keybinds', hostname };
        confirmMsg.textContent = `¿Eliminar TODOS los atajos de tecla de «${hostname}»?`;
        confirmModal.style.display = 'flex';
        confirmYes.focus();
    }

    function closeConfirmModal() {
        confirmModal.style.display = 'none';
        pendingConfirm = null;
    }

    confirmYes.addEventListener('click', () => {
        if (pendingConfirm) {
            if (pendingConfirm.type === 'zap') {
                deleteDomain(pendingConfirm.hostname);
            } else if (pendingConfirm.type === 'keybinds') {
                deleteKeybindsDomain(pendingConfirm.hostname);
            }
        }
        closeConfirmModal();
    });

    confirmNo.addEventListener('click', closeConfirmModal);

    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) closeConfirmModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && confirmModal.style.display === 'flex') {
            closeConfirmModal();
        }
    });

    // ============ READING HISTORY ============
    const historyList = document.getElementById('historyList');
    const historyEmptyState = document.getElementById('historyEmptyState');

    let allHistory = {};

    function loadHistory() {
        chrome.storage.local.get(['zap_reading_history'], (result) => {
            allHistory = result.zap_reading_history || {};
            renderHistory();
        });
    }

    function renderHistory() {
        historyList.innerHTML = '';
        const entries = Object.entries(allHistory)
            .sort((a, b) => b[1].timestamp - a[1].timestamp);

        if (entries.length === 0) {
            historyEmptyState.style.display = 'block';
            return;
        }
        historyEmptyState.style.display = 'none';

        entries.forEach(([slug, entry]) => {
            const item = document.createElement('div');
            item.className = 'history-item';

            const info = document.createElement('div');
            info.className = 'history-info';

            const seriesName = document.createElement('span');
            seriesName.className = 'history-series';
            seriesName.textContent = entry.series;
            seriesName.title = entry.series;

            const chapter = document.createElement('span');
            chapter.className = 'history-chapter';
            chapter.textContent = entry.chapterLabel || `Cap. ${entry.chapterNumber}`;

            const domain = document.createElement('span');
            domain.className = 'history-domain';
            domain.textContent = entry.domain;

            const timeAgo = document.createElement('span');
            timeAgo.className = 'history-time';
            timeAgo.textContent = formatTimeAgo(entry.timestamp);
            timeAgo.title = new Date(entry.timestamp).toLocaleString();

            info.appendChild(seriesName);
            info.appendChild(chapter);
            info.appendChild(domain);
            info.appendChild(timeAgo);

            // Click to navigate
            item.addEventListener('click', () => {
                chrome.tabs.create({ url: entry.url, active: true });
            });

            // Delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn history-del';
            delBtn.innerHTML = '✕';
            delBtn.title = 'Eliminar del historial';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHistoryEntry(slug);
            });

            item.appendChild(info);
            item.appendChild(delBtn);
            historyList.appendChild(item);
        });
    }

    function deleteHistoryEntry(slug) {
        delete allHistory[slug];
        chrome.storage.local.set({ zap_reading_history: allHistory }, () => {
            renderHistory();
        });
    }

    function formatTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (mins < 1) return 'ahora';
        if (mins < 60) return `hace ${mins}m`;
        if (hours < 24) return `hace ${hours}h`;
        if (days < 7) return `hace ${days}d`;
        if (days < 30) return `hace ${Math.floor(days / 7)}sem`;
        const months = Math.floor(days / 30);
        return `hace ${months}mes`;
    }

    // ============ EXPORT / IMPORT ============
    exportBtn.addEventListener('click', () => {
        chrome.storage.local.get(null, (items) => {
            const data = JSON.stringify(items, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `zap-and-key-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    });

    importBtn.addEventListener('click', () => {
        importFile.click();
    });

    importFile.addEventListener('change', () => {
        const file = importFile.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (typeof data !== 'object' || Array.isArray(data)) {
                    throw new Error('Formato inválido');
                }

                if (confirm('¿Importar reglas y atajos? Esto sobrescribirá los datos existentes para los mismos dominios.')) {
                    const keys = Object.keys(data);
                    let done = 0;
                    keys.forEach(key => {
                        chrome.storage.local.set({ [key]: data[key] }, () => {
                            done++;
                            if (done === keys.length) loadAll();
                        });
                    });
                    if (keys.length === 0) loadAll();
                }
            } catch (err) {
                alert('Error: el archivo no es un JSON válido de Zap & Key.');
            }
        };
        reader.readAsText(file);
        importFile.value = '';
    });

    // ============ UTILS ============
    function truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============ INIT ============
    loadAll();
    loadAutoConfig();
});
