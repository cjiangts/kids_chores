/*
 * kid-practice-core.js — practice runtime bootstrap, shared state, and
 * cross-type lifecycle for the kid-practice page.
 *
 * Type-specific behavior (flashcards, writing prompts, lesson recording,
 * generator problems) lives in kid-practice-type{1,2,3,4}.js. This file
 * owns:
 *   - Module state singletons (`state`, DOM refs, judge-mode helpers)
 *   - URL builders that route requests by current category/scope
 *   - Page setup (title, classes, judge-mode picker, drill toggle)
 *   - Kid info load + ready-state probe
 *   - start/end-session dispatchers (call into type modules)
 *
 * Layout (search for `// === N. ` banners to jump between sections):
 *
 *     1. DOM refs + state singletons
 *     2. Behavior-type predicates + URL builders
 *     3. Page UI (title, type classes, judge-mode + drill toggle)
 *     4. Kid info + ready-state load
 *     5. Session lifecycle (reset/start/end dispatch)
 *     6. Card answer + reveal handlers (judge-mode aware)
 *     7. Result actions + error display
 *     8. Event bindings + DOMContentLoaded
 */

const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const requestedCategoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

const kidNameEl = document.getElementById('kidName');
const startTitle = document.getElementById('startTitle');
const startTitleText = document.getElementById('startTitleText');
const startTitleIcon = document.getElementById('startTitleIcon');

// =====================================================================
// === 1. DOM refs + state singletons
// =====================================================================
function setStartTitle(text) {
    if (startTitleText) {
        startTitleText.textContent = text;
    } else if (startTitle) {
        startTitle.textContent = text;
    }
    if (startTitleIcon) {
        const key = state && state.categoryKey;
        const renderer = window.DeckCategoryCommon && window.DeckCategoryCommon.renderCategorySubjectIcon;
        startTitleIcon.innerHTML = (key && typeof renderer === 'function')
            ? renderer(key, { size: 36 })
            : '';
    }
}
const backToPractice = document.getElementById('backToPractice');
const resultBackToPractice = document.getElementById('resultBackToPractice');
const errorMessage = document.getElementById('errorMessage');
const practiceSection = document.getElementById('practiceSection');
const startScreen = document.getElementById('startScreen');
const sessionScreen = document.getElementById('sessionScreen');
const resultScreen = document.getElementById('resultScreen');
const sessionInfo = document.getElementById('sessionInfo');
const retrySessionBadge = document.getElementById('retrySessionBadge');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const flashcard = document.getElementById('flashcard');
const cardSourceTags = document.getElementById('cardSourceTags');
const cardTitle = document.getElementById('cardTitle');
const cardPage = document.getElementById('cardPage');
const cardQuestion = document.getElementById('cardQuestion');
const promptText = document.getElementById('promptText');
const tapHint = document.getElementById('tapHint');
const promptReplayBtn = document.getElementById('promptReplayBtn');
const thumbDownBtn = document.getElementById('thumbDownBtn');
const cardAnswer = document.getElementById('cardAnswer');
const pauseMask = document.getElementById('pauseMask');
const recordingViz = document.getElementById('recordingViz');
const recordingWave = document.getElementById('recordingWave');
const recordingStatusText = document.getElementById('recordingStatusText');
const reviewAudio = document.getElementById('reviewAudio');
const reviewAudioRow = document.getElementById('reviewAudioRow');
const startBtn = document.getElementById('startBtn');
const finishEarlyBtn = document.getElementById('finishEarlyBtn');
const resultSummary = document.getElementById('resultSummary');
const sessionActionSlot = document.querySelector('.session-action-slot');
const judgeModeRow = document.getElementById('judgeModeRow');
const judgeModeToggleStart = document.getElementById('judgeModeToggleStart');
const drillModeRow = document.getElementById('drillModeRow');
const drillModeToggle = document.getElementById('drillModeToggle');
const knewRow = document.getElementById('knewRow');
const knewBtn = document.getElementById('knewBtn');
const doneRow = document.getElementById('doneRow');
const doneBtn = document.getElementById('doneBtn');
const type4InputRow = document.getElementById('type4InputRow');
const type4AnswerInput = document.getElementById('type4AnswerInput');
const type4AnswerDoneBtn = document.getElementById('type4AnswerDoneBtn');
const multiChoiceRow = document.getElementById('multiChoiceRow');
const multiChoiceGrid = document.getElementById('multiChoiceGrid');
const judgeRow = document.getElementById('judgeRow');
const wrongBtn = document.getElementById('wrongBtn');
const rightBtn = document.getElementById('rightBtn');
const recordRow = document.getElementById('recordRow');
const pauseSessionBtn = document.getElementById('pauseSessionBtn');
const recordBtn = document.getElementById('recordBtn');
const recordBtnLabel = recordBtn.querySelector('.btn-label');
const reviewControls = document.getElementById('reviewControls');
const rerecordBtn = document.getElementById('rerecordBtn');
const continueBtn = document.getElementById('continueBtn');
const bonusGameSection = document.getElementById('bonusGameSection');
const bonusGameHint = document.getElementById('bonusGameHint');
const bonusGameStatus = document.getElementById('bonusGameStatus');
const bonusGameBoard = document.getElementById('bonusGameBoard');

const {
    getDeckCategoryMetaMap,
    getOptedInDeckCategoryKeys,
    getCategoryDisplayName,
    resolveTypeIIPracticeCategoryKey,
    resolveTypeIIIPracticeCategoryKey,
} = window.DeckCategoryCommon || {};
const BEHAVIOR_TYPE_I = 'type_i';
const BEHAVIOR_TYPE_II = 'type_ii';
const BEHAVIOR_TYPE_III = 'type_iii';
const BEHAVIOR_TYPE_IV = 'type_iv';
const VALID_BEHAVIOR_TYPES = new Set([BEHAVIOR_TYPE_I, BEHAVIOR_TYPE_II, BEHAVIOR_TYPE_III, BEHAVIOR_TYPE_IV]);
const JUDGE_MODE_STORAGE_KEY = 'practice_judge_mode_type1';
const TYPE4_MODE_STORAGE_KEY = 'practice_judge_mode_type4';
const TYPE1_MULTIPLE_CHOICE_OPTION_COUNT = 4;
const PRACTICE_NAV_CACHE_KEY = 'kid_practice_nav_cache_v1';
const PRACTICE_NAV_CACHE_TTL_MS = 2 * 60 * 1000;
const DRILL_MIN_DAILY_TARGET = 20;
const DRILL_ACTIVE_BATCH_SIZE = 5;
const DRILL_FAST_CORRECT_NEEDED = 2;
const DRILL_RECENT_GAP = 2;
const DRILL_FALLBACK_SPEED_TARGET_MS = 3000;
const PRACTICE_MODE_DRILL_SUFFIX = '+drill';

const state = {
    currentKid: null,
    categoryKey: requestedCategoryKey,
    categoryDisplayName: '',
    behaviorType: '',
    hasChineseSpecificLogic: false,
    chineseBackContent: '',
    configuredSessionCount: 0,
    readySessionTargetCount: 0,
    readyIsContinueSession: false,
    readyContinueSourceSessionId: null,
    readyContinueCardCount: 0,
    readyIsRetrySession: false,
    readyRetrySourceSessionId: null,
    readyRetryCardCount: 0,
    availableCards: [],
    sessionCards: [],
    activePendingSessionId: null,
    activeIsRetrySession: false,
    currentIndex: 0,
    rightCount: 0,
    wrongCount: 0,
    completedCount: 0,
    answerRevealed: false,
    cardShownAtMs: 0,
    pausedDurationMs: 0,
    pauseStartedAtMs: 0,
    isPaused: false,
    sessionAnswers: [],
    judgeMode: 'self',
    type1MultipleChoiceOptions: [],
    type1MultipleChoicePoolCards: [],
    type1WrongAnswerReview: false,
    type1PromptAudioUsed: false,
    type4MultipleChoiceOptions: [],
    wrongCardsInSession: [],
    bonusSourceCards: [],
    bonusTiles: [],
    bonusSelectedTileIndexes: [],
    bonusMatchedPairCount: 0,
    audioPrimed: false,
    sessionRecordings: {},
    mediaRecorder: null,
    mediaStream: null,
    isRecording: false,
    isRecordingPaused: false,
    isUploadingRecording: false,
    recordingStartedAtMs: 0,
    recordingPauseStartedAtMs: 0,
    recordingChunks: [],
    recordingMimeType: '',
    pendingRecordedBlob: null,
    pendingRecordedMimeType: '',
    pendingRecordedUrl: '',
    isSessionPaused: false,
    resultActionMode: 'back',
    pendingResultEndedEarly: false,
    drillEligible: false,
    drillRequested: false,
    drillActive: false,
    drillTargetAttempts: 0,
    drillAttemptsDone: 0,
    drillSpeedTargetMs: DRILL_FALLBACK_SPEED_TARGET_MS,
    readyDrillSpeedTargetMs: null,
    drillActiveIds: [],
    drillQueueIds: [],
    drillRecentIds: [],
    drillCurrentRoundIds: [],
    drillCardStats: {},
    drillCardIndexById: {},
};

const errorState = { lastMessage: '' };

const promptPlayer = window.WritingAudioSequence.createPlayer({
    preload: 'auto',
    onError: (error) => {
        console.error('Error playing prompt audio:', error);
        const detail = String(error?.message || '').trim();
        showError(detail ? `Failed to play voice prompt: ${detail}` : 'Failed to play voice prompt. Try again.');
    }
});
const recordingVisualizer = window.RecordingVisualizer
    ? new window.RecordingVisualizer({
        fftSize: 512,
        smoothingTimeConstant: 0.88,
        minFrameIntervalMs: 66,
        baselineWidthRatio: 0.02,
        waveWidthRatio: 0.04,
        amplitudeRatio: 0.36,
        getCanvas: () => recordingWave,
        getStatusElement: () => recordingStatusText,
        formatStatus: (elapsedMs) => `Recording... ${window.PracticeUiCommon.formatElapsed(elapsedMs)}`,
        onStart: () => {
            if (recordingViz) {
                recordingViz.classList.remove('hidden');
            }
        },
        onStop: () => {
            if (recordingViz) {
                recordingViz.classList.add('hidden');
            }
            if (recordingStatusText) {
                recordingStatusText.textContent = 'Recording...';
            }
        },
    })
    : null;
const earlyFinishController = window.PracticeUiCommon.createEarlyFinishController({
    button: finishEarlyBtn,
    getHasActiveSession: () => {
        if (!isSessionInProgress()) {
            return false;
        }
        if (state.activeIsRetrySession) {
            return false;
        }
        if (state.drillActive) {
            return false;
        }
        if (isType(BEHAVIOR_TYPE_III)) {
            return !state.isSessionPaused && !state.isRecording && !state.isUploadingRecording;
        }
        return true;
    },
    getTotalCount: () => (
        state.drillActive ? state.drillTargetAttempts : state.sessionCards.length
    ),
    getRecordedCount: () => state.sessionAnswers.length,
    showError: (message) => showError(message),
    onConfirmFinish: () => {
        void endSession(true);
    },
    onCancelBeforeFirstAnswer: () => {
        cancelSessionBeforeFirstAnswer();
    },
});

function cancelSessionBeforeFirstAnswer() {
    if (state.sessionAnswers.length > 0) {
        return;
    }
    window.PracticeSession.clearSessionStart(state.activePendingSessionId);
    state.activePendingSessionId = '';
    state.sessionCards = [];
    window.location.href = `/kid-practice-home.html?id=${kidId}`;
}
// =====================================================================
// === 2. Behavior-type predicates + URL builders
// =====================================================================
function isType(behaviorType) {
    return state.behaviorType === behaviorType;
}

function hasBonusGameForCategory() {
    return isType(BEHAVIOR_TYPE_I) && state.hasChineseSpecificLogic;
}

function withCategoryKey(url) {
    if (state.categoryKey) {
        url.searchParams.set('categoryKey', state.categoryKey);
    }
    return url;
}

function buildType1ApiUrl(pathSuffix) {
    const cleanSuffix = String(pathSuffix || '').replace(/^\/+/, '');
    const url = new URL(`${API_BASE}/kids/${kidId}/cards/${cleanSuffix}`);
    return withCategoryKey(url).toString();
}

function buildType2ApiUrl(path) {
    return window.DeckCategoryCommon.buildType2ApiUrl({
        kidId,
        path,
        categoryKey: state.categoryKey,
        apiBase: API_BASE,
    });
}

function buildType3ApiUrl(pathSuffix) {
    const cleanSuffix = String(pathSuffix || '').replace(/^\/+/, '');
    const url = new URL(`${API_BASE}/kids/${kidId}/lesson-reading/${cleanSuffix}`);
    return withCategoryKey(url).toString();
}

function buildType4ApiUrl(pathSuffix) {
    return window.DeckCategoryCommon.buildKidScopedApiUrl({
        kidId,
        scope: 'type4',
        path: pathSuffix,
        categoryKey: state.categoryKey,
        apiBase: API_BASE,
    });
}

// =====================================================================
// === 3. Page UI (title, type classes, judge-mode + drill toggle)
// =====================================================================
function getCurrentCategoryDisplayName() {
    return String(state.categoryDisplayName || '').trim();
}
function updatePageTitle() {
    const kidName = String(state.currentKid?.name || '').trim();
    const categoryName = getCurrentCategoryDisplayName();
    if (kidName && categoryName) {
        document.title = `${kidName} - ${categoryName} Practice - Kids Daily Chores`;
        return;
    }
    document.title = 'Practice Session - Kids Daily Chores';
}

function isSessionInProgress() {
    return !sessionScreen.classList.contains('hidden')
        && window.PracticeSession.hasActiveSession(state.activePendingSessionId)
        && state.sessionCards.length > 0;
}

function hasActiveSessionScreen() {
    return Boolean(
        sessionScreen
        && !sessionScreen.classList.contains('hidden')
        && window.PracticeSession.hasActiveSession(state.activePendingSessionId)
        && state.sessionCards.length > 0
    );
}
function applyPageTypeClasses() {
    document.body.classList.remove(
        'practice-type-i',
        'practice-type-ii',
        'practice-type-iii',
        'practice-type-iv',
        'type2-chinese-font',
        'type3-chinese-font'
    );
    if (!state.behaviorType) {
        return;
    }
    document.body.classList.add(`practice-${state.behaviorType.replace('_', '-')}`);
    if (isType(BEHAVIOR_TYPE_II) && state.hasChineseSpecificLogic) {
        document.body.classList.add('type2-chinese-font');
    }
    if (isType(BEHAVIOR_TYPE_III) && state.hasChineseSpecificLogic) {
        document.body.classList.add('type3-chinese-font');
    }
}

function hideAllSessionRows() {
    knewRow.classList.add('hidden');
    doneRow.classList.add('hidden');
    type4InputRow.classList.add('hidden');
    multiChoiceRow.classList.add('hidden');
    judgeRow.classList.add('hidden');
    recordRow.classList.add('hidden');
    reviewControls.classList.add('hidden');
    if (sessionActionSlot) {
        sessionActionSlot.classList.remove('multi-choice-active');
    }
}
function usesPracticeModePicker() {
    return isType(BEHAVIOR_TYPE_I) || isType(BEHAVIOR_TYPE_IV);
}

function getJudgeModeButton(mode) {
    return judgeModeToggleStart
        ? judgeModeToggleStart.querySelector(`[data-judge-mode="${mode}"]`)
        : null;
}

function setJudgeModeButtonContent(button, title, description, iconName) {
    if (!button) {
        return;
    }
    const titleEl = button.querySelector('.practice-mode-option-title');
    const descEl = button.querySelector('.practice-mode-option-desc');
    const iconEl = button.querySelector('.practice-mode-option-icon');
    if (titleEl) {
        titleEl.textContent = title;
    }
    if (descEl) {
        descEl.textContent = description;
    }
    if (iconEl && iconName && typeof window.icon === 'function') {
        iconEl.innerHTML = window.icon(iconName, { size: 18, strokeWidth: 2.4 });
    }
}

function configureJudgeModePickerForType() {
    if (!judgeModeToggleStart) {
        return;
    }
    const selfBtn = getJudgeModeButton('self');
    const parentBtn = getJudgeModeButton('parent');
    const multiBtn = getJudgeModeButton('multi');

    if (isType(BEHAVIOR_TYPE_IV)) {
        if (selfBtn) {
            selfBtn.classList.remove('hidden');
        }
        if (parentBtn) {
            parentBtn.classList.add('hidden');
        }
        setJudgeModeButtonContent(
            selfBtn,
            'Type Answer',
            'Kid types the answer. The system grades automatically.',
            'pencil'
        );
        setJudgeModeButtonContent(
            multiBtn,
            'Multiple Choice',
            'Pick one answer. The system grades automatically.',
            'clipboard-list'
        );
        return;
    }

    if (selfBtn) {
        selfBtn.classList.add('hidden');
    }
    if (parentBtn) {
        parentBtn.classList.remove('hidden');
    }
    if (multiBtn) {
        multiBtn.classList.remove('hidden');
    }
    setJudgeModeButtonContent(
        parentBtn,
        'Parent Assist',
        'Parent judges immediately and taps Right or Wrong.',
        'users'
    );
    setJudgeModeButtonContent(
        multiBtn,
        'Multiple Choice',
        'Pick 1 of 4 answers. System grades automatically.',
        'clipboard-list'
    );
}
function isDrillEligibleType() {
    return isType(BEHAVIOR_TYPE_I) && !state.hasChineseSpecificLogic;
}

function shouldOfferDrillMode() {
    if (!isDrillEligibleType()) {
        return false;
    }
    if (state.readyIsContinueSession || state.readyIsRetrySession) {
        return false;
    }
    const target = Number.parseInt(state.configuredSessionCount, 10) || 0;
    return target >= DRILL_MIN_DAILY_TARGET;
}

function setDrillRequested(nextValue) {
    const next = Boolean(nextValue);
    state.drillRequested = next;
    syncDrillModeToggleUi();
    applyDrillModeUiSideEffects();
}

function syncDrillModeToggleUi() {
    if (!drillModeToggle) {
        return;
    }
    const buttons = drillModeToggle.querySelectorAll('[data-drill-mode]');
    buttons.forEach((btn) => {
        const isDrill = btn.getAttribute('data-drill-mode') === 'drill';
        const pressed = isDrill ? state.drillRequested : !state.drillRequested;
        btn.classList.toggle('active', pressed);
        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
}

function applyDrillModeUiSideEffects() {
    updateSessionInfoText();
}

function updateSessionInfoText() {
    if (!sessionInfo) {
        return;
    }
    const baseTarget = state.readyIsContinueSession
        ? state.readyContinueCardCount
        : (state.readyIsRetrySession
            ? state.readyRetryCardCount
            : (state.readySessionTargetCount || state.configuredSessionCount));
    const target = Math.max(0, Number.parseInt(baseTarget, 10) || 0);
    if (state.drillRequested && shouldOfferDrillMode()) {
        const targetMs = Number.parseInt(state.readyDrillSpeedTargetMs, 10);
        const cutoffSec = (
            Number.isFinite(targetMs) && targetMs > 0
                ? targetMs
                : DRILL_FALLBACK_SPEED_TARGET_MS
        ) / 1000;
        sessionInfo.innerHTML = `Speed Drill: <span class="session-info-count">${target}</span> quick questions<br>fast = answer within <span class="session-info-count">${cutoffSec.toFixed(1)}s</span>`;
        return;
    }
    const unit = (isType(BEHAVIOR_TYPE_IV) || (isType(BEHAVIOR_TYPE_I) && !state.hasChineseSpecificLogic))
        ? 'questions'
        : 'cards';
    sessionInfo.innerHTML = `Session: <span class="session-info-count">${target}</span> ${unit}`;
}

function bindDrillModeToggle() {
    if (!drillModeToggle) {
        return;
    }
    drillModeToggle.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-drill-mode]');
        if (!btn) {
            return;
        }
        const next = btn.getAttribute('data-drill-mode') === 'drill';
        setDrillRequested(next);
    });
}

function refreshDrillModeRow() {
    state.drillEligible = shouldOfferDrillMode();
    if (!drillModeRow) {
        return;
    }
    drillModeRow.classList.toggle('hidden', !state.drillEligible);
    if (!state.drillEligible) {
        state.drillRequested = false;
    }
    syncDrillModeToggleUi();
    applyDrillModeUiSideEffects();
}
function configureTypeUi() {
    applyPageTypeClasses();

    judgeModeRow.classList.toggle('hidden', !usesPracticeModePicker());
    configureJudgeModePickerForType();
    refreshDrillModeRow();

    hideAllSessionRows();
    showTypeSpecificCardSections();
    applyType1DisplayMode();
}

function showTypeSpecificCardSections() {
    cardSourceTags.classList.add('hidden');
    cardTitle.classList.add('hidden');
    cardPage.classList.add('hidden');
    cardQuestion.classList.add('hidden');
    promptText.classList.add('hidden');
    tapHint.classList.add('hidden');
    if (promptReplayBtn) {
        promptReplayBtn.classList.add('hidden');
    }
    if (thumbDownBtn) {
        thumbDownBtn.classList.add('hidden');
        thumbDownBtn.classList.remove('is-thumbed');
        thumbDownBtn.disabled = false;
    }
    cardAnswer.classList.add('hidden');
    pauseMask.classList.add('hidden');
    recordingViz.classList.add('hidden');
    reviewAudioRow.classList.add('hidden');

    if (isType(BEHAVIOR_TYPE_I) || isType(BEHAVIOR_TYPE_IV)) {
        cardQuestion.classList.remove('hidden');
    } else if (isType(BEHAVIOR_TYPE_II)) {
        promptText.classList.remove('hidden');
        tapHint.classList.remove('hidden');
    } else if (isType(BEHAVIOR_TYPE_III)) {
        cardSourceTags.classList.remove('hidden');
        cardTitle.classList.remove('hidden');
        cardPage.classList.remove('hidden');
    }
}

function applyType1DisplayMode() {
    const applyChineseMode = (isType(BEHAVIOR_TYPE_I) || isType(BEHAVIOR_TYPE_IV)) && state.hasChineseSpecificLogic;
    cardQuestion.classList.toggle('chinese-text', applyChineseMode);
    cardAnswer.classList.toggle('chinese-text', applyChineseMode);
    flashcard.classList.toggle('chinese-mode', applyChineseMode);
}
function chooseEffectiveCategoryMeta(categoryMetaMap, preferredKey) {
    const normalizedPreferred = String(preferredKey || '').trim().toLowerCase();
    if (normalizedPreferred && categoryMetaMap[normalizedPreferred]) {
        const preferredMeta = categoryMetaMap[normalizedPreferred];
        if (VALID_BEHAVIOR_TYPES.has(String(preferredMeta?.behavior_type || '').trim().toLowerCase())) {
            return { key: normalizedPreferred, meta: preferredMeta };
        }
    }

    const optedInKeys = getOptedInDeckCategoryKeys ? getOptedInDeckCategoryKeys(state.currentKid) : [];
    for (const key of optedInKeys) {
        const meta = categoryMetaMap[key] || {};
        if (VALID_BEHAVIOR_TYPES.has(String(meta?.behavior_type || '').trim().toLowerCase())) {
            return { key, meta };
        }
    }

    const firstMetaEntry = Object.entries(categoryMetaMap).find(([, meta]) => {
        return VALID_BEHAVIOR_TYPES.has(String(meta?.behavior_type || '').trim().toLowerCase());
    });
    if (firstMetaEntry) {
        return { key: firstMetaEntry[0], meta: firstMetaEntry[1] };
    }

    return { key: '', meta: {} };
}

// =====================================================================
// === 4. Kid info + ready-state load
// =====================================================================
function readKidFromPracticeNavigationCache() {
    try {
        const raw = window.sessionStorage.getItem(PRACTICE_NAV_CACHE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        if (String(parsed.kidId || '') !== String(kidId || '')) {
            return null;
        }
        const cachedAtMs = Number(parsed.cachedAtMs || 0);
        if (!Number.isFinite(cachedAtMs) || cachedAtMs <= 0) {
            return null;
        }
        if ((Date.now() - cachedAtMs) > PRACTICE_NAV_CACHE_TTL_MS) {
            return null;
        }
        const kid = parsed.kid;
        if (!kid || typeof kid !== 'object') {
            return null;
        }
        return kid;
    } catch (error) {
        return null;
    }
}
function applyKidInfoPayload(kidPayload) {
    state.currentKid = kidPayload;
    const categoryMetaMap = getDeckCategoryMetaMap ? getDeckCategoryMetaMap(state.currentKid) : {};
    let categoryKey = state.categoryKey;
    if (!categoryKey) {
        const resolvedTypeIII = resolveTypeIIIPracticeCategoryKey
            ? resolveTypeIIIPracticeCategoryKey(state.currentKid, '')
            : '';
        categoryKey = resolvedTypeIII
            || (resolveTypeIIPracticeCategoryKey ? resolveTypeIIPracticeCategoryKey(state.currentKid, '') : '')
            || '';
    }

    const effective = chooseEffectiveCategoryMeta(categoryMetaMap, categoryKey);
    state.categoryKey = effective.key;
    state.behaviorType = String(effective.meta?.behavior_type || '').trim().toLowerCase();
    state.hasChineseSpecificLogic = Boolean(effective.meta?.has_chinese_specific_logic);
    state.chineseBackContent = String(effective.meta?.chinese_back_content || '').trim().toLowerCase();
    state.categoryDisplayName = state.categoryKey
        ? getCategoryDisplayName(state.categoryKey, categoryMetaMap)
        : '';

    if (!state.categoryDisplayName && state.categoryKey) {
        state.categoryDisplayName = state.categoryKey;
    }

    if (!state.categoryKey || !VALID_BEHAVIOR_TYPES.has(state.behaviorType)) {
        throw new Error('No practice subject is available for this kid.');
    }

    kidNameEl.textContent = window.PracticeUiCommon.formatKidPracticeTitle(state.currentKid.name);
    window.PracticeUiCommon.applyKidInitialAvatar(document.getElementById('kidTitleIcon'), state.currentKid);
    setStartTitle(`Ready for ${state.categoryDisplayName}?`);
    updatePageTitle();
}

async function loadKidInfo(options = {}) {
    const preferNavigationCache = Boolean(options?.preferNavigationCache);
    if (preferNavigationCache) {
        const cachedKid = readKidFromPracticeNavigationCache();
        if (cachedKid) {
            try {
                applyKidInfoPayload(cachedKid);
                return;
            } catch (error) {
                // Fall through to network fetch when cache is stale or incomplete.
            }
        }
    }

    const response = await fetch(`${API_BASE}/kids/${kidId}?view=practice_session`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    applyKidInfoPayload(payload);
}

async function loadReadyState() {
    if (isType(BEHAVIOR_TYPE_I)) {
        await loadType1ReadyState();
        return;
    }
    if (isType(BEHAVIOR_TYPE_II)) {
        await loadType2ReadyState();
        return;
    }
    if (isType(BEHAVIOR_TYPE_III)) {
        await loadType3ReadyState();
        return;
    }
    if (isType(BEHAVIOR_TYPE_IV)) {
        await loadType4ReadyState();
    }
}
function resetReadyRetryState() {
    state.readyIsContinueSession = false;
    state.readyContinueSourceSessionId = null;
    state.readyContinueCardCount = 0;
    state.readyIsRetrySession = false;
    state.readyRetrySourceSessionId = null;
    state.readyRetryCardCount = 0;
    state.readySessionTargetCount = 0;
}

function applyReadyRetryState(payload) {
    state.readyIsContinueSession = Boolean(payload?.is_continue_session);
    state.readyContinueSourceSessionId = Number.parseInt(payload?.continue_source_session_id, 10) || null;
    state.readyContinueCardCount = Math.max(0, Number.parseInt(payload?.continue_card_count, 10) || 0);
    state.readyIsRetrySession = Boolean(payload?.is_retry_session);
    state.readyRetrySourceSessionId = Number.parseInt(payload?.retry_source_session_id, 10) || null;
    state.readyRetryCardCount = Math.max(0, Number.parseInt(payload?.retry_card_count, 10) || 0);

    const sourcePracticeMode = String(payload?.source_practice_mode || '').trim().toLowerCase();
    const latestPracticeMode = String(payload?.latest_practice_mode || '').trim().toLowerCase();
    if ((state.readyIsContinueSession || state.readyIsRetrySession) && sourcePracticeMode && sourcePracticeMode !== 'na') {
        applyServerPracticeMode(sourcePracticeMode);
        return;
    }
    if (latestPracticeMode && latestPracticeMode !== 'na') {
        applyServerPracticeMode(latestPracticeMode);
    }
}

function parseServerPracticeMode(rawMode) {
    let text = String(rawMode || '').trim().toLowerCase();
    let drill = false;
    if (text.endsWith(PRACTICE_MODE_DRILL_SUFFIX)) {
        drill = true;
        text = text.slice(0, -PRACTICE_MODE_DRILL_SUFFIX.length);
    }
    return { base: text, drill };
}

function applyServerPracticeMode(serverMode) {
    const { base, drill } = parseServerPracticeMode(serverMode);
    if (drill) {
        state.drillRequested = true;
        syncDrillModeToggleUi();
        applyDrillModeUiSideEffects();
    }
    if (!base || base === 'na') return;
    if (!window.PracticeJudgeMode) return;
    let normalized = window.PracticeJudgeMode.normalizeMode(base);
    if (isType(BEHAVIOR_TYPE_I) && normalized === window.PracticeJudgeMode.SELF) {
        normalized = window.PracticeJudgeMode.PARENT;
    }
    if (normalized === state.judgeMode) return;
    state.judgeMode = normalized;
    const storageKey = isType(BEHAVIOR_TYPE_IV) ? TYPE4_MODE_STORAGE_KEY : JUDGE_MODE_STORAGE_KEY;
    window.PracticeJudgeMode.saveMode(storageKey, normalized);
    syncJudgeModeToggles();
    applyJudgeModeUi();
}
// =====================================================================
// === 5. Session lifecycle (reset/start/end dispatch)
// =====================================================================
function resetBaseSessionState() {
    state.sessionCards = [];
    window.PracticeSession.clearSessionStart(state.activePendingSessionId);
    state.activePendingSessionId = null;
    state.activeIsRetrySession = false;
    state.currentIndex = 0;
    state.rightCount = 0;
    state.wrongCount = 0;
    state.completedCount = 0;
    state.answerRevealed = false;
    state.cardShownAtMs = 0;
    state.pausedDurationMs = 0;
    state.pauseStartedAtMs = 0;
    state.isPaused = false;
    state.sessionAnswers = [];
    state.type1MultipleChoiceOptions = [];
    state.type1MultipleChoicePoolCards = [];
    state.type4MultipleChoiceOptions = [];
    if (type4AnswerInput) {
        type4AnswerInput.value = '';
    }

    state.isSessionPaused = false;
    state.sessionRecordings = {};
    state.recordingChunks = [];
    state.recordingMimeType = '';
    state.isRecording = false;
    state.isRecordingPaused = false;
    state.isUploadingRecording = false;
    state.recordingStartedAtMs = 0;
    state.recordingPauseStartedAtMs = 0;
    state.resultActionMode = 'back';
    state.pendingResultEndedEarly = false;
    resetRecordingState();
    clearPendingRecordingPreview();

    stopAudioPlayback();
    clearAudioBlobCache();

    state.wrongCardsInSession = [];
    resetBonusGame();
    resetDrillSessionState();
}

function resetToStartScreen(totalCards = 0) {
    let target = Math.max(0, Number.parseInt(totalCards, 10) || 0);
    if (state.readyIsContinueSession) {
        target = Math.max(0, Number.parseInt(state.readyContinueCardCount, 10) || 0);
    } else if (state.readyIsRetrySession) {
        target = Math.max(0, Number.parseInt(state.readyRetryCardCount, 10) || 0);
    } else if (isType(BEHAVIOR_TYPE_II)) {
        const practiceTargetByCategory = window.DeckCategoryCommon.getCategoryValueMap(
            state.currentKid?.practiceTargetByDeckCategory
        );
        const sessionCount = state.categoryKey
            ? Number.parseInt(practiceTargetByCategory?.[state.categoryKey], 10)
            : 0;
        target = Math.min(Number.isInteger(sessionCount) ? sessionCount : 0, state.availableCards.length);
    }

    state.readySessionTargetCount = target;
    const unit = (isType(BEHAVIOR_TYPE_IV) || (isType(BEHAVIOR_TYPE_I) && !state.hasChineseSpecificLogic))
        ? 'questions'
        : 'cards';
    sessionInfo.innerHTML = `Session: <span class="session-info-count">${target}</span> ${unit}`;
    refreshDrillModeRow();
    updateSessionInfoText();
    setStartTitle(state.readyIsContinueSession
        ? `Finish ${getCurrentCategoryDisplayName()} Session`
        : (state.readyIsRetrySession
            ? `Retry ${getCurrentCategoryDisplayName()}`
            : `Ready for ${getCurrentCategoryDisplayName()}?`));
    if (retrySessionBadge) {
        retrySessionBadge.classList.toggle('hidden', !(state.readyIsContinueSession || state.readyIsRetrySession));
        const retryItemNoun = isType(BEHAVIOR_TYPE_IV) ? 'questions' : 'cards';
        if (state.readyIsContinueSession) {
            retrySessionBadge.textContent = `Continue Session: finish remaining ${retryItemNoun} from earlier today.`;
        } else if (state.readyIsRetrySession) {
            retrySessionBadge.textContent = `Retry Session: practice only ${retryItemNoun} missed earlier today.`;
        } else {
            retrySessionBadge.textContent = '';
        }
    }

    resetBaseSessionState();

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    setHeaderBackToPracticeVisible(true);

    if (usesPracticeModePicker()) {
        initJudgeMode();
        applyJudgeModeUi();
    }
    const lockModeToggle = (state.readyIsContinueSession || state.readyIsRetrySession) && judgeModeToggleStart;
    if (lockModeToggle) {
        judgeModeToggleStart.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });
    } else if (judgeModeToggleStart) {
        judgeModeToggleStart.querySelectorAll('button').forEach((btn) => { btn.disabled = false; });
    }

    updateFinishEarlyButtonState();
}

function initJudgeMode() {
    if (!usesPracticeModePicker() || !window.PracticeJudgeMode) {
        return;
    }
    const storageKey = isType(BEHAVIOR_TYPE_IV) ? TYPE4_MODE_STORAGE_KEY : JUDGE_MODE_STORAGE_KEY;
    const defaultMode = isType(BEHAVIOR_TYPE_IV)
        ? window.PracticeJudgeMode.SELF
        : window.PracticeJudgeMode.PARENT;
    state.judgeMode = window.PracticeJudgeMode.loadMode(storageKey, defaultMode);
    if (isType(BEHAVIOR_TYPE_IV) && state.judgeMode === window.PracticeJudgeMode.PARENT) {
        state.judgeMode = window.PracticeJudgeMode.SELF;
    }
    if (isType(BEHAVIOR_TYPE_I) && state.judgeMode === window.PracticeJudgeMode.SELF) {
        state.judgeMode = window.PracticeJudgeMode.PARENT;
    }
    const setMode = (nextMode) => {
        let resolvedMode = nextMode;
        if (isType(BEHAVIOR_TYPE_IV) && nextMode === window.PracticeJudgeMode.PARENT) {
            resolvedMode = window.PracticeJudgeMode.SELF;
        }
        if (isType(BEHAVIOR_TYPE_I) && nextMode === window.PracticeJudgeMode.SELF) {
            resolvedMode = window.PracticeJudgeMode.PARENT;
        }
        state.judgeMode = window.PracticeJudgeMode.saveMode(storageKey, resolvedMode);
        syncJudgeModeToggles();
        applyJudgeModeUi();
    };
    const getMode = () => state.judgeMode;
    window.PracticeJudgeMode.bindToggleGroup(judgeModeToggleStart, { getMode, setMode });
    syncJudgeModeToggles();
}

function syncJudgeModeToggles() {
    if (!window.PracticeJudgeMode || !usesPracticeModePicker()) {
        return;
    }
    window.PracticeJudgeMode.renderToggleGroup(judgeModeToggleStart, state.judgeMode);
}

function getJudgeModeUiState() {
    if (!window.PracticeJudgeMode || !isType(BEHAVIOR_TYPE_I)) {
        return {
            isSelfMode: true,
            isMultiMode: false,
            showRevealAction: true,
            showJudgeActions: false,
            showMultiChoiceActions: false,
            showBackAnswer: false,
        };
    }
    return window.PracticeJudgeMode.getRevealJudgeUiState(state.judgeMode, state.answerRevealed);
}
async function startSession() {
    if (isType(BEHAVIOR_TYPE_I)) {
        await startType1Session();
        return;
    }
    if (isType(BEHAVIOR_TYPE_II)) {
        await startType2Session();
        return;
    }
    if (isType(BEHAVIOR_TYPE_III)) {
        await startType3Session();
        return;
    }
    if (isType(BEHAVIOR_TYPE_IV)) {
        await startType4Session();
    }
}
// =====================================================================
// === 6. Card answer + reveal handlers
// =====================================================================
function onFlashcardClick() {
    if (isType(BEHAVIOR_TYPE_I)) {
        togglePauseFromCard();
        return;
    }
    if (isType(BEHAVIOR_TYPE_II)) {
        replayCurrentPrompt();
    }
}
function revealAnswer() {
    if (isType(BEHAVIOR_TYPE_I)) {
        revealType1Answer();
        return;
    }
    if (isType(BEHAVIOR_TYPE_II)) {
        revealType2Answer();
    }
}
function answerCurrentCard(correct) {
    if (isType(BEHAVIOR_TYPE_I)) {
        answerType1Card(correct);
        return;
    }
    if (isType(BEHAVIOR_TYPE_II)) {
        answerType2Card(correct);
    }
}
function applyJudgeModeUi() {
    if (isType(BEHAVIOR_TYPE_IV)) {
        const isMultiMode = shouldUseType4MultipleChoiceUi();
        knewRow.classList.add('hidden');
        doneRow.classList.add('hidden');
        judgeRow.classList.add('hidden');
        recordRow.classList.add('hidden');
        reviewControls.classList.add('hidden');
        type4InputRow.classList.toggle('hidden', isMultiMode);
        multiChoiceRow.classList.toggle('hidden', !isMultiMode);
        if (sessionActionSlot) {
            sessionActionSlot.classList.toggle('multi-choice-active', isMultiMode);
        }
        if (isMultiMode) {
            renderType4MultipleChoiceOptions();
        } else if (multiChoiceGrid) {
            multiChoiceGrid.innerHTML = '';
        }
        if (type4AnswerDoneBtn) {
            type4AnswerDoneBtn.disabled = false;
        }
        return;
    }

    if (!isType(BEHAVIOR_TYPE_I)) {
        return;
    }

    const judgeState = getJudgeModeUiState();
    knewRow.classList.toggle('hidden', !judgeState.showRevealAction);
    doneRow.classList.add('hidden');
    type4InputRow.classList.add('hidden');
    multiChoiceRow.classList.toggle('hidden', !judgeState.showMultiChoiceActions);
    if (sessionActionSlot) {
        sessionActionSlot.classList.toggle('multi-choice-active', judgeState.showMultiChoiceActions);
    }
    recordRow.classList.add('hidden');
    reviewControls.classList.add('hidden');
    judgeRow.classList.toggle('hidden', !judgeState.showJudgeActions);
    if (judgeState.showMultiChoiceActions) {
        if (!state.type1WrongAnswerReview) {
            renderType1MultipleChoiceOptions();
        }
    } else if (multiChoiceGrid) {
        multiChoiceGrid.innerHTML = '';
    }

    if (!state.isPaused && !state.type1WrongAnswerReview) {
        cardAnswer.classList.toggle('hidden', !judgeState.showBackAnswer);
    }
    if (!state.type1WrongAnswerReview) {
        flashcard.classList.toggle('revealed', judgeState.showBackAnswer);
    }
    knewBtn.disabled = state.isPaused || !judgeState.showRevealAction;
    rightBtn.disabled = state.isPaused || !judgeState.showJudgeActions;
    wrongBtn.disabled = state.isPaused || !judgeState.showJudgeActions;
    updatePromptReplayButtonState();
    updateFinishEarlyButtonState();
}
async function endSession(endedEarly = false) {
    if (isType(BEHAVIOR_TYPE_I)) {
        await endType1Session(endedEarly);
        return;
    }
    if (isType(BEHAVIOR_TYPE_II)) {
        await endType2Session(endedEarly);
        return;
    }
    if (isType(BEHAVIOR_TYPE_III)) {
        await endType3Session(endedEarly);
        return;
    }
    if (isType(BEHAVIOR_TYPE_IV)) {
        await endType4Session(endedEarly);
    }
}
function stopAudioPlayback() {
    promptPlayer.stop();
}

function clearAudioBlobCache() {
    promptPlayer.clearCache();
}

function setHeaderBackToPracticeVisible(visible) {
    if (!backToPractice) {
        return;
    }
    backToPractice.classList.toggle('hidden', !visible);
}

function requestEarlyFinish() {
    if (isType(BEHAVIOR_TYPE_III) && state.isSessionPaused) {
        return;
    }
    earlyFinishController.requestFinish();
}

function updateFinishEarlyButtonState() {
    earlyFinishController.updateButtonState();
    if (isType(BEHAVIOR_TYPE_III)) {
        updatePauseSessionButtonState();
        syncSessionPauseLockUi();
    }
}
// =====================================================================
// === 7. Result actions + error display
// =====================================================================
function getUniqueWrongCards(cardsList) {
    const uniqueCards = [];
    const seen = new Set();
    const list = Array.isArray(cardsList) ? cardsList : [];
    list.forEach((card, index) => {
        const front = String(card?.front || '').trim();
        const back = String(card?.back || '').trim();
        if (!front && !back) {
            return;
        }
        const numericId = Number(card?.id);
        const key = Number.isFinite(numericId) ? `id:${numericId}` : `text:${front}::${back}::${index}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        uniqueCards.push({
            pairKey: key,
            front: front || '?',
            back: back || '(answer)',
        });
    });
    return uniqueCards;
}

function setResultBackToPracticeVisible(visible) {
    if (!resultBackToPractice) {
        return;
    }
    resultBackToPractice.classList.toggle('hidden', !visible);
}

function setResultActionMode(mode) {
    const nextMode = mode === 'retry-save' || mode === 'saving' ? mode : 'back';
    state.resultActionMode = nextMode;
    if (!resultBackToPractice) {
        return;
    }
    if (nextMode === 'retry-save') {
        resultBackToPractice.textContent = 'Retry Save';
        resultBackToPractice.href = '#';
        setResultBackToPracticeVisible(true);
        return;
    }
    resultBackToPractice.textContent = '\u2190 Back';
    resultBackToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    setResultBackToPracticeVisible(nextMode === 'back');
}
function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}

// =====================================================================
// === 8. Event bindings + DOMContentLoaded
// =====================================================================
function bindEventHandlers() {
    bindDrillModeToggle();
    startBtn.addEventListener('click', () => {
        void startSession();
    });
    finishEarlyBtn.addEventListener('click', () => {
        requestEarlyFinish();
    });
    flashcard.addEventListener('click', () => {
        onFlashcardClick();
    });
    if (promptReplayBtn) {
        promptReplayBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void replayCurrentPrompt();
        });
    }
    if (thumbDownBtn) {
        thumbDownBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void submitThumbDownForCurrentCard();
        });
    }
    knewBtn.addEventListener('click', () => {
        revealAnswer();
    });
    doneBtn.addEventListener('click', () => {
        revealAnswer();
    });
    if (type4AnswerDoneBtn) {
        type4AnswerDoneBtn.addEventListener('click', () => {
            submitType4TypedAnswer();
        });
    }
    if (type4AnswerInput) {
        type4AnswerInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') {
                return;
            }
            event.preventDefault();
            submitType4TypedAnswer();
        });
        type4AnswerInput.addEventListener('input', syncType4DoneBtnState);
    }
    wrongBtn.addEventListener('click', () => {
        answerCurrentCard(false);
    });
    rightBtn.addEventListener('click', () => {
        answerCurrentCard(true);
    });
    if (multiChoiceGrid) {
        multiChoiceGrid.addEventListener('click', (event) => {
            const nextTarget = event.target.closest('[data-multi-choice-next]');
            if (nextTarget) {
                event.preventDefault();
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                dismissType1WrongAnswerReview();
                return;
            }
            const idkTarget = event.target.closest('[data-multi-choice-idk]');
            if (idkTarget) {
                event.preventDefault();
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                if (isType(BEHAVIOR_TYPE_IV)) {
                    answerType4IDontKnow();
                    return;
                }
                answerType1IDontKnow();
                return;
            }
            const target = event.target.closest('[data-choice-index]');
            if (!target) {
                return;
            }
            event.preventDefault();
            if (document.activeElement) {
                document.activeElement.blur();
            }
            if (isType(BEHAVIOR_TYPE_IV)) {
                answerType4MultipleChoice(target.getAttribute('data-choice-index'));
                return;
            }
            answerType1MultipleChoice(target.getAttribute('data-choice-index'));
        });
    }

    recordBtn.addEventListener('click', () => {
        void toggleRecord();
    });
    pauseSessionBtn.addEventListener('click', () => {
        toggleSessionPause();
    });
    rerecordBtn.addEventListener('click', () => {
        reRecordCurrentCard();
    });
    continueBtn.addEventListener('click', () => {
        void confirmAndNext();
    });
    resultBackToPractice.addEventListener('click', (event) => {
        if (state.resultActionMode === 'saving') {
            event.preventDefault();
            return;
        }
        if (state.resultActionMode === 'retry-save') {
            event.preventDefault();
            showError('');
            void endSession(state.pendingResultEndedEarly);
        }
    });

    bonusGameBoard.addEventListener('click', onBonusGameBoardClick);

    window.addEventListener('beforeunload', (event) => {
        if (!isSessionInProgress()) {
            return;
        }
        event.preventDefault();
        event.returnValue = '';
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    if (window.AudioHistoryCommon) {
        window.AudioHistoryCommon.attachPlayers(reviewAudioRow);
    }

    backToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    setResultActionMode('back');
    setHeaderBackToPracticeVisible(true);
    bindEventHandlers();

    try {
        await loadKidInfo({ preferNavigationCache: true });
        configureTypeUi();
        await loadReadyState();
        if (isType(BEHAVIOR_TYPE_III)) {
            window.addEventListener('resize', fitRecordingCanvas);
        }
    } catch (error) {
        console.error('Error loading practice page:', error);
        practiceSection.classList.add('hidden');
        showError(error.message || 'Failed to load practice page');
        updatePageTitle();
    }
});
