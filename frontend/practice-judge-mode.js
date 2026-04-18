window.PracticeJudgeMode = (function initPracticeJudgeMode(window) {
    const SELF = 'self';
    const PARENT = 'parent';
    const MULTI = 'multi';
    const MULTI_EN = 'multi_en';

    function normalizeMode(rawMode) {
        const text = String(rawMode || '').trim().toLowerCase();
        if (text === PARENT) {
            return PARENT;
        }
        if (text === MULTI) {
            return MULTI;
        }
        if (text === MULTI_EN) {
            return MULTI_EN;
        }
        return SELF;
    }

    function isSelfMode(mode) {
        return normalizeMode(mode) === SELF;
    }

    function isMultiMode(mode) {
        const m = normalizeMode(mode);
        return m === MULTI || m === MULTI_EN;
    }

    function isMultiEnMode(mode) {
        return normalizeMode(mode) === MULTI_EN;
    }

    function loadMode(storageKey, defaultMode = SELF) {
        try {
            const raw = window.localStorage.getItem(String(storageKey || ''));
            if (!raw) {
                return normalizeMode(defaultMode);
            }
            return normalizeMode(raw);
        } catch (_) {
            return normalizeMode(defaultMode);
        }
    }

    function saveMode(storageKey, mode) {
        const normalized = normalizeMode(mode);
        try {
            window.localStorage.setItem(String(storageKey || ''), normalized);
        } catch (_) {
            // Ignore storage failures.
        }
        return normalized;
    }

    function getRevealJudgeUiState(mode, answerRevealed) {
        const normalized = normalizeMode(mode);
        const selfMode = normalized === SELF;
        const multiMode = normalized === MULTI || normalized === MULTI_EN;
        const multiEnMode = normalized === MULTI_EN;
        const revealed = !!answerRevealed;
        return {
            mode: normalized,
            isSelfMode: selfMode,
            isMultiMode: multiMode,
            isMultiEnMode: multiEnMode,
            showRevealAction: selfMode && !revealed,
            showJudgeActions: (!selfMode && !multiMode) || revealed,
            showMultiChoiceActions: multiMode,
            showBackAnswer: selfMode && revealed,
        };
    }

    function renderToggleGroup(toggleEl, mode) {
        if (!toggleEl) {
            return;
        }
        const normalized = normalizeMode(mode);
        toggleEl.querySelectorAll('[data-judge-mode]').forEach((button) => {
            const buttonMode = normalizeMode(button.getAttribute('data-judge-mode'));
            const active = buttonMode === normalized;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function bindToggleGroup(toggleEl, { getMode, setMode }) {
        if (!toggleEl) {
            return;
        }
        toggleEl.addEventListener('click', (event) => {
            const target = event.target.closest('[data-judge-mode]');
            if (!target) {
                return;
            }
            event.preventDefault();
            const nextMode = normalizeMode(target.getAttribute('data-judge-mode'));
            const currentMode = typeof getMode === 'function' ? normalizeMode(getMode()) : SELF;
            if (nextMode === currentMode) {
                renderToggleGroup(toggleEl, currentMode);
                return;
            }
            if (typeof setMode === 'function') {
                setMode(nextMode);
            }
        });
        renderToggleGroup(toggleEl, typeof getMode === 'function' ? getMode() : SELF);
    }

    return {
        SELF,
        PARENT,
        MULTI,
        MULTI_EN,
        normalizeMode,
        isSelfMode,
        isMultiMode,
        isMultiEnMode,
        loadMode,
        saveMode,
        getRevealJudgeUiState,
        renderToggleGroup,
        bindToggleGroup,
    };
}(window));
