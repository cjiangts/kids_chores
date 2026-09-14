const API_BASE = `${window.location.origin}/api`;
const POINT_HISTORY_LIMIT = 500;

const kidRewardAvatarSwitcher = document.getElementById('kidRewardAvatarSwitcher');
const kidRewardsError = document.getElementById('kidRewardsError');
const kidPointHistory = document.getElementById('kidPointHistory');
const params = new URLSearchParams(window.location.search);
const requestedKidId = String(params.get('id') || params.get('kidId') || '').trim();

let kids = [];
let selectedKidId = '';
let pointData = { totalPoints: 0, events: [] };
let selectedHistoryDayKey = '';

function showMessage(node, text) {
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
}

function showError(text) {
    showMessage(kidRewardsError, text || '');
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}

function selectedFamilyTimezone() {
    const kid = kids.find((item) => String(item?.id || '') === selectedKidId);
    return String(kid?.familyTimezone || '').trim();
}

function rememberedKidId() {
    return String(window.KidAppNavigation?.getKidId?.() || '').trim();
}

function isKidUserMode() {
    return window.KidAppNavigation?.getMode?.() === 'kid';
}

function initialKidId() {
    const candidates = [requestedKidId, rememberedKidId()];
    const match = candidates.find((kidId) => kidId && kids.some((kid) => String(kid?.id || '') === kidId));
    return match || String(kids[0]?.id || '');
}

function syncSelectedKidNavigation() {
    if (window.KidAppNavigation && selectedKidId) {
        window.KidAppNavigation.setKidId(selectedKidId);
    }
}

function renderKids() {
    if (!kidRewardAvatarSwitcher) return;
    if (isKidUserMode() || !window.KidAppNavigation?.renderKidAvatarSwitcher) {
        kidRewardAvatarSwitcher.innerHTML = '';
        kidRewardAvatarSwitcher.classList.add('hidden');
        return;
    }
    window.KidAppNavigation.renderKidAvatarSwitcher(kidRewardAvatarSwitcher, kids, {
        selectedKidId,
        onSelect: async (kidId) => {
            if (!kidId || kidId === selectedKidId) return;
            selectedKidId = kidId;
            syncSelectedKidNavigation();
            selectedHistoryDayKey = '';
            showError('');
            try {
                await loadPointsForSelectedKid();
                render();
            } catch (error) {
                showError(error.message || 'Failed to load rewards.');
            }
        },
    });
}

function renderHistory() {
    selectedHistoryDayKey = window.PointHistoryCommon.render(kidPointHistory, {
        selectedKidId,
        events: kidActivityEventsWithBalance(),
        selectedDayKey: selectedHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: false,
        showBalance: true,
        mode: 'all',
        emptyDay: 'No point activity for this day.',
    });
}

function kidActivityEventsWithBalance() {
    const events = Array.isArray(pointData.events) ? pointData.events : [];
    let balance = Number.parseInt(pointData.totalPoints, 10) || 0;
    return [...events]
        .sort((a, b) => {
            const timeDiff = new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
            return timeDiff || ((Number.parseInt(b?.eventId, 10) || 0) - (Number.parseInt(a?.eventId, 10) || 0));
        })
        .map((event) => {
            const delta = Number.parseInt(event?.pointsDelta, 10) || 0;
            const result = { ...event, balanceAfter: balance };
            balance -= delta;
            return result;
        });
}

function handleHistoryDayClick(event) {
    const dayButton = event.target.closest('[data-history-day]');
    if (!dayButton) return;
    const nextDayKey = String(dayButton.dataset.historyDay || '');
    if (!nextDayKey) return;
    selectedHistoryDayKey = nextDayKey === selectedHistoryDayKey ? '' : nextDayKey;
    renderHistory();
}

function render() {
    renderKids();
    renderHistory();
    hydrateIcons(document);
}

async function loadPointsForSelectedKid() {
    if (!selectedKidId) {
        pointData = { totalPoints: 0, events: [] };
        return;
    }
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=${POINT_HISTORY_LIMIT}`);
    pointData = data || { totalPoints: 0, events: [] };
}

async function loadInitialData() {
    showError('');
    const kidsData = await fetchJson(`${API_BASE}/kids?view=reward_nav`);
    kids = Array.isArray(kidsData) ? kidsData : [];
    selectedKidId = initialKidId();
    syncSelectedKidNavigation();
    selectedHistoryDayKey = '';
    await loadPointsForSelectedKid();
    render();
}

kidPointHistory?.addEventListener('click', (event) => {
    handleHistoryDayClick(event);
});

loadInitialData().catch((error) => {
    showError(error.message || 'Failed to load rewards.');
});
