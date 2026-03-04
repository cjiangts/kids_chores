const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const categoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();
const {
    buildCategoryDisplayName,
    getDeckCategoryMetaMap,
} = window.DeckCategoryCommon;

const kidNameEl = document.getElementById('kidName');
const backToPractice = document.getElementById('backToPractice');
const resultBackToPractice = document.getElementById('resultBackToPractice');
const errorMessage = document.getElementById('errorMessage');
const practiceSection = document.getElementById('practiceSection');
const startScreen = document.getElementById('startScreen');
const sessionScreen = document.getElementById('sessionScreen');
const resultScreen = document.getElementById('resultScreen');
const sessionInfo = document.getElementById('sessionInfo');
const startTitle = document.getElementById('startTitle');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const flashcard = document.getElementById('flashcard');
const cardQuestion = document.getElementById('cardQuestion');
const cardAnswer = document.getElementById('cardAnswer');
const pauseMask = document.getElementById('pauseMask');
const knewBtn = document.getElementById('knewBtn');
const knewRow = document.getElementById('knewRow');
const judgeRow = document.getElementById('judgeRow');
const wrongBtn = document.getElementById('wrongBtn');
const rightBtn = document.getElementById('rightBtn');
const finishEarlyBtn = document.getElementById('finishEarlyBtn');
const resultSummary = document.getElementById('resultSummary');
const judgeModeToggleStart = document.getElementById('judgeModeToggleStart');
const bonusGameSection = document.getElementById('bonusGameSection');
const bonusGameHint = document.getElementById('bonusGameHint');
const bonusGameStatus = document.getElementById('bonusGameStatus');
const bonusGameBoard = document.getElementById('bonusGameBoard');
const bonusReplayBtn = document.getElementById('bonusReplayBtn');

let currentKid = null;
let sessionCards = [];
let activePendingSessionId = null;
let currentIndex = 0;
let rightCount = 0;
let wrongCount = 0;
let answerRevealed = false;
let cardShownAtMs = 0;
let pausedDurationMs = 0;
let pauseStartedAtMs = 0;
let isPaused = false;
let sessionAnswers = [];
let configuredSessionCount = 0;
let judgeMode = 'self';
let currentCategoryDisplayName = 'Practice';
let hasChineseSpecificLogic = false;
let wrongCardsInSession = [];
let bonusSourceCards = [];
let bonusTiles = [];
let bonusSelectedTileIndexes = [];
let bonusMatchedPairCount = 0;
const JUDGE_MODE_STORAGE_KEY = 'practice_judge_mode_type1';
const errorState = { lastMessage: '' };
const earlyFinishController = window.PracticeUiCommon.createEarlyFinishController({
    button: finishEarlyBtn,
    getHasActiveSession: () => (
        window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0
    ),
    getTotalCount: () => sessionCards.length,
    getRecordedCount: () => sessionAnswers.length,
    emptyAnswerMessage: 'Answer at least one question before finishing early.',
    showError: (message) => showError(message),
    onConfirmFinish: () => {
        void endSession(true);
    },
});

function withCategoryKey(url) {
    if (categoryKey) {
        url.searchParams.set('categoryKey', categoryKey);
    }
    return url;
}

function buildType1ApiUrl(pathSuffix) {
    const cleanSuffix = String(pathSuffix || '').replace(/^\/+/, '');
    const url = new URL(`${API_BASE}/kids/${kidId}/cards/${cleanSuffix}`);
    return withCategoryKey(url).toString();
}

function getCurrentCategoryDisplayName() {
    return String(currentCategoryDisplayName || '').trim() || buildCategoryDisplayName(categoryKey);
}

function hasBonusGameForCategory() {
    return categoryKey === 'chinese_characters';
}

function applyType1DisplayMode() {
    cardQuestion.classList.toggle('chinese-text', hasChineseSpecificLogic);
    cardAnswer.classList.toggle('chinese-text', hasChineseSpecificLogic);
    flashcard.classList.toggle('chinese-mode', hasChineseSpecificLogic);
}


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }
    if (!categoryKey) {
        showError('Missing deck category. Open this page from Practice Home.');
        practiceSection.classList.add('hidden');
        return;
    }

    backToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    resultBackToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    backToPractice.addEventListener('click', (event) => {
        if (isSessionInProgress()) {
            const confirmed = window.confirm('Go back now? Your current session progress will be lost.');
            if (!confirmed) {
                event.preventDefault();
            }
        }
    });
    await loadKidInfo();
    if (hasBonusGameForCategory() && bonusGameBoard) {
        bonusGameBoard.addEventListener('click', onBonusGameBoardClick);
    }
    if (hasBonusGameForCategory() && bonusReplayBtn) {
        bonusReplayBtn.addEventListener('click', () => {
            if (bonusSourceCards.length > 0) {
                startBonusGame(bonusSourceCards);
            }
        });
    }
    initJudgeMode();
    await loadType1PracticeReadyState();
});

function isSessionInProgress() {
    return !sessionScreen.classList.contains('hidden')
        && window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0;
}


async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        currentKid = await response.json();
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const categoryMeta = categoryMetaMap[categoryKey] || {};
        hasChineseSpecificLogic = Boolean(categoryMeta && categoryMeta.has_chinese_specific_logic);
        const displayName = String(categoryMeta && categoryMeta.display_name ? categoryMeta.display_name : '').trim()
            || buildCategoryDisplayName(categoryKey);
        currentCategoryDisplayName = displayName;
        kidNameEl.textContent = `${currentKid.name}'s ${displayName}`;
        if (startTitle) {
            startTitle.textContent = `Ready for ${displayName}?`;
        }
        applyType1DisplayMode();
    } catch (error) {
        console.error('Error loading kid info:', error);
        showError('Failed to load kid information');
    }
}


async function loadType1PracticeReadyState() {
    try {
        showError('');
        const decksResponse = await fetch(buildType1ApiUrl('decks'));
        if (!decksResponse.ok) {
            throw new Error(`HTTP ${decksResponse.status}`);
        }

        const decksData = await decksResponse.json();
        if (typeof decksData?.has_chinese_specific_logic === 'boolean') {
            hasChineseSpecificLogic = Boolean(decksData.has_chinese_specific_logic);
            applyType1DisplayMode();
        }
        configuredSessionCount = Number.parseInt(decksData.total_session_count, 10) || 0;
        const deckList = Array.isArray(decksData.decks) ? decksData.decks : [];
        const availableWithConfig = deckList.some((deck) => (Number(deck.total_cards || 0) > 0) && (Number(deck.session_count || 0) > 0));
        const itemNoun = hasChineseSpecificLogic ? 'cards' : 'questions';

        if (configuredSessionCount <= 0) {
            practiceSection.classList.add('hidden');
            showError(`${getCurrentCategoryDisplayName()} practice is off. Ask your parent to set a session count in Manage ${getCurrentCategoryDisplayName()}.`);
            return;
        }

        if (!availableWithConfig) {
            practiceSection.classList.add('hidden');
            showError(`No ${getCurrentCategoryDisplayName()} ${itemNoun} available for current deck settings.`);
            return;
        }

        practiceSection.classList.remove('hidden');
        resetToStartScreen(configuredSessionCount);
    } catch (error) {
        console.error('Error preparing type-1 practice:', error);
        showError(`Failed to load ${getCurrentCategoryDisplayName()} practice data`);
    }
}


function resetToStartScreen(totalCards) {
    const target = Math.max(0, Number.parseInt(totalCards, 10) || 0);
    sessionInfo.textContent = hasChineseSpecificLogic
        ? `Session: ${target} cards`
        : `Session: ${target} questions`;

    sessionCards = [];
    window.PracticeSession.clearSessionStart(activePendingSessionId);
    activePendingSessionId = null;
    currentIndex = 0;
    rightCount = 0;
    wrongCount = 0;
    answerRevealed = false;
    wrongCardsInSession = [];
    resetBonusGame();

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    updateFinishEarlyButtonState();
}

function initJudgeMode() {
    if (!window.PracticeJudgeMode) {
        return;
    }
    judgeMode = window.PracticeJudgeMode.loadMode(JUDGE_MODE_STORAGE_KEY, window.PracticeJudgeMode.SELF);
    const setMode = (nextMode) => {
        judgeMode = window.PracticeJudgeMode.saveMode(JUDGE_MODE_STORAGE_KEY, nextMode);
        syncJudgeModeToggles();
        applyJudgeModeUi();
    };
    const getMode = () => judgeMode;
    window.PracticeJudgeMode.bindToggleGroup(judgeModeToggleStart, { getMode, setMode });
    syncJudgeModeToggles();
}

function syncJudgeModeToggles() {
    if (!window.PracticeJudgeMode) {
        return;
    }
    window.PracticeJudgeMode.renderToggleGroup(judgeModeToggleStart, judgeMode);
}

function getJudgeModeUiState() {
    if (!window.PracticeJudgeMode) {
        return {
            isSelfMode: true,
            showRevealAction: true,
            showJudgeActions: false,
            showBackAnswer: false,
        };
    }
    return window.PracticeJudgeMode.getRevealJudgeUiState(judgeMode, answerRevealed);
}


async function startSession() {
    try {
        showError('');
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType1ApiUrl('practice/start'),
            {}
        );
        activePendingSessionId = started.pendingSessionId;
        sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
            showError(`No ${getCurrentCategoryDisplayName()} ${hasChineseSpecificLogic ? 'cards' : 'questions'} available`);
            return;
        }

        currentIndex = 0;
        rightCount = 0;
        wrongCount = 0;
        sessionAnswers = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

        showCurrentQuestion();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-1 session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}


function showCurrentQuestion() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentIndex];
    renderPracticeProgress(
        progress,
        progressFill,
        currentIndex + 1,
        sessionCards.length,
        hasChineseSpecificLogic ? 'Card' : 'Question',
    );
    cardQuestion.textContent = card.front;
    cardAnswer.textContent = hasChineseSpecificLogic
        ? String(card.back || '').trim()
        : String(card.back || '');

    answerRevealed = false;

    cardShownAtMs = Date.now();
    pausedDurationMs = 0;
    pauseStartedAtMs = 0;
    isPaused = false;
    setPausedVisual(false);
}

function revealAnswer() {
    if (answerRevealed || isPaused || sessionCards.length === 0) {
        return;
    }
    const state = getJudgeModeUiState();
    if (!state.isSelfMode) {
        return;
    }

    answerRevealed = true;
    applyJudgeModeUi();
}


function togglePauseFromCard() {
    if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }

    if (!isPaused) {
        isPaused = true;
        pauseStartedAtMs = Date.now();
        setPausedVisual(true);
        return;
    }

    isPaused = false;
    if (pauseStartedAtMs > 0) {
        pausedDurationMs += Math.max(0, Date.now() - pauseStartedAtMs);
    }
    pauseStartedAtMs = 0;
    setPausedVisual(false);
}


function setPausedVisual(paused) {
    const state = getJudgeModeUiState();
    cardQuestion.classList.toggle('hidden', paused);
    cardAnswer.classList.toggle('hidden', paused || !state.showBackAnswer);
    pauseMask.classList.toggle('hidden', !paused);
    applyJudgeModeUi();
}


function answerCurrentCard(correct) {
    const state = getJudgeModeUiState();
    if ((state.isSelfMode && !answerRevealed) || isPaused || !window.PracticeSession.hasActiveSession(activePendingSessionId)) {
        return;
    }

    const card = sessionCards[currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - cardShownAtMs - pausedDurationMs);

    sessionAnswers.push({
        cardId: card.id,
        known: correct,
        responseTimeMs,
    });
    updateFinishEarlyButtonState();

    if (correct) {
        rightCount += 1;
    } else {
        wrongCount += 1;
        if (hasBonusGameForCategory()) {
            wrongCardsInSession.push({
                id: card.id,
                front: String(card.front || '').trim(),
                back: String(card.back || '').trim(),
            });
        }
    }

    if (currentIndex >= sessionCards.length - 1) {
        endSession();
        return;
    }

    currentIndex += 1;
    showCurrentQuestion();
}

function updateFinishEarlyButtonState() {
    earlyFinishController.updateButtonState();
}

function requestEarlyFinish() {
    earlyFinishController.requestFinish();
}

function applyJudgeModeUi() {
    const state = getJudgeModeUiState();
    knewRow.classList.toggle('hidden', !state.showRevealAction);
    judgeRow.classList.toggle('hidden', !state.showJudgeActions);
    if (!isPaused) {
        cardAnswer.classList.toggle('hidden', !state.showBackAnswer);
    }
    flashcard.classList.toggle('revealed', state.showBackAnswer);
    knewBtn.disabled = isPaused || !state.showRevealAction;
    rightBtn.disabled = isPaused || !state.showJudgeActions;
    wrongBtn.disabled = isPaused || !state.showJudgeActions;
    updateFinishEarlyButtonState();
}


async function endSession(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = hasChineseSpecificLogic
        ? (
            endedEarly
                ? `Ended early · Known: ${rightCount} · Need practice: ${wrongCount}`
                : `Known: ${rightCount} · Need practice: ${wrongCount}`
        )
        : (
            endedEarly
                ? `Ended early · Right: ${rightCount} · Wrong: ${wrongCount}`
                : `Right: ${rightCount} · Wrong: ${wrongCount}`
        );
    if (hasBonusGameForCategory()) {
        showBonusGameForWrongCards();
    } else {
        resetBonusGame();
    }

    try {
        await window.PracticeSessionFlow.postCompleteSession(
            buildType1ApiUrl('practice/complete'),
            activePendingSessionId,
            sessionAnswers,
            { categoryKey },
        );
    } catch (error) {
        console.error('Error completing type-1 session:', error);
        showError('Failed to save session results');
    }
    window.PracticeSession.clearSessionStart(activePendingSessionId);
    updateFinishEarlyButtonState();

    await loadKidInfo();
}


function escapeHtml(text) {
    return String(text || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
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

function resetBonusGame() {
    bonusSourceCards = [];
    bonusTiles = [];
    bonusSelectedTileIndexes = [];
    bonusMatchedPairCount = 0;
    if (bonusGameSection) {
        bonusGameSection.classList.add('hidden');
    }
    if (bonusGameHint) {
        bonusGameHint.textContent = '';
    }
    if (bonusGameStatus) {
        bonusGameStatus.textContent = '';
    }
    if (bonusGameBoard) {
        bonusGameBoard.innerHTML = '';
    }
}

function showBonusGameForWrongCards() {
    if (!hasBonusGameForCategory()) {
        resetBonusGame();
        return;
    }
    const wrongCards = getUniqueWrongCards(wrongCardsInSession);
    if (wrongCards.length === 0) {
        resetBonusGame();
        return;
    }
    bonusSourceCards = wrongCards;
    if (bonusGameSection) {
        bonusGameSection.classList.remove('hidden');
    }
    if (bonusGameHint) {
        bonusGameHint.textContent = `Tap two boxes to pair each wrong card with its answer (${wrongCards.length} pair${wrongCards.length === 1 ? '' : 's'}).`;
    }
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
    bonusTiles = window.PracticeUiCommon.shuffleCards(tiles);
    bonusSelectedTileIndexes = [];
    bonusMatchedPairCount = 0;
    renderBonusGameBoard();
    renderBonusGameStatus();
}

function renderBonusGameBoard() {
    if (!bonusGameBoard) {
        return;
    }
    bonusGameBoard.innerHTML = bonusTiles.map((tile, index) => {
        const isSelected = bonusSelectedTileIndexes.includes(index);
        const classes = [
            'bonus-tile',
            isSelected ? 'selected' : '',
            tile.matched ? 'matched' : '',
            hasChineseSpecificLogic ? 'chinese-text' : '',
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-bonus-index="${index}"${tile.matched ? ' disabled' : ''}>${escapeHtml(tile.text)}</button>`;
    }).join('');
}

function renderBonusGameStatus() {
    if (!bonusGameStatus) {
        return;
    }
    const pairTotal = bonusSourceCards.length;
    if (pairTotal <= 0) {
        bonusGameStatus.textContent = '';
        return;
    }
    if (bonusMatchedPairCount >= pairTotal) {
        bonusGameStatus.textContent = `Great job! Matched all ${pairTotal} pair${pairTotal === 1 ? '' : 's'}.`;
        return;
    }
    bonusGameStatus.textContent = `Matched ${bonusMatchedPairCount} / ${pairTotal}`;
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
    const tile = bonusTiles[tileIndex];
    if (!tile || tile.matched) {
        return;
    }
    if (bonusSelectedTileIndexes.includes(tileIndex)) {
        return;
    }
    if (bonusSelectedTileIndexes.length >= 2) {
        return;
    }

    bonusSelectedTileIndexes.push(tileIndex);
    renderBonusGameBoard();

    if (bonusSelectedTileIndexes.length < 2) {
        return;
    }

    const [firstIndex, secondIndex] = bonusSelectedTileIndexes;
    const firstTile = bonusTiles[firstIndex];
    const secondTile = bonusTiles[secondIndex];
    const isMatch = firstTile && secondTile
        && firstTile.pairKey === secondTile.pairKey
        && firstTile.side !== secondTile.side;

    if (isMatch) {
        firstTile.matched = true;
        secondTile.matched = true;
        bonusMatchedPairCount += 1;
        bonusSelectedTileIndexes = [];
        renderBonusGameBoard();
        renderBonusGameStatus();
        return;
    }

    setTimeout(() => {
        bonusSelectedTileIndexes = [];
        renderBonusGameBoard();
    }, 450);
}

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
