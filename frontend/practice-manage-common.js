function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

/**
 * Render text with math notation support via KaTeX.
 * Converts sqrt(x) to \sqrt{x} and x^y to x^{y} LaTeX, then renders via KaTeX.
 * Falls back to plain text if KaTeX is not loaded.
 */
function renderMathHtml(text) {
    const raw = String(text ?? '');
    if (!raw) return '';
    if (!hasMathNotation(raw)) return escapeHtml(raw);
    let latex = raw.replace(/sqrt\(([^)]+)\)/gi, (_match, inner) => `\\sqrt{${inner}}`);
    latex = latex.replace(/\^(\([^)]+\)|\d+|[a-zA-Z])/g, (_match, exp) => {
        const inner = exp.startsWith('(') && exp.endsWith(')') ? exp.slice(1, -1) : exp;
        return `^{${inner}}`;
    });
    if (typeof katex !== 'undefined') {
        try {
            return katex.renderToString(latex, { throwOnError: false, displayMode: false });
        } catch (_e) { /* fall through */ }
    }
    const escaped = escapeHtml(raw);
    return escaped
        .replace(/sqrt\(([^)]+)\)/gi, (_match, inner) => `√${inner}`)
        .replace(/\^(\([^)]+\)|\d+|[a-zA-Z])/g, (_match, exp) => {
            const inner = exp.startsWith('(') && exp.endsWith(')') ? exp.slice(1, -1) : exp;
            return `<sup>${escapeHtml(inner)}</sup>`;
        });
}

function hasMathNotation(text) {
    const s = String(text ?? '');
    return /sqrt\(/i.test(s) || /\^(\(|\d|[a-zA-Z])/.test(s);
}

(function loadKaTeX() {
    if (typeof katex !== 'undefined') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js';
    document.head.appendChild(script);
})();

window.PracticeManageCommon = {
    _passwordDialogStyleInjected: false,

    _ensurePasswordDialogStyles() {
        if (this._passwordDialogStyleInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .pwd-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.45);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                padding: 1rem;
            }
            .pwd-dialog {
                width: 100%;
                max-width: 360px;
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
                padding: 1rem;
            }
            .pwd-title {
                margin: 0 0 0.6rem 0;
                font-size: 1rem;
                color: #2f3c7e;
                font-weight: 700;
            }
            .pwd-warning {
                margin: 0 0 0.8rem 0;
                color: #9c3600;
                font-size: 0.9rem;
                background: #fff4e6;
                border: 1px solid #ffd8a8;
                border-radius: 8px;
                padding: 0.55rem 0.6rem;
            }
            .pwd-input {
                width: 100%;
                padding: 0.55rem 0.65rem;
                border: 1px solid #ccd2e0;
                border-radius: 8px;
                font-size: 0.95rem;
                margin-bottom: 0.8rem;
                box-sizing: border-box;
            }
            .pwd-message {
                margin: 0 0 0.8rem 0;
                color: #c92a2a;
                font-size: 0.9rem;
            }
            .pwd-actions {
                display: flex;
                justify-content: flex-end;
                gap: 0.5rem;
            }
            .pwd-btn {
                border: 0;
                border-radius: 8px;
                padding: 0.5rem 0.75rem;
                font-size: 0.9rem;
                cursor: pointer;
            }
            .pwd-btn.cancel {
                background: #f1f3f5;
                color: #495057;
            }
            .pwd-btn.confirm {
                background: #2f9e44;
                color: #fff;
            }
        `;
        document.head.appendChild(style);
        this._passwordDialogStyleInjected = true;
    },

    _showPasswordInputDialog(actionLabel = 'this action', options = {}) {
        this._ensurePasswordDialogStyles();
        const warningMessage = String(options.warningMessage || '').trim();
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'pwd-overlay';
            overlay.innerHTML = `
                <div class="pwd-dialog" role="dialog" aria-modal="true" aria-label="Password Confirmation">
                    <h3 class="pwd-title">Enter family password to confirm ${escapeHtml(actionLabel)}:</h3>
                    ${warningMessage ? `<p class="pwd-warning">${escapeHtml(warningMessage)}</p>` : ''}
                    <input class="pwd-input" type="password" autocomplete="current-password" />
                    <div class="pwd-actions">
                        <button type="button" class="pwd-btn cancel">Close</button>
                        <button type="button" class="pwd-btn confirm">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const input = overlay.querySelector('.pwd-input');
            const cancelBtn = overlay.querySelector('.pwd-btn.cancel');
            const confirmBtn = overlay.querySelector('.pwd-btn.confirm');

            const close = (result) => {
                overlay.remove();
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => close({ cancelled: true }));
            confirmBtn.addEventListener('click', () => close({ cancelled: false, password: String(input.value || '').trim() }));
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    close({ cancelled: false, password: String(input.value || '').trim() });
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    close({ cancelled: true });
                }
            });
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) {
                    close({ cancelled: true });
                }
            });

            input.focus();
        });
    },

    _showPasswordMessageDialog(actionLabel = 'this action', message = '') {
        this._ensurePasswordDialogStyles();
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'pwd-overlay';
            overlay.innerHTML = `
                <div class="pwd-dialog" role="dialog" aria-modal="true" aria-label="Password Error">
                    <h3 class="pwd-title">Enter family password to confirm ${escapeHtml(actionLabel)}:</h3>
                    <p class="pwd-message">${escapeHtml(message || 'Invalid password')}</p>
                    <div class="pwd-actions">
                        <button type="button" class="pwd-btn cancel">OK</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            const okBtn = overlay.querySelector('.pwd-btn.cancel');
            const escOnce = (event) => {
                if (event.key === 'Escape') {
                    close();
                }
            };
            const close = () => {
                window.removeEventListener('keydown', escOnce);
                overlay.remove();
                resolve();
            };
            okBtn.addEventListener('click', close);
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close();
            });
            window.addEventListener('keydown', escOnce);
            okBtn.focus();
        });
    },

    buildPasswordHeaders(password, withJsonContentType = false) {
        const headers = {};
        if (withJsonContentType) {
            headers['Content-Type'] = 'application/json';
        }
        if (password) {
            headers['X-Confirm-Password'] = password;
        }
        return headers;
    },

    async requestWithPasswordDialog(actionLabel, requestFactory, options = {}) {
        const inputResult = await this._showPasswordInputDialog(actionLabel, options);
        if (inputResult.cancelled) {
            return { cancelled: true };
        }
        const password = String(inputResult.password || '').trim();
        if (!password) {
            await this._showPasswordMessageDialog(actionLabel, 'Password is required.');
            return { cancelled: true };
        }

        let response;
        try {
            response = await requestFactory(password);
        } catch (error) {
            return { ok: false, error: error?.message || 'Request failed' };
        }

        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
            return { ok: true, response, payload };
        }

        const apiError = String(payload.error || `HTTP ${response.status}`);
        if (response.status === 400 || response.status === 403) {
            await this._showPasswordMessageDialog(actionLabel, apiError);
            return { cancelled: true, invalidPassword: true, error: apiError };
        }

        return { ok: false, error: apiError, response, payload };
    },

    sortCardsForView(cards, mode) {
        const copy = [...cards];

        if (mode === 'added_time') {
            return copy.sort((a, b) => this.parseTime(b.created_at) - this.parseTime(a.created_at));
        }

        if (mode === 'hardness_desc') {
            return copy.sort((a, b) => {
                const aAttempts = Number.isFinite(a.lifetime_attempts) ? a.lifetime_attempts : 0;
                const bAttempts = Number.isFinite(b.lifetime_attempts) ? b.lifetime_attempts : 0;
                const aNeverSeen = aAttempts <= 0;
                const bNeverSeen = bAttempts <= 0;
                if (aNeverSeen !== bNeverSeen) {
                    return aNeverSeen ? -1 : 1;
                }
                const aHard = Number.isFinite(a.hardness_score) ? a.hardness_score : -1;
                const bHard = Number.isFinite(b.hardness_score) ? b.hardness_score : -1;
                if (aHard === bHard) {
                    return this.compareQueueOrder(a, b);
                }
                return bHard - aHard;
            });
        }

        if (mode === 'new_queue') {
            return copy.sort((a, b) => {
                const aSkipped = Boolean(a && a.skip_practice);
                const bSkipped = Boolean(b && b.skip_practice);
                if (aSkipped !== bSkipped) {
                    return aSkipped ? 1 : -1;
                }
                const aOrder = Number.isFinite(Number(a && a.practice_priority_order))
                    ? Number(a.practice_priority_order)
                    : Number.MAX_SAFE_INTEGER;
                const bOrder = Number.isFinite(Number(b && b.practice_priority_order))
                    ? Number(b.practice_priority_order)
                    : Number.MAX_SAFE_INTEGER;
                if (aOrder !== bOrder) {
                    return aOrder - bOrder;
                }
                return this.compareQueueOrder(a, b);
            });
        }

        if (mode === 'lifetime_attempts_desc') {
            return copy.sort((a, b) => {
                const aAttempts = Number.isFinite(a.lifetime_attempts) ? a.lifetime_attempts : 0;
                const bAttempts = Number.isFinite(b.lifetime_attempts) ? b.lifetime_attempts : 0;
                if (aAttempts === bAttempts) {
                    return this.compareQueueOrder(a, b);
                }
                return bAttempts - aAttempts;
            });
        }

        if (mode === 'lifetime_attempts_asc') {
            return copy.sort((a, b) => {
                const aAttempts = Number.isFinite(a.lifetime_attempts) ? a.lifetime_attempts : 0;
                const bAttempts = Number.isFinite(b.lifetime_attempts) ? b.lifetime_attempts : 0;
                if (aAttempts === bAttempts) {
                    return this.compareQueueOrder(a, b);
                }
                return aAttempts - bAttempts;
            });
        }

        return copy.sort((a, b) => this.compareQueueOrder(a, b));
    },

    compareQueueOrder(a, b) {
        const aOrder = Number.isFinite(a.next_session_order) ? a.next_session_order : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(b.next_session_order) ? b.next_session_order : Number.MAX_SAFE_INTEGER;

        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }

        return (a.id || 0) - (b.id || 0);
    },

    parseTime(value) {
        if (!value) {
            return 0;
        }
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    },

    formatHardnessScore(score) {
        if (score === null || score === undefined) {
            return '-';
        }
        const value = Number(score);
        if (Number.isNaN(value)) {
            return '-';
        }
        return Number.isInteger(value) ? `${value}` : `${value.toFixed(1)}`;
    },

    formatAddedDate(dateStr) {
        if (!dateStr) {
            return '-';
        }
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) {
            return '-';
        }
        return date.toLocaleDateString();
    },

    formatLastSeenDays(dateStr) {
        if (!dateStr) {
            return 'Never';
        }
        const seenDate = new Date(dateStr);
        if (Number.isNaN(seenDate.getTime())) {
            return 'Unknown';
        }

        const now = new Date();
        const msPerDay = 24 * 60 * 60 * 1000;
        const dayDiff = Math.floor((now - seenDate) / msPerDay);

        if (dayDiff <= 0) {
            return 'Today';
        }
        if (dayDiff === 1) {
            return '1 day ago';
        }
        return `${dayDiff} days ago`;
    },

    clampPercent(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed)) {
            return 0;
        }
        return Math.max(0, Math.min(100, parsed));
    },

    createHardnessSliderController(config = {}) {
        const sliderEl = config.sliderEl || null;
        const valueEl = config.valueEl || null;
        const debounceMsRaw = Number.parseInt(String(config.debounceMs ?? 180), 10);
        const debounceMs = Number.isInteger(debounceMsRaw) && debounceMsRaw >= 0 ? debounceMsRaw : 180;
        const onPreview = typeof config.onPreview === 'function' ? config.onPreview : async () => {};
        const onCommit = typeof config.onCommit === 'function' ? config.onCommit : async () => {};
        const onError = typeof config.onError === 'function' ? config.onError : () => {};

        let currentValue = this.clampPercent(config.initialValue);
        let previewTimer = null;
        let isAttached = false;

        const render = () => {
            if (sliderEl) {
                sliderEl.value = String(currentValue);
            }
            if (valueEl) {
                valueEl.textContent = `${currentValue}%`;
            }
        };

        const setValue = (value) => {
            currentValue = this.clampPercent(value);
            render();
            return currentValue;
        };

        const runPreview = async (value) => {
            try {
                await onPreview(value);
            } catch (error) {
                onError(error);
            }
        };

        const schedulePreview = (value) => {
            if (previewTimer) {
                clearTimeout(previewTimer);
            }
            previewTimer = setTimeout(() => {
                previewTimer = null;
                void runPreview(value);
            }, debounceMs);
        };

        const handleInput = () => {
            const value = setValue(sliderEl ? sliderEl.value : currentValue);
            schedulePreview(value);
        };

        const handleChange = async () => {
            const value = setValue(sliderEl ? sliderEl.value : currentValue);
            if (previewTimer) {
                clearTimeout(previewTimer);
                previewTimer = null;
            }
            try {
                await onCommit(value);
            } catch (error) {
                onError(error);
            }
        };

        const attach = () => {
            if (!sliderEl || isAttached) {
                render();
                return;
            }
            sliderEl.addEventListener('input', handleInput);
            sliderEl.addEventListener('change', () => {
                void handleChange();
            });
            isAttached = true;
            render();
        };

        return {
            attach,
            getValue: () => currentValue,
            setValue,
        };
    },

    createInlineStatusController(config = {}) {
        const el = config.el || null;
        const hiddenClass = String(config.hiddenClass || 'hidden');
        const successClass = String(config.successClass || 'success');
        const errorClass = String(config.errorClass || 'error');
        const normalizeMessage = (value) => String(value || '').trim();

        const clear = () => {
            if (!el) {
                return;
            }
            el.textContent = '';
            el.classList.add(hiddenClass);
            el.classList.remove(successClass);
            el.classList.remove(errorClass);
        };

        const show = (message, isError = false) => {
            if (!el) {
                return;
            }
            const text = normalizeMessage(message);
            if (!text) {
                clear();
                return;
            }
            el.textContent = text;
            el.classList.remove(hiddenClass);
            el.classList.toggle(errorClass, Boolean(isError));
            el.classList.toggle(successClass, !isError);
        };

        return { clear, show };
    },

    createLatestResponseTracker() {
        let requestSeq = 0;
        let latestAppliedSeq = 0;
        return {
            begin() {
                requestSeq += 1;
                return requestSeq;
            },
            shouldApply(requestId) {
                const id = Number.parseInt(requestId, 10);
                if (!Number.isInteger(id) || id <= 0) {
                    return false;
                }
                if (id < latestAppliedSeq) {
                    return false;
                }
                latestAppliedSeq = id;
                return true;
            },
        };
    },

    createKidHardnessController(config = {}) {
        const sliderEl = config.sliderEl || null;
        const valueEl = config.valueEl || null;
        const statusEl = config.statusEl || null;
        const apiBase = String(config.apiBase || '');
        const kidId = String(config.kidId || '');
        const kidFieldName = String(config.kidFieldName || '').trim();
        const savedMessage = String(config.savedMessage || 'Hard cards % saved.');
        const clearTopError = typeof config.clearTopError === 'function' ? config.clearTopError : () => {};
        const reloadCards = typeof config.reloadCards === 'function' ? config.reloadCards : async () => {};
        const onSaved = typeof config.onSaved === 'function' ? config.onSaved : null;
        const buildPayload = typeof config.buildPayload === 'function'
            ? config.buildPayload
            : (hardPct) => ({ [kidFieldName]: hardPct });
        const getPersistedValue = typeof config.getPersistedValue === 'function'
            ? config.getPersistedValue
            : (payload) => payload && payload[kidFieldName];

        let currentValue = this.clampPercent(config.initialValue);
        const statusController = this.createInlineStatusController({
            el: statusEl,
            hiddenClass: 'hidden',
            successClass: 'success',
            errorClass: 'error',
        });

        const setCurrentValue = (value) => {
            currentValue = this.clampPercent(value);
            if (sliderController) {
                sliderController.setValue(currentValue);
            }
            return currentValue;
        };

        const parsePreviewValue = (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed)) {
                return null;
            }
            return this.clampPercent(parsed);
        };

        const formatSavedMessage = (value) => {
            const normalizedValue = this.clampPercent(value);
            const template = String(savedMessage || '').trim();
            if (template.includes('{value}')) {
                return template.replace(/\{value\}/g, String(normalizedValue));
            }
            if (!template) {
                return `Hard cards % saved: ${normalizedValue}%.`;
            }
            const base = template.replace(/[.!\s]+$/g, '');
            return `${base}: ${normalizedValue}%.`;
        };

        const save = async (value) => {
            if (!apiBase || !kidId || !kidFieldName) {
                throw new Error('Hardness controller is not configured.');
            }
            const hardPct = this.clampPercent(value);
            const response = await fetch(`${apiBase}/kids/${kidId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildPayload(hardPct)),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Failed to save hardness % (HTTP ${response.status})`);
            }
            const persistedRaw = getPersistedValue(payload);
            const persistedParsed = Number.parseInt(persistedRaw, 10);
            const persistedHardPct = Number.isInteger(persistedParsed)
                ? this.clampPercent(persistedParsed)
                : hardPct;
            setCurrentValue(persistedHardPct);
            statusController.show(formatSavedMessage(persistedHardPct), false);
            if (onSaved) {
                onSaved(payload, persistedHardPct);
            }
            return payload;
        };

        const sliderController = this.createHardnessSliderController({
            sliderEl,
            valueEl,
            initialValue: currentValue,
            debounceMs: 180,
            onPreview: async (value) => {
                clearTopError();
                statusController.clear();
                await reloadCards(value);
            },
            onCommit: async (value) => {
                await save(value);
                await reloadCards();
            },
            onError: (error) => {
                statusController.show(
                    (error && error.message) ? error.message : 'Failed to update hardness %.',
                    true
                );
            },
        });

        const attach = () => {
            statusController.clear();
            sliderController.attach();
        };

        return {
            attach,
            getCurrentValue: () => currentValue,
            setCurrentValue,
            parsePreviewValue,
            save,
            statusController,
        };
    },

    renderLimitedAvailableDecks(config = {}) {
        const containerEl = config.containerEl || null;
        const emptyEl = config.emptyEl || null;
        if (!containerEl || !emptyEl) {
            return { renderedCount: 0, hiddenCount: 0 };
        }

        const allAvailableDecks = Array.isArray(config.allAvailableDecks) ? config.allAvailableDecks : [];
        const filteredDecks = Array.isArray(config.filteredDecks) ? config.filteredDecks : [];
        const emptyText = String(config.emptyText || 'No predefined decks available yet.');
        const filterLabel = String(config.filterLabel || '').trim();
        const noMatchTextPrefix = String(config.noMatchTextPrefix || 'No available deck matches tag').trim();
        const getLabel = typeof config.getLabel === 'function'
            ? config.getLabel
            : (deck) => String(deck && deck.name ? deck.name : '');
        const getSuffix = typeof config.getSuffix === 'function'
            ? config.getSuffix
            : (deck) => ` · ${Number(deck && deck.card_count ? deck.card_count : 0)} cards`;
        const getBubbleClassName = typeof config.getBubbleClassName === 'function'
            ? config.getBubbleClassName
            : () => '';
        const bubbleTitle = String(config.bubbleTitle || 'Click to stage opt-in');
        const persistentHtmlBefore = String(config.persistentHtmlBefore || '');
        const persistentItemCountRaw = Number.parseInt(String(config.persistentItemCount ?? 0), 10);
        const persistentItemCount = Number.isInteger(persistentItemCountRaw) && persistentItemCountRaw > 0
            ? persistentItemCountRaw
            : 0;

        const rawMax = Number.parseInt(String(config.maxVisibleCount ?? 0), 10);
        const maxVisibleCount = Number.isInteger(rawMax) && rawMax > 0
            ? rawMax
            : filteredDecks.length;

        if (allAvailableDecks.length === 0) {
            containerEl.innerHTML = persistentHtmlBefore;
            if (persistentItemCount > 0) {
                emptyEl.classList.add('hidden');
                return { renderedCount: persistentItemCount, hiddenCount: 0 };
            }
            emptyEl.textContent = emptyText;
            emptyEl.classList.remove('hidden');
            return { renderedCount: 0, hiddenCount: 0 };
        }

        if (filteredDecks.length === 0) {
            containerEl.innerHTML = persistentHtmlBefore;
            if (persistentItemCount > 0) {
                emptyEl.classList.add('hidden');
                return { renderedCount: persistentItemCount, hiddenCount: 0 };
            }
            emptyEl.textContent = filterLabel
                ? `${noMatchTextPrefix} "${filterLabel}".`
                : emptyText;
            emptyEl.classList.remove('hidden');
            return { renderedCount: 0, hiddenCount: 0 };
        }

        emptyEl.classList.add('hidden');

        const visibleDecks = filteredDecks.slice(0, maxVisibleCount);
        const hiddenCount = Math.max(0, filteredDecks.length - visibleDecks.length);

        const bubbleHtml = visibleDecks.map((deck) => {
            const deckId = Number(deck && deck.deck_id ? deck.deck_id : 0);
            const label = String(getLabel(deck) || '');
            const suffix = String(getSuffix(deck) || '');
            const rawExtraClasses = String(getBubbleClassName(deck) || '').trim();
            const extraClasses = rawExtraClasses
                .split(/\s+/)
                .filter((token) => /^[a-zA-Z0-9_-]+$/.test(token));
            const bubbleClass = ['deck-bubble', ...extraClasses].join(' ');
            return `
                <button
                    type="button"
                    class="${bubbleClass}"
                    data-deck-id="${deckId}"
                    title="${escapeHtml(bubbleTitle)}"
                >${escapeHtml(label)}${escapeHtml(suffix)}</button>
            `;
        }).join('');

        const moreHtml = hiddenCount > 0
            ? `<div class="deck-bubble-more-row" title="${hiddenCount} more available deck(s) not shown">+${hiddenCount} more deck(s)</div>`
            : '';

        containerEl.innerHTML = `${persistentHtmlBefore}${bubbleHtml}${moreHtml}`;
        return { renderedCount: visibleDecks.length + persistentItemCount, hiddenCount };
    },

    createOptInAllAvailableController(config = {}) {
        const buttonEl = config.buttonEl || null;
        const buttonText = String(config.buttonText || 'Opt-in All').trim() || 'Opt-in All';
        const isBusy = typeof config.isBusy === 'function' ? config.isBusy : () => false;
        const getFilteredDecks = typeof config.getFilteredDecks === 'function' ? config.getFilteredDecks : () => [];
        const hasDeckId = typeof config.hasDeckId === 'function' ? config.hasDeckId : () => false;
        const addDeckId = typeof config.addDeckId === 'function' ? config.addDeckId : () => {};
        const clearMessages = typeof config.clearMessages === 'function' ? config.clearMessages : () => {};
        const onChanged = typeof config.onChanged === 'function' ? config.onChanged : async () => {};
        const getDeckId = typeof config.getDeckId === 'function'
            ? config.getDeckId
            : (deck) => Number(deck && deck.deck_id);

        const render = (filteredCount = null) => {
            if (!buttonEl) {
                return;
            }
            const resolvedCount = Number.isInteger(filteredCount) && filteredCount >= 0
                ? filteredCount
                : getFilteredDecks().length;
            buttonEl.disabled = Boolean(isBusy()) || resolvedCount === 0;
            buttonEl.textContent = resolvedCount > 0 ? `${buttonText} (${resolvedCount})` : buttonText;
        };

        const optInAll = async () => {
            if (Boolean(isBusy())) {
                return;
            }
            const deckList = getFilteredDecks();
            if (deckList.length === 0) {
                render(0);
                return;
            }

            let changed = false;
            deckList.forEach((deck) => {
                const deckId = getDeckId(deck);
                if (deckId > 0 && !hasDeckId(deckId)) {
                    addDeckId(deckId);
                    changed = true;
                }
            });
            if (!changed) {
                render(deckList.length);
                return;
            }

            clearMessages();
            await onChanged();
        };

        return { render, optInAll };
    },

    createSetBackedOptInAllAvailableController(config = {}) {
        const staticDeckIdSet = config.deckIdSet instanceof Set ? config.deckIdSet : null;
        const getDeckIdSet = typeof config.getDeckIdSet === 'function'
            ? config.getDeckIdSet
            : () => (staticDeckIdSet || new Set());
        return this.createOptInAllAvailableController({
            buttonEl: config.buttonEl,
            isBusy: config.isBusy,
            getFilteredDecks: config.getFilteredDecks,
            clearMessages: config.clearMessages,
            onChanged: config.onChanged,
            getDeckId: config.getDeckId,
            hasDeckId: (deckId) => getDeckIdSet().has(Number(deckId)),
            addDeckId: (deckId) => {
                getDeckIdSet().add(Number(deckId));
            },
        });
    },

    createHierarchicalTagFilterController(config = {}) {
        const selectEl = config.selectEl || null;
        const clearBtn = config.clearBtn || null;
        const getDecks = typeof config.getDecks === 'function' ? config.getDecks : () => [];
        const getDeckTags = typeof config.getDeckTags === 'function'
            ? config.getDeckTags
            : (deck) => (Array.isArray(deck?.tags) ? deck.tags : []);
        const getDeckTagLabels = typeof config.getDeckTagLabels === 'function'
            ? config.getDeckTagLabels
            : null;
        const onFilterChanged = typeof config.onFilterChanged === 'function' ? config.onFilterChanged : null;

        let selectedTags = [];
        let selectedTagLabels = [];
        let filteredDeckIdSet = null;
        let currentSuggestions = [];
        let chipsEl = null;
        let isApplyingProgrammaticSelect = false;

        const normalizeTag = (raw) => String(raw || '')
            .trim()
            .toLowerCase()
            .replace(/\([^()]*\)\s*$/, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');

        const getDeckId = (deck) => Number(deck && deck.deck_id);

        const ensureChipsContainer = () => {
            if (chipsEl) {
                return chipsEl;
            }
            if (!selectEl || !selectEl.parentElement) {
                return null;
            }
            chipsEl = document.createElement('div');
            chipsEl.className = 'shared-tag-filter-chips hidden';
            chipsEl.addEventListener('click', (event) => {
                const btn = event.target.closest('button[data-filter-tag-index]');
                if (!btn) {
                    return;
                }
                const index = Number.parseInt(btn.getAttribute('data-filter-tag-index') || '', 10);
                if (!Number.isInteger(index) || index < 0 || index >= selectedTags.length) {
                    return;
                }
                selectedTags = selectedTags.filter((_, i) => i !== index);
                sync();
                if (onFilterChanged) {
                    onFilterChanged();
                }
            });

            const filterRow = selectEl.closest('.deck-filter-row, .available-filter, .filter-delete-row');
            if (filterRow && filterRow.parentElement) {
                filterRow.insertAdjacentElement('afterend', chipsEl);
            } else {
                selectEl.parentElement.insertAdjacentElement('afterend', chipsEl);
            }
            return chipsEl;
        };

        const getCandidateEntries = () => {
            const decks = Array.isArray(getDecks()) ? getDecks() : [];
            return decks
                .map((deck) => {
                    const rawTags = Array.isArray(getDeckTags(deck)) ? getDeckTags(deck) : [];
                    const deckLabels = getDeckTagLabels ? getDeckTagLabels(deck) : rawTags;
                    const rawLabels = Array.isArray(deckLabels) ? deckLabels : rawTags;
                    const tags = [];
                    const tagLabels = [];
                    const seen = new Set();
                    rawTags.forEach((rawTag, index) => {
                        const tagKey = normalizeTag(rawTag);
                        if (!tagKey || seen.has(tagKey)) {
                            return;
                        }
                        seen.add(tagKey);
                        const rawLabel = String(rawLabels[index] || '').trim();
                        const label = rawLabel || tagKey;
                        tags.push(tagKey);
                        tagLabels.push(label);
                    });
                    const deckId = getDeckId(deck);
                    if (!Number.isFinite(deckId) || deckId <= 0 || tags.length === 0) {
                        return null;
                    }
                    return { deck, deckId, tags, tagLabels };
                })
                .filter(Boolean);
        };

        const getUniqueTagOptionsAtLevel = (entries, levelIndex) => {
            const tagMap = new Map();
            entries.forEach((entry) => {
                const tag = String(entry.tags[levelIndex] || '').trim();
                if (tag) {
                    const label = String(entry.tagLabels[levelIndex] || tag).trim() || tag;
                    if (!tagMap.has(tag)) {
                        tagMap.set(tag, label);
                    }
                }
            });
            return Array.from(tagMap.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([key, label]) => ({ key, label }));
        };

        const findNextBranchLevel = (entries, startLevel) => {
            let level = Math.max(0, Number.parseInt(startLevel, 10) || 0);
            while (level < 64) {
                const uniqueTags = getUniqueTagOptionsAtLevel(entries, level);
                if (uniqueTags.length === 0) {
                    return -1;
                }
                if (uniqueTags.length > 1) {
                    return level;
                }
                level += 1;
            }
            return -1;
        };

        const applySelectedPath = (entries) => {
            let candidates = [...entries];
            let nextLevelStart = 0;
            const normalizedSelected = [];
            const normalizedSelectedLabels = [];
            let pathBecameInvalid = false;

            for (let i = 0; i < selectedTags.length; i += 1) {
                const selected = normalizeTag(selectedTags[i]);
                if (!selected) {
                    continue;
                }
                const existingLabel = String(selectedTagLabels[i] || selectedTags[i] || selected).trim() || selected;
                if (pathBecameInvalid) {
                    normalizedSelected.push(selected);
                    normalizedSelectedLabels.push(existingLabel);
                    continue;
                }
                const branchLevel = findNextBranchLevel(candidates, nextLevelStart);
                if (branchLevel < 0) {
                    pathBecameInvalid = true;
                    candidates = [];
                    normalizedSelected.push(selected);
                    normalizedSelectedLabels.push(existingLabel);
                    continue;
                }
                const choices = getUniqueTagOptionsAtLevel(candidates, branchLevel);
                const choiceMap = new Map(choices.map((item) => [item.key, item.label]));
                if (!choiceMap.has(selected)) {
                    pathBecameInvalid = true;
                    candidates = [];
                    normalizedSelected.push(selected);
                    normalizedSelectedLabels.push(existingLabel);
                    continue;
                }
                candidates = candidates.filter((entry) => entry.tags[branchLevel] === selected);
                normalizedSelected.push(selected);
                normalizedSelectedLabels.push(choiceMap.get(selected) || selected);
                nextLevelStart = branchLevel + 1;
            }

            selectedTags = normalizedSelected;
            selectedTagLabels = normalizedSelectedLabels;

            return { candidates, nextLevelStart };
        };

        const recompute = () => {
            const entries = getCandidateEntries();
            const { candidates, nextLevelStart } = applySelectedPath(entries);

            filteredDeckIdSet = new Set(candidates.map((entry) => entry.deckId));

            const nextBranchLevel = findNextBranchLevel(candidates, nextLevelStart);
            currentSuggestions = nextBranchLevel < 0 ? [] : getUniqueTagOptionsAtLevel(candidates, nextBranchLevel);
        };

        const renderChips = () => {
            const container = ensureChipsContainer();
            if (!container) {
                return;
            }
            if (selectedTags.length === 0) {
                container.classList.add('hidden');
                container.innerHTML = '';
                return;
            }
            container.classList.remove('hidden');
            container.innerHTML = selectedTags.map((tag, index) => {
                const label = String(selectedTagLabels[index] || tag).trim() || tag;
                return `
                <span class="shared-tag-filter-chip">
                    ${escapeHtml(label)}
                    <button type="button" class="shared-tag-filter-chip-remove" data-filter-tag-index="${index}" aria-label="Remove ${escapeHtml(label)}">×</button>
                </span>
            `;
            }).join('');
        };

        const renderSuggestions = () => {
            if (!selectEl) {
                return;
            }
            const placeholderLabel = currentSuggestions.length > 0 ? 'Add filter tag...' : 'No more tag filters';
            isApplyingProgrammaticSelect = true;
            selectEl.innerHTML = [
                `<option value="">${escapeHtml(placeholderLabel)}</option>`,
                ...currentSuggestions.map((option) => (
                    `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`
                )),
            ].join('');
            selectEl.value = '';
            isApplyingProgrammaticSelect = false;
        };

        const commitSelectedOptionAsTag = () => {
            if (!selectEl) {
                return false;
            }
            const next = normalizeTag(selectEl.value);
            if (!next) {
                return false;
            }
            const optionMap = new Map(currentSuggestions.map((item) => [item.key, item.label]));
            if (!optionMap.has(next) || selectedTags.includes(next)) {
                return false;
            }
            selectedTags = [...selectedTags, next];
            selectedTagLabels = [...selectedTagLabels, optionMap.get(next) || next];
            isApplyingProgrammaticSelect = true;
            selectEl.value = '';
            isApplyingProgrammaticSelect = false;
            return true;
        };

        const sync = () => {
            recompute();
            renderChips();
            renderSuggestions();
        };

        const matchesDeck = (deck) => {
            if (!(filteredDeckIdSet instanceof Set)) {
                recompute();
            }
            const deckId = getDeckId(deck);
            if (!Number.isFinite(deckId) || deckId <= 0) {
                return false;
            }
            if (!filteredDeckIdSet.has(deckId)) {
                return false;
            }
            return true;
        };

        const getDisplayLabel = () => selectedTagLabels
            .map((label, index) => String(label || selectedTags[index] || '').trim())
            .filter(Boolean)
            .join(', ');

        const clear = () => {
            selectedTags = [];
            selectedTagLabels = [];
            if (selectEl) {
                isApplyingProgrammaticSelect = true;
                selectEl.value = '';
                isApplyingProgrammaticSelect = false;
                selectEl.focus();
            }
            sync();
            if (onFilterChanged) {
                onFilterChanged();
            }
        };

        const handleChange = () => {
            if (!selectEl || isApplyingProgrammaticSelect) {
                return;
            }
            const committed = commitSelectedOptionAsTag();
            sync();
            if (onFilterChanged) {
                onFilterChanged();
            }
            if (committed && selectEl) {
                selectEl.focus();
            }
        };

        if (selectEl) {
            selectEl.addEventListener('change', handleChange);
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', clear);
        }

        sync();

        return {
            sync,
            clear,
            matchesDeck,
            getDisplayLabel,
            getSelectedTags: () => [...selectedTags],
        };
    },

    applyKidManageTabVisibility(config = {}) {
        const kidId = String(config.kidId || '').trim();
        const normalizeKey = (value) => String(value || '').trim().toLowerCase();
        const toTitleCase = (value) => String(value || '')
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
        const normalizeRoutePath = (value) => {
            const text = String(value || '').trim();
            if (!text || text === '#') {
                return '';
            }
            try {
                return new URL(text, window.location.origin).pathname || '';
            } catch (_) {
                return '';
            }
        };

        const routesByCategory = (config && typeof config.routesByCategory === 'object' && config.routesByCategory)
            ? { ...config.routesByCategory }
            : {};
        const defaultCategoryByRoute = (config && typeof config.defaultCategoryByRoute === 'object' && config.defaultCategoryByRoute)
            ? { ...config.defaultCategoryByRoute }
            : {};
        const rawMetaByKey = (config && typeof config.deckCategoryMetaByKey === 'object' && config.deckCategoryMetaByKey)
            ? config.deckCategoryMetaByKey
            : {};
        const metaByKey = {};
        Object.entries(rawMetaByKey).forEach(([rawKey, rawValue]) => {
            const key = normalizeKey(rawKey);
            const item = rawValue && typeof rawValue === 'object' ? rawValue : {};
            if (!key) {
                return;
            }
            metaByKey[key] = {
                behavior_type: normalizeKey(item.behavior_type),
                has_chinese_specific_logic: Boolean(item.has_chinese_specific_logic),
                display_name: String(item.display_name || '').trim(),
                emoji: String(item.emoji || '').trim(),
            };
        });
        const hasOptedInData = Array.isArray(config.optedInCategoryKeys);
        const rawKeys = hasOptedInData ? config.optedInCategoryKeys : null;
        const normalizedOptedKeys = rawKeys
            ? rawKeys.map(normalizeKey).filter(Boolean)
            : null;
        const normalizedOptedSet = normalizedOptedKeys ? new Set(normalizedOptedKeys) : null;
        const tabNavEl = config.tabNavEl || document.querySelector('.tab-nav');
        const routeToDefaultCategory = {};
        Object.entries(defaultCategoryByRoute).forEach(([rawRoutePath, rawCategoryKey]) => {
            const routePath = normalizeRoutePath(rawRoutePath);
            const categoryKey = normalizeKey(rawCategoryKey);
            if (routePath && categoryKey) {
                routeToDefaultCategory[routePath] = categoryKey;
            }
        });
        const tabsByCategory = {};
        const configuredTabsByCategory = (config && typeof config.tabsByCategory === 'object' && config.tabsByCategory)
            ? config.tabsByCategory
            : {};
        Object.entries(configuredTabsByCategory).forEach(([rawCategoryKey, tabEl]) => {
            const categoryKey = normalizeKey(rawCategoryKey);
            if (!categoryKey || !tabEl || tabsByCategory[categoryKey]) {
                return;
            }
            tabsByCategory[categoryKey] = tabEl;
        });
        if (Object.keys(tabsByCategory).length === 0 && tabNavEl) {
            const discoveredTabs = tabNavEl.querySelectorAll('a.manage-tab');
            discoveredTabs.forEach((tabEl) => {
                const attrCategoryKey = normalizeKey(tabEl.getAttribute('data-category-key'));
                const hrefRoute = normalizeRoutePath(tabEl.getAttribute('href') || tabEl.href || '');
                const defaultCategoryKey = normalizeKey(routeToDefaultCategory[hrefRoute]);
                const categoryKey = attrCategoryKey || defaultCategoryKey;
                if (!categoryKey || tabsByCategory[categoryKey]) {
                    return;
                }
                tabsByCategory[categoryKey] = tabEl;
            });
        }
        const tabEntries = Object.entries(tabsByCategory).map(([rawCategoryKey, tabEl]) => {
            const categoryKey = normalizeKey(rawCategoryKey);
            if (!categoryKey || !tabEl) {
                return null;
            }
            const explicitRoute = normalizeRoutePath(routesByCategory[categoryKey]);
            const hrefRoute = normalizeRoutePath(tabEl.getAttribute('href') || tabEl.href || '');
            const routePath = explicitRoute || hrefRoute;
            return {
                categoryKey,
                tabEl,
                routePath,
            };
        }).filter(Boolean);
        const routeByCategoryFromTabs = {};
        tabEntries.forEach((entry) => {
            if (entry.routePath) {
                routeByCategoryFromTabs[entry.categoryKey] = entry.routePath;
            }
        });
        const resolveRoutePathByCategory = (rawCategoryKey) => {
            const categoryKey = normalizeKey(rawCategoryKey);
            if (!categoryKey) {
                return '';
            }
            const explicitRoute = normalizeRoutePath(routesByCategory[categoryKey]);
            if (explicitRoute) {
                return explicitRoute;
            }
            const categoryMeta = metaByKey[categoryKey] || {};
            const behaviorType = normalizeKey(categoryMeta.behavior_type);
            if (behaviorType === 'type_i') {
                return '/kid-card-manage.html';
            }
            if (behaviorType === 'type_ii') {
                return '/kid-card-manage.html';
            }
            if (behaviorType === 'type_iii') {
                return '/kid-card-manage.html';
            }
            if (behaviorType === 'type_iv') {
                return '/kid-card-manage.html';
            }
            return routeByCategoryFromTabs[categoryKey] || '';
        };
        const getCategoryLabelParts = (rawCategoryKey) => {
            const categoryKey = normalizeKey(rawCategoryKey);
            const categoryMeta = metaByKey[categoryKey] || {};
            const displayName = String(categoryMeta.display_name || '').trim() || toTitleCase(categoryKey);
            const emoji = String(categoryMeta.emoji || '').trim() || '🧩';
            return { emoji, displayName };
        };
        const currentRoutePath = normalizeRoutePath(window.location.pathname);
        const currentQueryCategoryKey = normalizeKey(new URLSearchParams(window.location.search).get('categoryKey'));

        if (!hasOptedInData) {
            return;
        }

        if (Array.isArray(normalizedOptedKeys) && tabNavEl) {
            const keysToRender = [];
            const seen = new Set();
            normalizedOptedKeys.forEach((key) => {
                if (!key || seen.has(key)) {
                    return;
                }
                seen.add(key);
                keysToRender.push(key);
            });
            let currentCategoryKey = currentQueryCategoryKey;
            if (!currentCategoryKey) {
                currentCategoryKey = routeToDefaultCategory[currentRoutePath] || '';
            }
            if (!currentCategoryKey) {
                currentCategoryKey = keysToRender.find((key) => resolveRoutePathByCategory(key) === currentRoutePath) || '';
            }
            if (!currentCategoryKey && keysToRender.length > 0) {
                currentCategoryKey = keysToRender[0];
            }

            const effectiveKidId = kidId || String(new URLSearchParams(window.location.search).get('id') || '').trim();
            const fragment = document.createDocumentFragment();
            keysToRender.forEach((key) => {
                const routePath = resolveRoutePathByCategory(key);
                if (!routePath) {
                    return;
                }
                const anchor = document.createElement('a');
                const isActive = routePath === currentRoutePath && key === currentCategoryKey;
                anchor.className = `${isActive ? 'btn-primary' : 'btn-secondary'} manage-tab`;
                const qs = new URLSearchParams();
                if (effectiveKidId) {
                    qs.set('id', effectiveKidId);
                }
                qs.set('categoryKey', key);
                anchor.href = `${routePath}?${qs.toString()}`;
                const { emoji, displayName } = getCategoryLabelParts(key);
                const subjectIconHtml = (window.DeckCategoryCommon
                    && typeof window.DeckCategoryCommon.renderCategorySubjectIcon === 'function')
                    ? window.DeckCategoryCommon.renderCategorySubjectIcon(key, {
                        size: 20,
                        fallbackEmoji: emoji,
                    })
                    : escapeHtml(emoji);
                anchor.innerHTML = `<span class="manage-tab-emoji">${subjectIconHtml}</span><span class="manage-tab-label">${escapeHtml(displayName)}</span>`;
                anchor.setAttribute('aria-label', displayName);
                anchor.setAttribute('title', displayName);
                fragment.appendChild(anchor);
            });
            const renderedTabCount = fragment.childNodes.length;
            tabNavEl.replaceChildren(fragment);
            tabNavEl.classList.toggle('hidden', renderedTabCount < 2);
            return;
        }

        const routeToCategoryKey = {};
        tabEntries.forEach((entry) => {
            const categoryKey = entry.categoryKey;
            const route = resolveRoutePathByCategory(categoryKey);
            if (!route) {
                return;
            }
            if (normalizedOptedSet && !normalizedOptedSet.has(categoryKey)) {
                return;
            }
            if (!routeToCategoryKey[route]) {
                routeToCategoryKey[route] = categoryKey;
            }
        });
        Object.entries(defaultCategoryByRoute).forEach(([routePath, rawCategoryKey]) => {
            const route = normalizeRoutePath(routePath);
            const categoryKey = normalizeKey(rawCategoryKey);
            if (!route || !categoryKey) {
                return;
            }
            if (normalizedOptedSet && !normalizedOptedSet.has(categoryKey)) {
                return;
            }
            routeToCategoryKey[route] = categoryKey;
        });

        tabEntries.forEach((entry) => {
            const categoryKey = entry.categoryKey;
            const tabEl = entry.tabEl;
            const routePath = resolveRoutePathByCategory(categoryKey);
            const effectiveCategoryKey = routeToCategoryKey[routePath] || '';
            if (kidId) {
                const qs = new URLSearchParams();
                qs.set('id', kidId);
                if (effectiveCategoryKey) {
                    qs.set('categoryKey', effectiveCategoryKey);
                } else {
                    qs.set('categoryKey', String(categoryKey || '').trim().toLowerCase());
                }
                if (routePath) {
                    tabEl.href = `${routePath}?${qs.toString()}`;
                }
            }
            if (normalizedOptedSet) {
                tabEl.classList.toggle('hidden', !effectiveCategoryKey);
            } else {
                tabEl.classList.remove('hidden');
            }
        });
    },

    _validateTestStyleInjected: false,

    _ensureValidateTestStyles() {
        if (this._validateTestStyleInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .validate-test-box {
                margin-top: 0.7rem;
                border: 1px solid #d7deee;
                border-radius: 10px;
                background: #fbfcff;
                padding: 0.7rem 0.8rem;
            }
            .validate-test-box h4 {
                margin: 0 0 0.45rem 0;
                font-size: 0.92rem;
                color: #2f3c7e;
            }
            .validate-test-row {
                display: flex;
                gap: 0.45rem;
                align-items: end;
                flex-wrap: wrap;
            }
            .validate-test-row .form-group {
                flex: 1;
                margin-bottom: 0;
                min-width: 100px;
            }
            .validate-test-row label {
                font-size: 0.82rem;
                color: #555;
                margin-bottom: 0.15rem;
                display: block;
            }
            .validate-test-row input {
                width: 100%;
                padding: 0.4rem 0.55rem;
                border: 1px solid #ccd2e0;
                border-radius: 8px;
                font-size: 0.9rem;
            }
            .validate-test-row button {
                white-space: nowrap;
                flex: 0 0 auto;
            }
            .validate-test-result {
                margin-top: 0.4rem;
                font-size: 0.88rem;
                font-weight: 600;
            }
            .validate-test-result.grade-correct {
                color: #2b8a3e;
            }
            .validate-test-result.grade-half {
                color: #5b3e99;
            }
            .validate-test-result.grade-wrong {
                color: #c92a2a;
            }
        `;
        document.head.appendChild(style);
        this._validateTestStyleInjected = true;
    },

    renderValidateTestBox(containerEl, opts = {}) {
        if (!containerEl) return;
        this._ensureValidateTestStyles();
        const expectedAnswer = typeof opts.getExpectedAnswer === 'function' ? opts.getExpectedAnswer() : '';
        containerEl.innerHTML = `
            <div class="validate-test-box">
                <h4>Test Validate Function</h4>
                <div style="font-size:0.85rem;color:#555;margin-bottom:0.4rem;">Expected answer from generated example: <code>${escapeHtml(expectedAnswer || '(none)')}</code></div>
                <div class="validate-test-row">
                    <div class="form-group">
                        <label>Submitted answer</label>
                        <input type="text" class="validate-test-submitted" placeholder="e.g. 5/6">
                    </div>
                    <button type="button" class="btn-secondary validate-test-btn">Validate</button>
                </div>
                <div class="validate-test-result"></div>
            </div>
        `;
        const btn = containerEl.querySelector('.validate-test-btn');
        const submittedInput = containerEl.querySelector('.validate-test-submitted');
        const resultEl = containerEl.querySelector('.validate-test-result');
        const runValidate = async () => {
            const generatorCode = typeof opts.getGeneratorCode === 'function' ? opts.getGeneratorCode() : '';
            const expected = typeof opts.getExpectedAnswer === 'function' ? opts.getExpectedAnswer() : '';
            const submitted = submittedInput.value.trim();
            if (!submitted) {
                resultEl.textContent = 'Enter a submitted answer.';
                resultEl.className = 'validate-test-result';
                return;
            }
            if (!expected) {
                resultEl.textContent = 'Generate an example first.';
                resultEl.className = 'validate-test-result';
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Testing...';
            resultEl.textContent = '';
            resultEl.className = 'validate-test-result';
            try {
                const apiBase = `${window.location.origin}/api`;
                const response = await fetch(`${apiBase}/shared-decks/type4/test-validate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        generatorCode,
                        submittedAnswer: submitted,
                        expectedAnswer: expected,
                    }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.error || 'Validate test failed');
                }
                const grade = Number(result.grade);
                const label = String(result.label || '');
                if (grade === 1) {
                    resultEl.className = 'validate-test-result grade-correct';
                    resultEl.textContent = `Result: ${label} (grade 1)`;
                } else if (grade === 2) {
                    resultEl.className = 'validate-test-result grade-half';
                    resultEl.textContent = `Result: ${label} (grade 2)`;
                } else {
                    resultEl.className = 'validate-test-result grade-wrong';
                    resultEl.textContent = `Result: ${label} (grade ${grade})`;
                }
            } catch (error) {
                resultEl.className = 'validate-test-result grade-wrong';
                resultEl.textContent = error.message || 'Validate test failed.';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Validate';
            }
        };
        btn.addEventListener('click', runValidate);
        submittedInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); void runValidate(); }
        });
    },

    showOrHideValidateTestBox(containerEl, hasValidate) {
        if (!containerEl) return;
        if (hasValidate) {
            containerEl.classList.remove('hidden');
        } else {
            containerEl.classList.add('hidden');
            containerEl.innerHTML = '';
        }
    },
};
