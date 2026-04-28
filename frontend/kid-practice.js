const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const requestedCategoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

const kidNameEl = document.getElementById('kidName');
const startTitle = document.getElementById('startTitle');
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
const cardAnswer = document.getElementById('cardAnswer');
const pauseMask = document.getElementById('pauseMask');
const recordingViz = document.getElementById('recordingViz');
const recordingWave = document.getElementById('recordingWave');
const recordingStatusText = document.getElementById('recordingStatusText');
const reviewAudio = document.getElementById('reviewAudio');
const startBtn = document.getElementById('startBtn');
const finishEarlyBtn = document.getElementById('finishEarlyBtn');
const resultSummary = document.getElementById('resultSummary');
const sessionActionSlot = document.querySelector('.session-action-slot');
const judgeModeRow = document.getElementById('judgeModeRow');
const judgeModeToggleStart = document.getElementById('judgeModeToggleStart');
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

const state = {
    currentKid: null,
    categoryKey: requestedCategoryKey,
    categoryDisplayName: '',
    behaviorType: '',
    hasChineseSpecificLogic: false,
    chineseBackContent: '',
    configuredSessionCount: 0,
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
};

const errorState = { lastMessage: '' };

function getChineseType1BackText(rawBack) {
    return String(rawBack || '').trim();
}

function getChineseType1BackHtml(rawBack) {
    return escapeHtml(getChineseType1BackText(rawBack));
}

const promptPlayer = window.WritingAudioSequence.createPlayer({
    preload: 'auto',
    onError: (error) => {
        console.error('Error playing prompt audio:', error);
        const detail = String(error?.message || '').trim();
        showError(detail ? `Failed to play voice prompt: ${detail}` : 'Failed to play voice prompt. Tap the card to retry.');
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
        if (isType(BEHAVIOR_TYPE_III)) {
            return !state.isSessionPaused && !state.isRecording && !state.isUploadingRecording;
        }
        return true;
    },
    getTotalCount: () => state.sessionCards.length,
    getRecordedCount: () => state.sessionAnswers.length,
    emptyAnswerMessage: 'Complete at least one card before finishing early.',
    showError: (message) => showError(message),
    onConfirmFinish: () => {
        void endSession(true);
    },
});

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

function setJudgeModeButtonContent(button, title, description) {
    if (!button) {
        return;
    }
    const titleEl = button.querySelector('.practice-mode-option-title');
    const descEl = button.querySelector('.practice-mode-option-desc');
    if (titleEl) {
        titleEl.textContent = title;
    }
    if (descEl) {
        descEl.textContent = description;
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
            'Kid types the answer. The system grades automatically.'
        );
        setJudgeModeButtonContent(
            multiBtn,
            'Multiple Choice',
            'Pick one answer. The system grades automatically.'
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
        'Parent judges immediately and taps Right or Wrong.'
    );
    setJudgeModeButtonContent(
        multiBtn,
        'Multiple Choice',
        'Pick 1 of 4 answers. System grades automatically.'
    );
}

function configureTypeUi() {
    applyPageTypeClasses();

    judgeModeRow.classList.toggle('hidden', !usesPracticeModePicker());
    configureJudgeModePickerForType();

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
    cardAnswer.classList.add('hidden');
    pauseMask.classList.add('hidden');
    recordingViz.classList.add('hidden');
    reviewAudio.classList.add('hidden');

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
        throw new Error('No practice category is available for this kid.');
    }

    kidNameEl.textContent = `${state.currentKid.name}'s ${state.categoryDisplayName}`;
    startTitle.textContent = `Ready for ${state.categoryDisplayName}?`;
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
}

function applyReadyRetryState(payload) {
    state.readyIsContinueSession = Boolean(payload?.is_continue_session);
    state.readyContinueSourceSessionId = Number.parseInt(payload?.continue_source_session_id, 10) || null;
    state.readyContinueCardCount = Math.max(0, Number.parseInt(payload?.continue_card_count, 10) || 0);
    state.readyIsRetrySession = Boolean(payload?.is_retry_session);
    state.readyRetrySourceSessionId = Number.parseInt(payload?.retry_source_session_id, 10) || null;
    state.readyRetryCardCount = Math.max(0, Number.parseInt(payload?.retry_card_count, 10) || 0);

    const sourcePracticeMode = String(payload?.source_practice_mode || '').trim().toLowerCase();
    if ((state.readyIsContinueSession || state.readyIsRetrySession) && sourcePracticeMode && sourcePracticeMode !== 'na') {
        applyServerPracticeMode(sourcePracticeMode);
    }
}

function applyServerPracticeMode(serverMode) {
    const mode = String(serverMode || '').trim().toLowerCase();
    if (!mode || mode === 'na') return;
    if (!window.PracticeJudgeMode) return;
    let normalized = window.PracticeJudgeMode.normalizeMode(mode);
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

async function loadType1ReadyState() {
    showError('');
    const decksResponse = await fetch(buildType1ApiUrl('decks'));
    if (!decksResponse.ok) {
        throw new Error(`HTTP ${decksResponse.status}`);
    }

    const decksData = await decksResponse.json();
    resetReadyRetryState();
    applyReadyRetryState(decksData);
    if (typeof decksData?.has_chinese_specific_logic === 'boolean') {
        state.hasChineseSpecificLogic = Boolean(decksData.has_chinese_specific_logic);
        if (typeof decksData?.chinese_back_content === 'string') {
            state.chineseBackContent = String(decksData.chinese_back_content || '').trim().toLowerCase();
        }
        applyPageTypeClasses();
        applyType1DisplayMode();
        configureJudgeModePickerForType();
    }
    state.configuredSessionCount = Number.parseInt(decksData.total_session_count, 10) || 0;
    const deckList = Array.isArray(decksData.decks) ? decksData.decks : [];
    const availableWithConfig = deckList.some((deck) => {
        return Number(deck.total_cards || 0) > 0 && Number(deck.session_count || 0) > 0;
    });
    const itemNoun = state.hasChineseSpecificLogic ? 'cards' : 'questions';
    const targetCount = state.readyIsContinueSession
        ? state.readyContinueCardCount
        : (state.readyIsRetrySession ? state.readyRetryCardCount : state.configuredSessionCount);

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && state.configuredSessionCount <= 0) {
        practiceSection.classList.add('hidden');
        showError(`${getCurrentCategoryDisplayName()} practice is off. Ask your parent to set a session count in Manage ${getCurrentCategoryDisplayName()}.`);
        return;
    }

    if (targetCount <= 0) {
        practiceSection.classList.add('hidden');
        if (state.readyIsContinueSession) {
            showError(`Continue session has no available ${itemNoun} right now. Ask your parent to check deck settings.`);
            return;
        }
        if (state.readyIsRetrySession) {
            showError(`Retry session has no available ${itemNoun} right now. Ask your parent to check deck settings.`);
            return;
        }
        showError(`No ${getCurrentCategoryDisplayName()} ${itemNoun} available for current deck settings.`);
        return;
    }

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && !availableWithConfig) {
        practiceSection.classList.add('hidden');
        showError(`No ${getCurrentCategoryDisplayName()} ${itemNoun} available for current deck settings.`);
        return;
    }

    practiceSection.classList.remove('hidden');
    resetToStartScreen(targetCount);
}

async function loadType2ReadyState() {
    showError('');
    const response = await fetch(buildType2ApiUrl('/cards'));
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    resetReadyRetryState();
    applyReadyRetryState(data);
    state.availableCards = (data.cards || []).filter((card) => card.available_for_practice !== false);
    if (state.readyIsContinueSession && state.readyContinueCardCount <= 0) {
        practiceSection.classList.add('hidden');
        showError('Continue session has no available cards right now. Ask your parent to check deck settings.');
        return;
    }
    if (state.readyIsRetrySession && state.readyRetryCardCount <= 0) {
        practiceSection.classList.add('hidden');
        showError('Retry session has no available cards right now. Ask your parent to check deck settings.');
        return;
    }

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && state.availableCards.length === 0) {
        practiceSection.classList.add('hidden');
        showError(`No ${getCurrentCategoryDisplayName()} cards yet. Ask your parent to add some first.`);
        return;
    }

    practiceSection.classList.remove('hidden');
    resetToStartScreen();
}

async function loadType3ReadyState() {
    showError('');
    const response = await fetch(buildType3ApiUrl('decks'));
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    resetReadyRetryState();
    applyReadyRetryState(data);
    const total = Number.parseInt(data.total_session_count, 10) || 0;
    const deckList = Array.isArray(data.decks) ? data.decks : [];
    const availableWithConfig = deckList.some((deck) => {
        return Number(deck.total_cards || 0) > 0 && Number(deck.session_count || 0) > 0;
    });

    if (total <= 0) {
        practiceSection.classList.add('hidden');
        const label = getCurrentCategoryDisplayName();
        showError(`${label} practice is off. Ask your parent to set a session count in Manage ${label}.`);
        return;
    }

    if (!availableWithConfig) {
        practiceSection.classList.add('hidden');
        showError(`No ${getCurrentCategoryDisplayName()} cards available for current deck settings.`);
        return;
    }

    practiceSection.classList.remove('hidden');
    resetToStartScreen(total);
}

async function loadType4ReadyState() {
    showError('');
    const response = await fetch(buildType4ApiUrl('decks'));
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    resetReadyRetryState();
    applyReadyRetryState(data);
    state.configuredSessionCount = Number.parseInt(data.total_session_count, 10) || 0;
    const deckList = Array.isArray(data.decks) ? data.decks : [];
    const hasOptedInDeck = deckList.some((deck) => Boolean(deck && deck.opted_in));
    const targetCount = state.readyIsContinueSession
        ? state.readyContinueCardCount
        : (state.readyIsRetrySession ? state.readyRetryCardCount : state.configuredSessionCount);

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && !hasOptedInDeck) {
        practiceSection.classList.add('hidden');
        showError(`No ${getCurrentCategoryDisplayName()} decks yet. Ask your parent to opt one in first.`);
        return;
    }

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && state.configuredSessionCount <= 0) {
        practiceSection.classList.add('hidden');
        showError(`${getCurrentCategoryDisplayName()} practice is off. Ask your parent to set deck counts in Manage ${getCurrentCategoryDisplayName()}.`);
        return;
    }

    if (targetCount <= 0) {
        practiceSection.classList.add('hidden');
        if (state.readyIsContinueSession) {
            showError('Continue session has no available questions right now. Ask your parent to check deck counts.');
            return;
        }
        if (state.readyIsRetrySession) {
            showError('Retry session has no available questions right now. Ask your parent to check deck counts.');
            return;
        }
        showError(`No ${getCurrentCategoryDisplayName()} questions available for current deck counts.`);
        return;
    }

    practiceSection.classList.remove('hidden');
    resetToStartScreen(targetCount);
}

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

    if (isType(BEHAVIOR_TYPE_IV) || (isType(BEHAVIOR_TYPE_I) && !state.hasChineseSpecificLogic)) {
        sessionInfo.textContent = `Session: ${target} questions`;
    } else {
        sessionInfo.textContent = `Session: ${target} cards`;
    }
    startTitle.textContent = state.readyIsContinueSession
        ? `Finish ${getCurrentCategoryDisplayName()} Session`
        : (state.readyIsRetrySession
            ? `Retry ${getCurrentCategoryDisplayName()}`
            : `Ready for ${getCurrentCategoryDisplayName()}?`);
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

async function startType1Session() {
    try {
        showError('');
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType1ApiUrl('practice/start'),
            { practiceMode: state.judgeMode || 'parent' }
        );
        applyServerPracticeMode(started?.data?.practice_mode);
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;
        state.type1MultipleChoicePoolCards = Array.isArray(started?.data?.multiple_choice_pool_cards)
            ? started.data.multiple_choice_pool_cards
            : [];

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} ${state.hasChineseSpecificLogic ? 'cards' : 'questions'} available`);
            return;
        }

        state.currentIndex = 0;
        state.rightCount = 0;
        state.wrongCount = 0;
        state.sessionAnswers = [];
        state.wrongCardsInSession = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(true);

        showCurrentQuestion();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-I session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}

async function startType2Session() {
    try {
        showError('');
        primeAudioForAutoplay();
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType2ApiUrl('/practice/start'),
            { categoryKey: state.categoryKey, practiceMode: state.judgeMode || 'self' }
        );
        applyServerPracticeMode(started?.data?.practice_mode);
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} cards available`);
            return;
        }

        state.currentIndex = 0;
        state.rightCount = 0;
        state.wrongCount = 0;
        state.sessionAnswers = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(true);

        showCurrentPrompt();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-II session:', error);
        showError('Failed to start type-II practice session');
    }
}

async function startType3Session() {
    try {
        showError('');
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType3ApiUrl('practice/start'),
            {}
        );
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} cards available`);
            return;
        }

        state.currentIndex = 0;
        state.completedCount = 0;
        state.sessionAnswers = [];
        state.sessionRecordings = {};
        state.recordingChunks = [];
        state.recordingMimeType = '';
        clearPendingRecordingPreview();
        state.isRecording = false;
        state.isRecordingPaused = false;
        state.isUploadingRecording = false;
        state.recordingStartedAtMs = 0;
        state.recordingPauseStartedAtMs = 0;
        state.isSessionPaused = false;

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(true);

        showCurrentType3Card();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-III session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}

async function startType4Session() {
    try {
        showError('');
        const practiceMode = window.PracticeJudgeMode?.isMultiMode(state.judgeMode)
            ? 'multi'
            : 'input';
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType4ApiUrl('practice/start'),
            {
                categoryKey: state.categoryKey,
                practiceMode,
            }
        );
        applyServerPracticeMode(started?.data?.practice_mode);
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} questions available`);
            return;
        }

        state.currentIndex = 0;
        state.rightCount = 0;
        state.wrongCount = 0;
        state.sessionAnswers = [];
        state.type4MultipleChoiceOptions = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(true);

        showCurrentType4Item();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting generator practice session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}

function onFlashcardClick() {
    if (isType(BEHAVIOR_TYPE_I)) {
        togglePauseFromCard();
        return;
    }
    if (isType(BEHAVIOR_TYPE_II)) {
        replayCurrentPrompt();
    }
}

function showCurrentQuestion() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_I)) {
        return;
    }

    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    renderPracticeProgress(
        progress,
        progressFill,
        state.currentIndex + 1,
        state.sessionCards.length,
        'Card'
    );
    if (hasMathNotation(card.front)) {
        cardQuestion.innerHTML = renderMathHtml(card.front);
    } else {
        cardQuestion.textContent = card.front;
    }
    if (state.hasChineseSpecificLogic) {
        cardAnswer.innerHTML = getChineseType1BackHtml(card.back);
    } else {
        cardAnswer.textContent = String(card.back || '');
    }

    state.answerRevealed = false;
    state.type1WrongAnswerReview = false;
    state.cardShownAtMs = Date.now();
    state.pausedDurationMs = 0;
    state.pauseStartedAtMs = 0;
    state.isPaused = false;
    prepareType1MultipleChoiceOptions(card);

    setPausedVisual(false);
    applyJudgeModeUi();
}

function normalizeType1ChoiceText(value) {
    return String(value ?? '').trim();
}

function shuffleCopy(list) {
    const items = Array.isArray(list) ? list.slice() : [];
    if (typeof window.PracticeUiCommon?.shuffleCards === 'function') {
        return window.PracticeUiCommon.shuffleCards(items);
    }
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function buildType1MultipleChoiceOptions(card) {
    const extractChoice = (rawBack) => {
        if (!state.hasChineseSpecificLogic) {
            return rawBack;
        }
        return getChineseType1BackText(rawBack);
    };

    const correctText = normalizeType1ChoiceText(extractChoice(card?.back));
    if (!correctText) {
        return [];
    }

    const sourceCards = Array.isArray(state.type1MultipleChoicePoolCards)
        && state.type1MultipleChoicePoolCards.length > 0
        ? state.type1MultipleChoicePoolCards
        : state.sessionCards;
    const currentCardId = Number.parseInt(card?.id, 10);
    const distractorPool = [];
    sourceCards.forEach((item) => {
        const itemId = Number.parseInt(item?.id, 10);
        if (
            Number.isInteger(currentCardId)
            && currentCardId > 0
            && Number.isInteger(itemId)
            && itemId === currentCardId
        ) {
            return;
        }
        const normalized = normalizeType1ChoiceText(extractChoice(item?.back));
        if (!normalized || normalized === correctText) {
            return;
        }
        distractorPool.push(normalized);
    });

    const distractors = [];
    const seenUnique = new Set();
    const addUniqueDistractor = (text) => {
        const normalized = normalizeType1ChoiceText(text);
        if (!normalized || normalized === correctText || seenUnique.has(normalized)) {
            return;
        }
        seenUnique.add(normalized);
        distractors.push(normalized);
    };
    shuffleCopy(distractorPool).forEach(addUniqueDistractor);
    while (
        distractors.length < (TYPE1_MULTIPLE_CHOICE_OPTION_COUNT - 1)
        && distractorPool.length > 0
    ) {
        const randomIndex = Math.floor(Math.random() * distractorPool.length);
        distractors.push(distractorPool[randomIndex]);
    }
    const options = [
        { text: correctText, isCorrect: true },
        ...distractors
            .slice(0, TYPE1_MULTIPLE_CHOICE_OPTION_COUNT - 1)
            .map((text) => ({ text, isCorrect: false })),
    ];
    return shuffleCopy(options);
}

function buildType1LoggedChoicePayload(options, choice) {
    const submittedAnswer = normalizeType1ChoiceText(choice?.text);
    if (!submittedAnswer) {
        return null;
    }
    const distractorAnswers = [];
    const seen = new Set();
    (Array.isArray(options) ? options : []).forEach((option) => {
        if (!option || option.isCorrect) {
            return;
        }
        const text = normalizeType1ChoiceText(option.text);
        if (!text || seen.has(text)) {
            return;
        }
        seen.add(text);
        distractorAnswers.push(text);
    });
    return {
        submittedAnswer,
        distractorAnswers,
    };
}

function prepareType1MultipleChoiceOptions(card) {
    state.type1MultipleChoiceOptions = buildType1MultipleChoiceOptions(card);
}

function renderType1MultipleChoiceOptions() {
    if (!multiChoiceGrid || !isType(BEHAVIOR_TYPE_I)) {
        return;
    }
    const options = Array.isArray(state.type1MultipleChoiceOptions)
        ? state.type1MultipleChoiceOptions
        : [];
    if (options.length === 0) {
        multiChoiceGrid.innerHTML = '';
        return;
    }
    multiChoiceGrid.innerHTML = options.map((option, index) => {
        return `<button type="button" class="control-btn multi-choice-btn" data-choice-index="${index}"${state.isPaused ? ' disabled' : ''}>${escapeHtml(option.text)}</button>`;
    }).join('');
}

function answerType1MultipleChoice(choiceIndex) {
    if (!isType(BEHAVIOR_TYPE_I) || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }
    if (state.type1WrongAnswerReview) {
        return;
    }
    const index = Number.parseInt(choiceIndex, 10);
    if (!Number.isInteger(index) || index < 0) {
        return;
    }
    const options = Array.isArray(state.type1MultipleChoiceOptions)
        ? state.type1MultipleChoiceOptions
        : [];
    const choice = options[index];
    if (!choice) {
        return;
    }
    const correct = Boolean(choice.isCorrect);
    const loggedChoice = buildType1LoggedChoicePayload(options, choice);
    if (!correct && state.hasChineseSpecificLogic) {
        if (state.isPaused || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
            return;
        }
        recordType1Answer(false, loggedChoice);
        showType1WrongAnswerReview(choice.text);
        return;
    }
    answerType1Card(correct, loggedChoice);
}

function showType1WrongAnswerReview(wrongChoiceText) {
    state.type1WrongAnswerReview = true;
    const card = state.sessionCards[state.currentIndex];
    const correctHtml = getChineseType1BackHtml(card?.back);
    const wrongText = String(wrongChoiceText || '').trim();
    const wrongHtml = wrongText
        ? `<div class="wrong-answer-review"><span class="wrong-answer-review-label">You picked:</span> <span class="wrong-answer-review-text">${escapeHtml(wrongText)}</span> <span class="wrong-answer-review-x">✕</span></div>`
        : '';
    cardAnswer.innerHTML = `${wrongHtml}<div class="correct-answer-review">${correctHtml}</div>`;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    if (multiChoiceGrid) {
        multiChoiceGrid.innerHTML = '<button type="button" class="control-btn multi-choice-btn multi-choice-next-btn" data-multi-choice-next="1">Next</button>';
    }
}

function dismissType1WrongAnswerReview() {
    state.type1WrongAnswerReview = false;
    cardAnswer.classList.add('hidden');
    flashcard.classList.remove('revealed');
    advanceType1Card();
}

function showCurrentPrompt() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_II)) {
        return;
    }

    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    renderPracticeProgress(progress, progressFill, state.currentIndex + 1, state.sessionCards.length, 'Card');
    cardAnswer.textContent = card.back || '';
    cardAnswer.classList.add('hidden');
    flashcard.classList.remove('revealed');

    state.answerRevealed = false;
    doneRow.classList.remove('hidden');
    knewRow.classList.add('hidden');
    judgeRow.classList.add('hidden');
    wrongBtn.disabled = false;
    rightBtn.disabled = false;
    doneBtn.disabled = false;

    state.cardShownAtMs = Date.now();
    playPromptForCard(card);
    prefetchNextPrompt();
}

function showCurrentType3Card() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_III)) {
        return;
    }

    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    renderPracticeProgress(progress, progressFill, state.currentIndex + 1, state.sessionCards.length, 'Card');
    if (hasMathNotation(card.front)) {
        cardTitle.innerHTML = renderMathHtml(card.front);
    } else {
        cardTitle.textContent = card.front || '';
    }
    cardPage.textContent = card.back || '';
    cardSourceTags.textContent = formatType3SourceTags(card);

    clearPendingRecordingPreview();

    recordRow.classList.remove('hidden');
    reviewControls.classList.add('hidden');
    recordBtn.disabled = false;
    setRecordingVisual(false);
    syncSessionPauseLockUi();
    updateFinishEarlyButtonState();
}

function getType4ChoiceOptions(card = null) {
    const sourceCard = card || state.sessionCards[state.currentIndex] || {};
    const rawChoices = Array.isArray(sourceCard.choices) ? sourceCard.choices : [];
    return rawChoices
        .map((choice) => String(choice ?? '').trim())
        .filter(Boolean);
}

function shouldUseType4MultipleChoiceUi(card = null) {
    const sourceCard = card || state.sessionCards[state.currentIndex] || {};
    return Boolean(
        window.PracticeJudgeMode?.isMultiMode(state.judgeMode)
        || sourceCard.isMultichoiceOnly
    );
}

function renderType4MultipleChoiceOptions() {
    if (!multiChoiceGrid || !isType(BEHAVIOR_TYPE_IV)) {
        return;
    }
    const options = Array.isArray(state.type4MultipleChoiceOptions)
        ? state.type4MultipleChoiceOptions
        : [];
    if (options.length === 0) {
        multiChoiceGrid.innerHTML = '';
        return;
    }
    multiChoiceGrid.innerHTML = options.map((text, index) => {
        return `<button type="button" class="control-btn multi-choice-btn" data-choice-index="${index}">${escapeHtml(text)}</button>`;
    }).join('');
}

function showCurrentType4Item() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_IV)) {
        return;
    }

    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    renderPracticeProgress(
        progress,
        progressFill,
        state.currentIndex + 1,
        state.sessionCards.length,
        'Question'
    );
    const questionText = String(card?.front || '');
    const prevAnswers = !shouldUseType4MultipleChoiceUi(card) && Array.isArray(card.previousAnswers)
        ? card.previousAnswers : [];
    const prevGrades = Array.isArray(card.previousGrades) ? card.previousGrades : [];
    if (prevAnswers.length > 0) {
        const hasWrong = prevGrades.some((g) => g === -1);
        const hasHalf = prevGrades.some((g) => g === 2);
        const hasRight = prevGrades.some((g) => g === 1 || g <= -2);
        const legendParts = [];
        if (hasRight) legendParts.push('<span class="prev-answer-right">●</span> right');
        if (hasHalf) legendParts.push('<span class="prev-answer-half">●</span> half');
        if (hasWrong) legendParts.push('<span class="prev-answer-wrong">●</span> wrong');
        const legendHtml = legendParts.length > 0
            ? `<div class="prev-answers-legend">${legendParts.join(' ')}</div>`
            : '';
        const pills = prevAnswers.map((a, i) => {
            const grade = Number(prevGrades[i]);
            let cls = 'prev-answer-wrong';
            if (grade === 1 || grade <= -2) cls = 'prev-answer-right';
            else if (grade === 2) cls = 'prev-answer-half';
            return `<span class="${cls}">${escapeHtml(a)}</span>`;
        }).join(' ');
        cardQuestion.innerHTML = `${renderMathHtml(questionText)}<div class="prev-answers-label">Your previous answers:</div><div class="prev-answers-row">${pills}</div>${legendHtml}`;
    } else {
        if (hasMathNotation(questionText)) {
            cardQuestion.innerHTML = renderMathHtml(questionText);
        } else {
            cardQuestion.textContent = questionText;
        }
    }
    cardAnswer.textContent = '';
    state.answerRevealed = false;
    state.cardShownAtMs = Date.now();
    state.pausedDurationMs = 0;
    state.pauseStartedAtMs = 0;
    state.isPaused = false;
    state.type4MultipleChoiceOptions = getType4ChoiceOptions(card);
    if (type4AnswerInput) {
        type4AnswerInput.value = '';
    }
    syncType4DoneBtnState();
    applyJudgeModeUi();
    if (!shouldUseType4MultipleChoiceUi(card) && type4AnswerInput) {
        window.setTimeout(() => {
            type4AnswerInput.focus();
            type4AnswerInput.select();
        }, 0);
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

function revealType1Answer() {
    if (!isType(BEHAVIOR_TYPE_I)) {
        return;
    }
    if (state.answerRevealed || state.isPaused || state.sessionCards.length === 0) {
        return;
    }

    const judgeState = getJudgeModeUiState();
    if (!judgeState.isSelfMode) {
        return;
    }

    state.answerRevealed = true;
    applyJudgeModeUi();
}

function revealType2Answer() {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    if (state.answerRevealed || !window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }

    state.answerRevealed = true;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    doneRow.classList.add('hidden');
    judgeRow.classList.remove('hidden');
}

function togglePauseFromCard() {
    if (!isType(BEHAVIOR_TYPE_I)) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }

    if (!state.isPaused) {
        state.isPaused = true;
        state.pauseStartedAtMs = Date.now();
        setPausedVisual(true);
        return;
    }

    state.isPaused = false;
    if (state.pauseStartedAtMs > 0) {
        state.pausedDurationMs += Math.max(0, Date.now() - state.pauseStartedAtMs);
    }
    state.pauseStartedAtMs = 0;
    setPausedVisual(false);
}

function setPausedVisual(paused) {
    const judgeState = getJudgeModeUiState();
    cardQuestion.classList.toggle('hidden', paused);
    if (!state.type1WrongAnswerReview) {
        cardAnswer.classList.toggle('hidden', paused || !judgeState.showBackAnswer);
    }
    pauseMask.classList.toggle('hidden', !paused);
    applyJudgeModeUi();
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

function answerType1Card(correct, loggedChoice = null) {
    const judgeState = getJudgeModeUiState();
    if (judgeState.isSelfMode && !state.answerRevealed) {
        return;
    }
    if (state.isPaused || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }
    recordType1Answer(correct, loggedChoice);
    advanceType1Card();
}

function recordType1Answer(correct, loggedChoice = null) {
    const card = state.sessionCards[state.currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - state.cardShownAtMs - state.pausedDurationMs);

    const answerPayload = {
        cardId: card.id,
        known: correct,
        responseTimeMs,
    };
    const submittedAnswer = String(loggedChoice?.submittedAnswer || '').trim();
    if (submittedAnswer) {
        answerPayload.submittedAnswer = submittedAnswer;
        const distractorAnswers = Array.isArray(loggedChoice?.distractorAnswers)
            ? loggedChoice.distractorAnswers
                .map((value) => String(value || '').trim())
                .filter(Boolean)
            : [];
        if (distractorAnswers.length > 0) {
            answerPayload.distractorAnswers = distractorAnswers;
        }
    }
    state.sessionAnswers.push(answerPayload);
    updateFinishEarlyButtonState();

    if (correct) {
        state.rightCount += 1;
    } else {
        state.wrongCount += 1;
        if (hasBonusGameForCategory()) {
            state.wrongCardsInSession.push({
                id: card.id,
                front: String(card.front || '').trim(),
                back: String(card.back || '').trim(),
            });
        }
    }
}

function advanceType1Card() {
    if (state.currentIndex >= state.sessionCards.length - 1) {
        void endSession();
        return;
    }
    state.currentIndex += 1;
    showCurrentQuestion();
}

function answerType2Card(correct) {
    if (!state.answerRevealed || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }

    const card = state.sessionCards[state.currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - state.cardShownAtMs);

    state.sessionAnswers.push({
        cardId: card.id,
        known: correct,
        responseTimeMs,
    });
    updateFinishEarlyButtonState();

    if (correct) {
        state.rightCount += 1;
    } else {
        state.wrongCount += 1;
    }

    if (state.currentIndex >= state.sessionCards.length - 1) {
        void endSession();
        return;
    }

    state.currentIndex += 1;
    showCurrentPrompt();
}

function answerType4Item(submittedAnswer) {
    if (!isType(BEHAVIOR_TYPE_IV) || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }

    const card = state.sessionCards[state.currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - state.cardShownAtMs);
    state.sessionAnswers.push({
        cardId: card.id,
        submittedAnswer: String(submittedAnswer ?? ''),
        responseTimeMs,
    });
    updateFinishEarlyButtonState();

    if (state.currentIndex >= state.sessionCards.length - 1) {
        void endSession();
        return;
    }

    state.currentIndex += 1;
    showCurrentType4Item();
}

function answerType4MultipleChoice(choiceIndex) {
    if (!isType(BEHAVIOR_TYPE_IV)) {
        return;
    }
    const index = Number.parseInt(choiceIndex, 10);
    if (!Number.isInteger(index) || index < 0) {
        return;
    }
    const options = Array.isArray(state.type4MultipleChoiceOptions)
        ? state.type4MultipleChoiceOptions
        : [];
    const selected = options[index];
    if (typeof selected !== 'string') {
        return;
    }
    answerType4Item(selected);
}

function syncType4DoneBtnState() {
    if (type4AnswerDoneBtn && type4AnswerInput) {
        const empty = !type4AnswerInput.value.trim();
        type4AnswerDoneBtn.disabled = empty;
        type4AnswerDoneBtn.style.opacity = empty ? '0.45' : '';
    }
}

function submitType4TypedAnswer() {
    if (!isType(BEHAVIOR_TYPE_IV) || !type4AnswerInput) {
        return;
    }
    if (!type4AnswerInput.value.trim()) {
        return;
    }
    answerType4Item(type4AnswerInput.value);
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
    updateFinishEarlyButtonState();
}

function replayCurrentPrompt() {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }
    const card = state.sessionCards[state.currentIndex];
    playPromptForCard(card);
}

function playPromptForCard(card) {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    const urls = promptPlayer.buildPromptUrls(card);
    if (urls.length === 0) {
        stopAudioPlayback();
        return;
    }
    showError('');
    promptPlayer.playUrls(urls);
}

function primeAudioForAutoplay() {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    if (state.audioPrimed) {
        return;
    }
    try {
        const unlockAudio = new Audio(
            'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
        );
        unlockAudio.play()
            .then(() => {
                unlockAudio.pause();
                unlockAudio.currentTime = 0;
                state.audioPrimed = true;
            })
            .catch(() => {
                // Best-effort only.
            });
    } catch (error) {
        // Best-effort only.
    }
}

function prefetchNextPrompt() {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }
    const nextIndex = state.currentIndex + 1;
    if (nextIndex >= state.sessionCards.length) {
        return;
    }
    const nextCard = state.sessionCards[nextIndex];
    promptPlayer.prefetchCard(nextCard);
}

function updatePauseSessionButtonState() {
    if (!pauseSessionBtn || !isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    const shouldShow = hasActiveSessionScreen() && (state.isRecording || state.isRecordingPaused || state.isSessionPaused);
    pauseSessionBtn.classList.toggle('hidden', !shouldShow);
    const pauseIcon = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4.5" height="14" rx="1"/><rect x="11.5" y="3" width="4.5" height="14" rx="1"/></svg>';
    const playIcon = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><polygon points="4,2 18,10 4,18"/></svg>';
    if (!shouldShow) {
        pauseSessionBtn.innerHTML = pauseIcon;
        pauseSessionBtn.setAttribute('aria-label', 'Pause');
        pauseSessionBtn.setAttribute('title', 'Pause');
        pauseSessionBtn.disabled = true;
        return;
    }
    pauseSessionBtn.innerHTML = state.isSessionPaused ? playIcon : pauseIcon;
    pauseSessionBtn.setAttribute('aria-label', state.isSessionPaused ? 'Resume' : 'Pause');
    pauseSessionBtn.setAttribute('title', state.isSessionPaused ? 'Resume' : 'Pause');
    pauseSessionBtn.disabled = state.isUploadingRecording;
}

function syncSessionPauseLockUi() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }

    const shouldLock = state.isSessionPaused;
    recordBtn.disabled = shouldLock || state.isUploadingRecording;
    if (state.isRecordingPaused) {
        recordBtn.classList.add('recording');
        recordBtn.textContent = 'Recording Paused';
    }
    continueBtn.disabled = shouldLock || state.isUploadingRecording;
    rerecordBtn.disabled = shouldLock || state.isUploadingRecording;
}

async function toggleRecord() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }
    if (state.isSessionPaused || state.isUploadingRecording) {
        return;
    }

    if (state.isRecording) {
        await stopRecordingForReview();
        return;
    }
    if (state.pendingRecordedBlob) {
        showError('Replay or continue this recording, or redo.');
        return;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Recording is not supported in this browser');
            return;
        }

        state.mediaStream = await window.AudioCommon.getMicStream();
        state.mediaRecorder = new MediaRecorder(state.mediaStream, window.AudioCommon.getRecorderOptions());
        state.recordingChunks = [];
        state.recordingMimeType = state.mediaRecorder.mimeType || '';
        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                state.recordingChunks.push(event.data);
            }
        };

        state.mediaRecorder.start(window.AudioCommon.TIMESLICE_MS);
        if (window.AudioCommon && typeof window.AudioCommon.logRecorderDiagnostics === 'function') {
            window.AudioCommon.logRecorderDiagnostics(state.mediaRecorder, state.mediaStream);
        }
        state.recordingStartedAtMs = Date.now();
        state.isRecording = true;
        startRecordingVisualizer(state.mediaStream);
        setRecordingVisual(true);
        showError('');
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting recording:', error);
        showError('Failed to start recording. Please allow microphone access.');
        stopRecordingVisualizer();
        setRecordingVisual(false);
        updateFinishEarlyButtonState();
    }
}

async function stopRecordingForReview() {
    const previousBtnText = recordBtn.textContent;
    recordBtn.disabled = true;
    recordBtn.textContent = 'Stopping...';

    let blob = null;
    let mimeType = 'audio/webm';
    try {
        const recorded = await stopAndCaptureRecording();
        if (recorded) {
            blob = recorded.blob;
            mimeType = recorded.mimeType || mimeType;
        }
    } catch (error) {
        console.error('Error finishing recording:', error);
        showError('Failed to finish recording');
        resetRecordingState();
        recordBtn.disabled = false;
        recordBtn.textContent = previousBtnText;
        updateFinishEarlyButtonState();
        return;
    }

    if (!blob || blob.size === 0) {
        showError('Recording is empty. Please record again.');
        resetRecordingState();
        recordBtn.disabled = false;
        setRecordingVisual(false);
        updateFinishEarlyButtonState();
        return;
    }

    resetRecordingState();

    state.pendingRecordedBlob = blob;
    state.pendingRecordedMimeType = mimeType;
    if (state.pendingRecordedUrl) {
        URL.revokeObjectURL(state.pendingRecordedUrl);
    }
    state.pendingRecordedUrl = URL.createObjectURL(blob);
    reviewAudio.src = state.pendingRecordedUrl;
    reviewAudio.classList.remove('hidden');
    reviewControls.classList.remove('hidden');
    recordRow.classList.add('hidden');
    recordBtn.disabled = false;
    showError('');
    updateFinishEarlyButtonState();
}

function setRecordingVisual(recording) {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }

    recordBtn.classList.toggle('recording', recording);
    if (state.isRecordingPaused) {
        recordBtn.textContent = 'Recording Paused';
    } else {
        recordBtn.textContent = recording ? 'Stop Recording' : 'Start Recording';
    }
    syncSessionPauseLockUi();
    updateFinishEarlyButtonState();
}

function startRecordingVisualizer(stream) {
    if (!recordingVisualizer || !stream || !recordingWave || !recordingViz) {
        return;
    }
    recordingVisualizer.start(stream, {
        startedAtMs: state.recordingStartedAtMs,
        isActive: () => state.isRecording && !state.isRecordingPaused,
    });
}

function stopRecordingVisualizer() {
    if (recordingVisualizer) {
        recordingVisualizer.stop();
    }
}

function fitRecordingCanvas() {
    if (recordingVisualizer) {
        recordingVisualizer.handleResize();
    }
}

async function stopAndCaptureRecording() {
    return new Promise((resolve, reject) => {
        if (!state.mediaRecorder || state.mediaRecorder.state !== 'recording') {
            resolve(null);
            return;
        }

        const recorder = state.mediaRecorder;
        let resolved = false;
        recorder.onstop = () => {
            if (resolved) {
                return;
            }
            resolved = true;
            const finalMimeType = recorder.mimeType || state.recordingMimeType || 'audio/webm';
            const blob = state.recordingChunks.length > 0
                ? new Blob(state.recordingChunks, { type: finalMimeType })
                : null;
            if (state.mediaStream) {
                state.mediaStream.getTracks().forEach((track) => track.stop());
            }
            state.mediaStream = null;
            state.mediaRecorder = null;
            resolve({ blob, mimeType: finalMimeType });
        };
        recorder.onerror = () => {
            if (resolved) {
                return;
            }
            resolved = true;
            if (state.mediaStream) {
                state.mediaStream.getTracks().forEach((track) => track.stop());
            }
            state.mediaStream = null;
            state.mediaRecorder = null;
            reject(new Error('recording failed'));
        };

        const graceMs = Math.max(0, Number(window.AudioCommon?.STOP_GRACE_MS) || 280);
        window.AudioCommon.gracefulStopRecorder(recorder, graceMs).catch((error) => {
            if (!resolved) {
                resolved = true;
                reject(error);
            }
        });
    });
}

function resetRecordingState() {
    state.isRecording = false;
    state.isRecordingPaused = false;
    state.recordingStartedAtMs = 0;
    state.recordingPauseStartedAtMs = 0;
    state.recordingChunks = [];
    state.recordingMimeType = '';
    stopRecordingVisualizer();

    if (isType(BEHAVIOR_TYPE_III)) {
        setRecordingVisual(false);
    }

    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
    }
    state.mediaStream = null;
    state.mediaRecorder = null;
    updateFinishEarlyButtonState();
}

function clearPendingRecordingPreview() {
    state.pendingRecordedBlob = null;
    state.pendingRecordedMimeType = '';

    try {
        reviewAudio.pause();
    } catch (error) {
        // no-op
    }
    reviewAudio.removeAttribute('src');
    reviewAudio.load();
    reviewAudio.classList.add('hidden');

    reviewControls.classList.add('hidden');
    if (isType(BEHAVIOR_TYPE_III)) {
        recordRow.classList.remove('hidden');
        setRecordingVisual(false);
    }

    if (state.pendingRecordedUrl) {
        URL.revokeObjectURL(state.pendingRecordedUrl);
        state.pendingRecordedUrl = '';
    }
    updateFinishEarlyButtonState();
}

function reRecordCurrentCard() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (state.isSessionPaused || state.isUploadingRecording || state.isRecording) {
        return;
    }
    clearPendingRecordingPreview();
    showError('');
}

async function confirmAndNext() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (state.isSessionPaused || state.isRecording || state.isUploadingRecording || !state.pendingRecordedBlob) {
        return;
    }

    const card = state.sessionCards[state.currentIndex];
    state.isUploadingRecording = true;
    updateFinishEarlyButtonState();
    continueBtn.disabled = true;
    rerecordBtn.disabled = true;

    try {
        state.sessionRecordings[String(card.id)] = {
            blob: state.pendingRecordedBlob,
            mimeType: state.pendingRecordedMimeType || 'audio/webm',
        };

        state.sessionAnswers.push({
            cardId: card.id,
            known: true,
        });
        state.completedCount += 1;
        updateFinishEarlyButtonState();

        clearPendingRecordingPreview();

        if (state.currentIndex >= state.sessionCards.length - 1) {
            await endSession();
            return;
        }

        state.currentIndex += 1;
        showCurrentType3Card();
    } catch (error) {
        console.error('Error saving type-III recording:', error);
        showError(error.message || 'Failed to save recording');
    } finally {
        state.isUploadingRecording = false;
        updateFinishEarlyButtonState();
        continueBtn.disabled = false;
        rerecordBtn.disabled = false;
    }
}

function mediaRecorderSupportsPauseResume() {
    return Boolean(
        state.mediaRecorder
        && typeof state.mediaRecorder.pause === 'function'
        && typeof state.mediaRecorder.resume === 'function'
    );
}

async function pauseSession() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (!hasActiveSessionScreen() || state.isSessionPaused || state.isUploadingRecording || !state.isRecording) {
        return;
    }

    if (!mediaRecorderSupportsPauseResume() || state.mediaRecorder.state !== 'recording') {
        showError('Pause during recording is not supported in this browser. Stop recording first.');
        return;
    }

    try {
        state.mediaRecorder.pause();
        state.isRecordingPaused = true;
        state.recordingPauseStartedAtMs = Date.now();
        stopRecordingVisualizer();
        recordingViz.classList.remove('hidden');
        recordingStatusText.textContent = 'Recording paused';
    } catch (error) {
        console.error('Error pausing recording:', error);
        showError('Failed to pause recording.');
        return;
    }

    state.isSessionPaused = true;
    updateFinishEarlyButtonState();
}

function resumeSession() {
    if (!isType(BEHAVIOR_TYPE_III) || !state.isSessionPaused) {
        return;
    }

    if (state.isRecordingPaused) {
        if (!mediaRecorderSupportsPauseResume() || state.mediaRecorder.state !== 'paused') {
            showError('Could not resume recording. Please redo this card.');
            resetRecordingState();
            clearPendingRecordingPreview();
            state.isSessionPaused = false;
            updateFinishEarlyButtonState();
            return;
        }

        try {
            state.mediaRecorder.resume();
            const pausedMs = state.recordingPauseStartedAtMs > 0
                ? Date.now() - state.recordingPauseStartedAtMs
                : 0;
            state.recordingStartedAtMs += Math.max(0, pausedMs);
            state.recordingPauseStartedAtMs = 0;
            state.isRecordingPaused = false;
            startRecordingVisualizer(state.mediaStream);
            setRecordingVisual(true);
        } catch (error) {
            console.error('Error resuming recording:', error);
            showError('Failed to resume recording. Please redo this card.');
            resetRecordingState();
            clearPendingRecordingPreview();
            state.isSessionPaused = false;
            updateFinishEarlyButtonState();
            return;
        }
    }

    state.isSessionPaused = false;
    updateFinishEarlyButtonState();
}

function toggleSessionPause() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (state.isSessionPaused) {
        resumeSession();
        return;
    }
    if (!state.isRecording) {
        return;
    }
    void pauseSession();
}

function formatType3SourceTags(card) {
    if (!card || typeof card !== 'object') {
        return 'Source:';
    }
    const rawTags = Array.isArray(card.source_tags) ? card.source_tags : [];
    let tags = rawTags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean);
    if (tags[0] === state.categoryKey) {
        tags = tags.slice(1);
    }
    if (tags.length === 0 && card.source_is_orphan) {
        tags = ['personal'];
    }
    if (tags.length === 0 && card.deck_name) {
        tags = [String(card.deck_name)];
    }
    return `Source: ${tags.join(' · ')}`;
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

async function endType1Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resetBonusGame();
    resultSummary.textContent = endedEarly ? 'Ended early · Saving results...' : 'Saving results...';

    try {
        showError('');
        const response = await window.PracticeSessionFlow.postCompleteSession(
            buildType1ApiUrl('practice/complete'),
            state.activePendingSessionId,
            state.sessionAnswers,
            { categoryKey: state.categoryKey }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        resultSummary.textContent = state.hasChineseSpecificLogic
            ? (
                endedEarly
                    ? `Ended early · Known: ${state.rightCount} · Need practice: ${state.wrongCount}`
                    : `Known: ${state.rightCount} · Need practice: ${state.wrongCount}`
            )
            : (
                endedEarly
                    ? `Ended early · Right: ${state.rightCount} · Wrong: ${state.wrongCount}`
                    : `Right: ${state.rightCount} · Wrong: ${state.wrongCount}`
            );
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
        if (hasBonusGameForCategory()) {
            showBonusGameForWrongCards();
        } else {
            resetBonusGame();
        }
    } catch (error) {
        console.error('Error completing type-I session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError('Failed to save session results');
        return;
    }

}

async function endType2Session(endedEarly = false) {
    stopAudioPlayback();

    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resultSummary.textContent = endedEarly ? 'Ended early · Saving results...' : 'Saving results...';
    try {
        showError('');
        const response = await window.PracticeSessionFlow.postCompleteSession(
            buildType2ApiUrl('/practice/complete'),
            state.activePendingSessionId,
            state.sessionAnswers,
            { categoryKey: state.categoryKey }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        resultSummary.textContent = endedEarly
            ? `Ended early · Right: ${state.rightCount} · Wrong: ${state.wrongCount}`
            : `Right: ${state.rightCount} · Wrong: ${state.wrongCount}`;
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
    } catch (error) {
        console.error('Error completing type-II session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError('Failed to save session results');
        return;
    }

    clearAudioBlobCache();
}

async function endType3Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.isSessionPaused = false;
    state.isRecordingPaused = false;
    state.recordingPauseStartedAtMs = 0;
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resultSummary.textContent = endedEarly
        ? `Ended early · Saving ${state.completedCount} recordings...`
        : `Saving ${state.completedCount} recordings...`;

    try {
        showError('');
        const payload = window.PracticeSession.buildCompletePayload(
            state.activePendingSessionId,
            state.sessionAnswers,
        );
        const pendingSessionId = String(payload.pendingSessionId || '');

        for (const [cardIdRaw, audio] of Object.entries(state.sessionRecordings)) {
            if (!audio || !audio.blob) {
                continue;
            }
            const cardId = Number.parseInt(cardIdRaw, 10);
            if (!Number.isFinite(cardId)) {
                continue;
            }
            const mimeType = String(audio.mimeType || 'audio/webm');
            const ext = window.AudioCommon.guessExtension(mimeType);
            const formData = new FormData();
            formData.append('pendingSessionId', pendingSessionId);
            formData.append('cardId', String(cardId));
            formData.append('categoryKey', state.categoryKey);
            formData.append('audio', audio.blob, `type3-${state.categoryKey}-${cardId}.${ext}`);

            const uploadRes = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/upload-audio`, {
                method: 'POST',
                body: formData,
            });
            const uploadPayload = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) {
                throw new Error(uploadPayload.error || `Audio upload failed (HTTP ${uploadRes.status})`);
            }
        }

        payload.categoryKey = state.categoryKey;
        const response = await fetch(buildType3ApiUrl('practice/complete'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        resultSummary.textContent = endedEarly
            ? `Ended early · Completed: ${state.completedCount} cards`
            : `Completed: ${state.completedCount} cards`;
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
        state.sessionRecordings = {};
    } catch (error) {
        console.error('Error completing type-III session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError(error.message || 'Failed to save session results');
        return;
    }
}

async function endType4Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resultSummary.textContent = endedEarly
        ? 'Ended early... saving results'
        : 'Saving results...';

    try {
        showError('');
        const response = await window.PracticeSessionFlow.postCompleteSession(
            buildType4ApiUrl('practice/complete'),
            state.activePendingSessionId,
            state.sessionAnswers,
            { categoryKey: state.categoryKey }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        const wrongCount = Number.parseInt(payload?.wrong_count, 10) || 0;
        const partialCount = Number.parseInt(payload?.partial_count, 10) || 0;
        const answeredCount = Number.parseInt(payload?.answer_count, 10) || state.sessionAnswers.length;
        const targetCount = Number.parseInt(payload?.target_answer_count, 10) || answeredCount;
        const isRetry = Boolean(payload?.is_retry_session);
        const displayTotal = isRetry ? answeredCount : targetCount;
        const partialSuffix = partialCount > 0 ? ` · Half: ${partialCount}` : '';
        resultSummary.textContent = endedEarly
            ? `Ended early · Wrong: ${wrongCount} of ${answeredCount} answered${partialSuffix}`
            : `Wrong: ${wrongCount} of ${displayTotal}${partialSuffix}`;
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
    } catch (error) {
        console.error('Error completing generator session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError('Failed to save session results');
        return;
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

function resetBonusGame() {
    state.bonusSourceCards = [];
    state.bonusTiles = [];
    state.bonusSelectedTileIndexes = [];
    state.bonusMatchedPairCount = 0;
    bonusGameSection.classList.add('hidden');
    bonusGameHint.textContent = '';
    bonusGameStatus.textContent = '';
    bonusGameBoard.innerHTML = '';
    setResultActionMode(state.resultActionMode);
}

function showBonusGameForWrongCards() {
    if (!hasBonusGameForCategory()) {
        resetBonusGame();
        return;
    }
    let wrongCards = getUniqueWrongCards(state.wrongCardsInSession);
    if (wrongCards.length === 0) {
        resetBonusGame();
        return;
    }
    // Cap at 10 pairs so the board isn't overwhelming; pick a random subset
    const MAX_BONUS_PAIRS = 10;
    if (wrongCards.length > MAX_BONUS_PAIRS) {
        wrongCards = window.PracticeUiCommon.shuffleCards([...wrongCards]).slice(0, MAX_BONUS_PAIRS);
    }
    setResultBackToPracticeVisible(false);
    state.bonusSourceCards = wrongCards;
    bonusGameSection.classList.remove('hidden');
    bonusGameHint.textContent = `Tap two boxes to match each missed card with its correct answer (${wrongCards.length} pair${wrongCards.length === 1 ? '' : 's'}).`;
    startBonusGame(wrongCards);
}

function startBonusGame(sourceCards) {
    const cardsList = Array.isArray(sourceCards) ? sourceCards : [];
    const tiles = [];
    cardsList.forEach((card) => {
        const key = String(card.pairKey || '');
        tiles.push({ pairKey: key, side: 'front', text: String(card.front || '?'), matched: false });
        let backText;
        if (state.hasChineseSpecificLogic) {
            backText = getChineseType1BackText(card.back) || '(answer)';
        } else {
            backText = String(card.back || '(answer)');
        }
        tiles.push({
            pairKey: key,
            side: 'back',
            text: backText,
            matched: false,
        });
    });
    state.bonusTiles = window.PracticeUiCommon.shuffleCards(tiles);
    state.bonusSelectedTileIndexes = [];
    state.bonusMatchedPairCount = 0;
    renderBonusGameBoard();
    renderBonusGameStatus();
}

function renderBonusGameBoard() {
    bonusGameBoard.innerHTML = state.bonusTiles.map((tile, index) => {
        const isSelected = state.bonusSelectedTileIndexes.includes(index);
        const classes = [
            'bonus-tile',
            isSelected ? 'selected' : '',
            tile.matched ? 'matched' : '',
            state.hasChineseSpecificLogic ? 'chinese-text' : '',
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-bonus-index="${index}"${tile.matched ? ' disabled' : ''}>${escapeHtml(tile.text)}</button>`;
    }).join('');
}

function renderBonusGameStatus() {
    const pairTotal = state.bonusSourceCards.length;
    if (pairTotal <= 0) {
        bonusGameStatus.textContent = '';
        setResultBackToPracticeVisible(true);
        return;
    }
    if (state.bonusMatchedPairCount >= pairTotal) {
        bonusGameStatus.textContent = `Great job! Matched all ${pairTotal} pair${pairTotal === 1 ? '' : 's'}.`;
        setResultBackToPracticeVisible(true);
        return;
    }
    bonusGameStatus.textContent = `Matched ${state.bonusMatchedPairCount} / ${pairTotal}`;
    setResultBackToPracticeVisible(false);
}

function onBonusGameBoardClick(event) {
    if (!hasBonusGameForCategory()) {
        return;
    }
    const tileBtn = event.target.closest('[data-bonus-index]');
    if (!tileBtn) {
        return;
    }
    const tileIndex = Number.parseInt(tileBtn.getAttribute('data-bonus-index'), 10);
    if (!Number.isInteger(tileIndex)) {
        return;
    }
    const tile = state.bonusTiles[tileIndex];
    if (!tile || tile.matched) {
        return;
    }
    if (state.bonusSelectedTileIndexes.includes(tileIndex)) {
        return;
    }
    if (state.bonusSelectedTileIndexes.length >= 2) {
        return;
    }

    state.bonusSelectedTileIndexes.push(tileIndex);
    renderBonusGameBoard();

    if (state.bonusSelectedTileIndexes.length < 2) {
        return;
    }

    const [firstIndex, secondIndex] = state.bonusSelectedTileIndexes;
    const firstTile = state.bonusTiles[firstIndex];
    const secondTile = state.bonusTiles[secondIndex];
    const isMatch = firstTile && secondTile
        && firstTile.pairKey === secondTile.pairKey
        && firstTile.side !== secondTile.side;

    if (isMatch) {
        firstTile.matched = true;
        secondTile.matched = true;
        state.bonusMatchedPairCount += 1;
        state.bonusSelectedTileIndexes = [];
        renderBonusGameBoard();
        renderBonusGameStatus();
        return;
    }

    setTimeout(() => {
        state.bonusSelectedTileIndexes = [];
        renderBonusGameBoard();
    }, 450);
}

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}

function bindEventHandlers() {
    startBtn.addEventListener('click', () => {
        void startSession();
    });
    finishEarlyBtn.addEventListener('click', () => {
        requestEarlyFinish();
    });
    flashcard.addEventListener('click', () => {
        onFlashcardClick();
    });
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

    backToPractice.addEventListener('click', (event) => {
        if (!isSessionInProgress()) {
            return;
        }
        const confirmed = window.confirm('Go back now? Your current session progress will be lost.');
        if (!confirmed) {
            event.preventDefault();
            return;
        }
        stopAudioPlayback();
        resetRecordingState();
        clearPendingRecordingPreview();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    if (window.SimpleAudioPlayer && reviewAudio) {
        window.SimpleAudioPlayer.wrapAudio(reviewAudio);
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
