window.PracticeJudgeMode = (function initPracticeJudgeMode(window) {
    const SELF = 'self';
    const PARENT = 'parent';

    function normalizeMode(rawMode) {
        const text = String(rawMode || '').trim().toLowerCase();
        if (text === PARENT) {
            return PARENT;
        }
        return SELF;
    }

    function isSelfMode(mode) {
        return normalizeMode(mode) === SELF;
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
        const selfMode = isSelfMode(mode);
        const revealed = !!answerRevealed;
        return {
            mode: selfMode ? SELF : PARENT,
            isSelfMode: selfMode,
            showRevealAction: selfMode && !revealed,
            showJudgeActions: (!selfMode) || revealed,
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
        normalizeMode,
        isSelfMode,
        loadMode,
        saveMode,
        getRevealJudgeUiState,
        renderToggleGroup,
        bindToggleGroup,
    };
}(window));
