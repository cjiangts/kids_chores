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
const resultStarBadge = document.getElementById('resultStarBadge');
const resultSummary = document.getElementById('resultSummary');
const judgeModeRow = document.getElementById('judgeModeRow');
const judgeModeToggleStart = document.getElementById('judgeModeToggleStart');
const knewRow = document.getElementById('knewRow');
const knewBtn = document.getElementById('knewBtn');
const doneRow = document.getElementById('doneRow');
const doneBtn = document.getElementById('doneBtn');
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
const VALID_BEHAVIOR_TYPES = new Set([BEHAVIOR_TYPE_I, BEHAVIOR_TYPE_II, BEHAVIOR_TYPE_III]);
const JUDGE_MODE_STORAGE_KEY = 'practice_judge_mode_type1';

const state = {
    currentKid: null,
    categoryKey: requestedCategoryKey,
    categoryDisplayName: '',
    behaviorType: '',
    hasChineseSpecificLogic: false,
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
};

const errorState = { lastMessage: '' };

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
    judgeRow.classList.add('hidden');
    recordRow.classList.add('hidden');
    reviewControls.classList.add('hidden');
}

function configureTypeUi() {
    applyPageTypeClasses();

    judgeModeRow.classList.toggle('hidden', !isType(BEHAVIOR_TYPE_I));

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

    if (isType(BEHAVIOR_TYPE_I)) {
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
    const applyChineseMode = isType(BEHAVIOR_TYPE_I) && state.hasChineseSpecificLogic;
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

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${kidId}`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    state.currentKid = await response.json();

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
        applyPageTypeClasses();
        applyType1DisplayMode();
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

    state.isSessionPaused = false;
    state.sessionRecordings = {};
    state.recordingChunks = [];
    state.recordingMimeType = '';
    state.isRecording = false;
    state.isRecordingPaused = false;
    state.isUploadingRecording = false;
    state.recordingStartedAtMs = 0;
    state.recordingPauseStartedAtMs = 0;
    resetRecordingState();
    clearPendingRecordingPreview();

    stopAudioPlayback();
    clearAudioBlobCache();

    state.wrongCardsInSession = [];
    resetBonusGame();
    renderResultStarStrip([]);
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

    if (isType(BEHAVIOR_TYPE_I) && !state.hasChineseSpecificLogic) {
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
        if (state.readyIsContinueSession) {
            retrySessionBadge.textContent = 'Continue Session: finish remaining cards from earlier today.';
        } else if (state.readyIsRetrySession) {
            retrySessionBadge.textContent = 'Retry Session: practice only cards missed earlier today.';
        } else {
            retrySessionBadge.textContent = '';
        }
    }

    resetBaseSessionState();

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');

    if (isType(BEHAVIOR_TYPE_I)) {
        initJudgeMode();
        applyJudgeModeUi();
    }

    updateFinishEarlyButtonState();
}

function initJudgeMode() {
    if (!isType(BEHAVIOR_TYPE_I) || !window.PracticeJudgeMode) {
        return;
    }
    state.judgeMode = window.PracticeJudgeMode.loadMode(
        JUDGE_MODE_STORAGE_KEY,
        window.PracticeJudgeMode.SELF
    );
    const setMode = (nextMode) => {
        state.judgeMode = window.PracticeJudgeMode.saveMode(JUDGE_MODE_STORAGE_KEY, nextMode);
        syncJudgeModeToggles();
        applyJudgeModeUi();
    };
    const getMode = () => state.judgeMode;
    window.PracticeJudgeMode.bindToggleGroup(judgeModeToggleStart, { getMode, setMode });
    syncJudgeModeToggles();
}

function syncJudgeModeToggles() {
    if (!window.PracticeJudgeMode || !isType(BEHAVIOR_TYPE_I)) {
        return;
    }
    window.PracticeJudgeMode.renderToggleGroup(judgeModeToggleStart, state.judgeMode);
}

function getJudgeModeUiState() {
    if (!window.PracticeJudgeMode || !isType(BEHAVIOR_TYPE_I)) {
        return {
            isSelfMode: true,
            showRevealAction: true,
            showJudgeActions: false,
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
    }
}

async function startType1Session() {
    try {
        showError('');
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType1ApiUrl('practice/start'),
            {}
        );
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;

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
            { categoryKey: state.categoryKey }
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
        state.rightCount = 0;
        state.wrongCount = 0;
        state.sessionAnswers = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

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

        showCurrentType3Card();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-III session:', error);
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
    cardQuestion.textContent = card.front;
    cardAnswer.textContent = state.hasChineseSpecificLogic
        ? String(card.back || '').trim()
        : String(card.back || '');

    state.answerRevealed = false;
    state.cardShownAtMs = Date.now();
    state.pausedDurationMs = 0;
    state.pauseStartedAtMs = 0;
    state.isPaused = false;

    setPausedVisual(false);
    applyJudgeModeUi();
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
    cardTitle.textContent = card.front || '';
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
    cardAnswer.classList.toggle('hidden', paused || !judgeState.showBackAnswer);
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

function answerType1Card(correct) {
    const judgeState = getJudgeModeUiState();
    if ((judgeState.isSelfMode && !state.answerRevealed) || state.isPaused || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }

    const card = state.sessionCards[state.currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - state.cardShownAtMs - state.pausedDurationMs);

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
        if (hasBonusGameForCategory()) {
            state.wrongCardsInSession.push({
                id: card.id,
                front: String(card.front || '').trim(),
                back: String(card.back || '').trim(),
            });
        }
    }

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

function applyJudgeModeUi() {
    if (!isType(BEHAVIOR_TYPE_I)) {
        return;
    }

    const judgeState = getJudgeModeUiState();
    knewRow.classList.toggle('hidden', !judgeState.showRevealAction);
    doneRow.classList.add('hidden');
    recordRow.classList.add('hidden');
    reviewControls.classList.add('hidden');
    judgeRow.classList.toggle('hidden', !judgeState.showJudgeActions);

    if (!state.isPaused) {
        cardAnswer.classList.toggle('hidden', !judgeState.showBackAnswer);
    }
    flashcard.classList.toggle('revealed', judgeState.showBackAnswer);
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
    if (!shouldShow) {
        pauseSessionBtn.textContent = 'Pause Session';
        pauseSessionBtn.disabled = true;
        return;
    }
    pauseSessionBtn.textContent = state.isSessionPaused ? 'Resume Session' : 'Pause Session';
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
        showError('Replay or continue this recording, or re-record.');
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
            showError('Could not resume recording. Please re-record this card.');
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
            showError('Failed to resume recording. Please re-record this card.');
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
        tags = ['orphan'];
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
    }
}

async function endType1Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
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
    let achievedGoldStar = state.wrongCount === 0;
    let attemptStarTiers = [achievedGoldStar ? 'gold' : 'silver'];
    let payloadTotalCorrectPercent = null;

    if (hasBonusGameForCategory()) {
        showBonusGameForWrongCards();
    } else {
        resetBonusGame();
    }

    try {
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
        if (Number.isFinite(Number(payload?.total_correct_percentage))) {
            payloadTotalCorrectPercent = Number(payload.total_correct_percentage);
        }
        if (typeof payload?.achieved_gold_star === 'boolean') {
            achievedGoldStar = Boolean(payload.achieved_gold_star);
        }
        const payloadTiers = Array.isArray(payload?.attempt_star_tiers)
            ? payload.attempt_star_tiers
            : [];
        if (payloadTiers.length > 0) {
            attemptStarTiers = payloadTiers;
        } else {
            attemptStarTiers = [endedEarly ? 'half_silver' : 'gold'];
        }
    } catch (error) {
        console.error('Error completing type-I session:', error);
        showError('Failed to save session results');
    }
    renderResultStarStrip(attemptStarTiers, payloadTotalCorrectPercent);

    window.PracticeSession.clearSessionStart(state.activePendingSessionId);
    updateFinishEarlyButtonState();

    try {
        await loadKidInfo();
    } catch (error) {
        console.error('Error refreshing kid info:', error);
    }
}

async function endType2Session(endedEarly = false) {
    stopAudioPlayback();

    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setResultBackToPracticeVisible(true);
    resultSummary.textContent = endedEarly
        ? `Ended early · Right: ${state.rightCount} · Wrong: ${state.wrongCount}`
        : `Right: ${state.rightCount} · Wrong: ${state.wrongCount}`;
    let achievedGoldStar = state.wrongCount === 0;
    let attemptStarTiers = [achievedGoldStar ? 'gold' : 'silver'];
    let payloadTotalCorrectPercent = null;

    try {
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
        if (Number.isFinite(Number(payload?.total_correct_percentage))) {
            payloadTotalCorrectPercent = Number(payload.total_correct_percentage);
        }
        if (typeof payload?.achieved_gold_star === 'boolean') {
            achievedGoldStar = Boolean(payload.achieved_gold_star);
        }
        const payloadTiers = Array.isArray(payload?.attempt_star_tiers)
            ? payload.attempt_star_tiers
            : [];
        if (payloadTiers.length > 0) {
            attemptStarTiers = payloadTiers;
        } else {
            attemptStarTiers = [endedEarly ? 'half_silver' : 'gold'];
        }
    } catch (error) {
        console.error('Error completing type-II session:', error);
        showError('Failed to save session results');
    }
    renderResultStarStrip(attemptStarTiers, payloadTotalCorrectPercent);

    window.PracticeSession.clearSessionStart(state.activePendingSessionId);
    updateFinishEarlyButtonState();

    try {
        await loadKidInfo();
    } catch (error) {
        console.error('Error refreshing kid info:', error);
    }
    clearAudioBlobCache();
}

async function endType3Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setResultBackToPracticeVisible(true);
    state.isSessionPaused = false;
    state.isRecordingPaused = false;
    state.recordingPauseStartedAtMs = 0;
    resultSummary.textContent = endedEarly
        ? `Ended early · Completed: ${state.completedCount} cards`
        : `Completed: ${state.completedCount} cards`;
    renderResultStarStrip([]);

    try {
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
    } catch (error) {
        console.error('Error completing type-III session:', error);
        showError(error.message || 'Failed to save session results');
    }

    window.PracticeSession.clearSessionStart(state.activePendingSessionId);
    updateFinishEarlyButtonState();

    state.sessionRecordings = {};
    try {
        await loadKidInfo();
    } catch (error) {
        console.error('Error refreshing kid info:', error);
    }
}

function stopAudioPlayback() {
    promptPlayer.stop();
}

function clearAudioBlobCache() {
    promptPlayer.clearCache();
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

function renderProgressBadgeByTier(tier, fillPercent) {
    const normalizedTier = String(tier || '').trim().toLowerCase();
    const clampedFill = Number.isFinite(Number(fillPercent))
        ? Math.max(0, Math.min(100, Math.round(Number(fillPercent))))
        : 100;
    if (normalizedTier === 'silver') {
        return '<span class="progress-badge-icon silver" aria-hidden="true" style="--badge-fill-pct:100%"></span>';
    }
    if (normalizedTier === 'half_silver' || clampedFill < 100) {
        return `<span class="progress-badge-icon silver" aria-hidden="true" style="--badge-fill-pct:${clampedFill}%"></span>`;
    }
    return `<span class="progress-badge-icon gold" aria-hidden="true" style="--badge-fill-pct:${clampedFill}%"></span>`;
}

function renderResultStarStrip(starTiers, halfSilverPercent = null) {
    if (!resultStarBadge) {
        return;
    }
    let tiers = Array.isArray(starTiers)
        ? starTiers
            .map((tier) => String(tier || '').trim().toLowerCase())
            .filter((tier) => tier === 'gold' || tier === 'silver' || tier === 'half_silver')
        : [];
    if (tiers.length > 1) {
        tiers = [tiers[tiers.length - 1]];
    }
    const rawHalfSilverPercent = Number.parseFloat(halfSilverPercent);
    const clampedHalfSilverPercent = Number.isFinite(rawHalfSilverPercent)
        ? Math.max(0, Math.min(100, Math.round(rawHalfSilverPercent)))
        : 50;
    if (tiers.length === 0) {
        resultStarBadge.textContent = '';
        resultStarBadge.classList.add('hidden');
        return;
    }
    resultStarBadge.classList.remove('hidden');
    const latestTier = tiers[tiers.length - 1];
    resultStarBadge.innerHTML = `Today: <span class="progress-badge-strip">${renderProgressBadgeByTier(latestTier, clampedHalfSilverPercent)}</span>`;
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
    setResultBackToPracticeVisible(true);
}

function showBonusGameForWrongCards() {
    if (!hasBonusGameForCategory()) {
        resetBonusGame();
        return;
    }
    const wrongCards = getUniqueWrongCards(state.wrongCardsInSession);
    if (wrongCards.length === 0) {
        resetBonusGame();
        return;
    }
    setResultBackToPracticeVisible(false);
    state.bonusSourceCards = wrongCards;
    bonusGameSection.classList.remove('hidden');
    bonusGameHint.textContent = `Tap two boxes to pair each wrong card with its answer (${wrongCards.length} pair${wrongCards.length === 1 ? '' : 's'}).`;
    startBonusGame(wrongCards);
}

function startBonusGame(sourceCards) {
    const cardsList = Array.isArray(sourceCards) ? sourceCards : [];
    const tiles = [];
    cardsList.forEach((card) => {
        const key = String(card.pairKey || '');
        tiles.push({ pairKey: key, side: 'front', text: String(card.front || '?'), matched: false });
        tiles.push({ pairKey: key, side: 'back', text: String(card.back || '(answer)'), matched: false });
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
    wrongBtn.addEventListener('click', () => {
        answerCurrentCard(false);
    });
    rightBtn.addEventListener('click', () => {
        answerCurrentCard(true);
    });

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

    backToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    resultBackToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    bindEventHandlers();

    try {
        await loadKidInfo();
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
