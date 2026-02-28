function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function parseDateOnly(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
}

function calculateAge(birthday) {
    const today = new Date();
    const birthDate = parseDateOnly(birthday);
    if (!birthDate) return 0;
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

function formatDate(dateString) {
    const date = parseDateOnly(dateString);
    if (!date) return dateString || '-';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function validateBirthday(birthday) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(birthday)) return false;
    const [year, month, day] = birthday.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date > today) return false;
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 150);
    if (date < minDate) return false;
    return true;
}

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
                        <button type="button" class="pwd-btn cancel">Cancel</button>
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
                const aHard = Number.isFinite(a.hardness_score) ? a.hardness_score : -1;
                const bHard = Number.isFinite(b.hardness_score) ? b.hardness_score : -1;
                if (aHard === bHard) {
                    return this.compareQueueOrder(a, b);
                }
                return bHard - aHard;
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

    renderLimitedAvailableDecks(config = {}) {
        const containerEl = config.containerEl || null;
        const emptyEl = config.emptyEl || null;
        if (!containerEl || !emptyEl) {
            return { renderedCount: 0, hiddenCount: 0 };
        }

        const allAvailableDecks = Array.isArray(config.allAvailableDecks) ? config.allAvailableDecks : [];
        const filteredDecks = Array.isArray(config.filteredDecks) ? config.filteredDecks : [];
        const emptyText = String(config.emptyText || 'No shared decks available yet.');
        const filterLabel = String(config.filterLabel || '').trim();
        const getLabel = typeof config.getLabel === 'function'
            ? config.getLabel
            : (deck) => String(deck && deck.name ? deck.name : '');
        const getSuffix = typeof config.getSuffix === 'function'
            ? config.getSuffix
            : (deck) => ` · ${Number(deck && deck.card_count ? deck.card_count : 0)} cards`;
        const bubbleTitle = String(config.bubbleTitle || 'Click to stage opt-in');

        const rawMax = Number.parseInt(String(config.maxVisibleCount ?? 10), 10);
        const maxVisibleCount = Number.isInteger(rawMax) && rawMax > 0 ? rawMax : 10;

        if (allAvailableDecks.length === 0) {
            containerEl.innerHTML = '';
            emptyEl.textContent = emptyText;
            emptyEl.classList.remove('hidden');
            return { renderedCount: 0, hiddenCount: 0 };
        }

        if (filteredDecks.length === 0) {
            containerEl.innerHTML = '';
            emptyEl.textContent = filterLabel
                ? `No available deck matches tag "${filterLabel}".`
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
            return `
                <button
                    type="button"
                    class="deck-bubble"
                    data-deck-id="${deckId}"
                    title="${escapeHtml(bubbleTitle)}"
                >${escapeHtml(label)}${escapeHtml(suffix)}</button>
            `;
        }).join('');

        const moreHtml = hiddenCount > 0
            ? `<span class="deck-bubble deck-bubble-more" title="${hiddenCount} more available deck(s) not shown">...</span>`
            : '';

        containerEl.innerHTML = `${bubbleHtml}${moreHtml}`;
        return { renderedCount: visibleDecks.length, hiddenCount };
    },

    createOptInAllAvailableController(config = {}) {
        const buttonEl = config.buttonEl || null;
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
            buttonEl.textContent = resolvedCount > 0 ? `Opt-in All (${resolvedCount})` : 'Opt-in All';
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
        const onFilterChanged = typeof config.onFilterChanged === 'function' ? config.onFilterChanged : null;

        let selectedTags = [];
        let filteredDeckIdSet = null;
        let currentSuggestions = [];
        let chipsEl = null;
        let isApplyingProgrammaticSelect = false;

        const normalizeTag = (raw) => String(raw || '')
            .trim()
            .toLowerCase()
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

            const parent = selectEl.closest('.available-filter');
            if (parent && parent.parentElement) {
                parent.insertAdjacentElement('afterend', chipsEl);
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
                    const tags = rawTags.map(normalizeTag).filter(Boolean);
                    const deckId = getDeckId(deck);
                    if (!Number.isFinite(deckId) || deckId <= 0 || tags.length === 0) {
                        return null;
                    }
                    return { deck, deckId, tags };
                })
                .filter(Boolean);
        };

        const getUniqueTagsAtLevel = (entries, levelIndex) => {
            const tags = new Set();
            entries.forEach((entry) => {
                const tag = String(entry.tags[levelIndex] || '').trim();
                if (tag) {
                    tags.add(tag);
                }
            });
            return Array.from(tags).sort((a, b) => a.localeCompare(b));
        };

        const findNextBranchLevel = (entries, startLevel) => {
            let level = Math.max(0, Number.parseInt(startLevel, 10) || 0);
            while (level < 64) {
                const uniqueTags = getUniqueTagsAtLevel(entries, level);
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

            for (let i = 0; i < selectedTags.length; i += 1) {
                const selected = normalizeTag(selectedTags[i]);
                if (!selected) {
                    continue;
                }
                const branchLevel = findNextBranchLevel(candidates, nextLevelStart);
                if (branchLevel < 0) {
                    break;
                }
                const choices = getUniqueTagsAtLevel(candidates, branchLevel);
                if (!choices.includes(selected)) {
                    break;
                }
                candidates = candidates.filter((entry) => entry.tags[branchLevel] === selected);
                normalizedSelected.push(selected);
                nextLevelStart = branchLevel + 1;
            }

            if (normalizedSelected.length !== selectedTags.length) {
                selectedTags = normalizedSelected;
            }

            return { candidates, nextLevelStart };
        };

        const recompute = () => {
            const entries = getCandidateEntries();
            const { candidates, nextLevelStart } = applySelectedPath(entries);

            filteredDeckIdSet = new Set(candidates.map((entry) => entry.deckId));

            const nextBranchLevel = findNextBranchLevel(candidates, nextLevelStart);
            currentSuggestions = nextBranchLevel < 0 ? [] : getUniqueTagsAtLevel(candidates, nextBranchLevel);
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
            container.innerHTML = selectedTags.map((tag, index) => `
                <span class="shared-tag-filter-chip">
                    ${escapeHtml(tag)}
                    <button type="button" class="shared-tag-filter-chip-remove" data-filter-tag-index="${index}" aria-label="Remove ${escapeHtml(tag)}">×</button>
                </span>
            `).join('');
        };

        const renderSuggestions = () => {
            if (!selectEl) {
                return;
            }
            const placeholderLabel = currentSuggestions.length > 0 ? 'Add filter tag...' : 'No more tag filters';
            isApplyingProgrammaticSelect = true;
            selectEl.innerHTML = [
                `<option value="">${escapeHtml(placeholderLabel)}</option>`,
                ...currentSuggestions.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`),
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
            if (!currentSuggestions.includes(next) || selectedTags.includes(next)) {
                return false;
            }
            selectedTags = [...selectedTags, next];
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

        const getDisplayLabel = () => [...selectedTags].join(', ');

        const clear = () => {
            selectedTags = [];
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
    }
};
