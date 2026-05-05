const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const from = String(params.get('from') || '').trim().toLowerCase();

const reportTitle = document.getElementById('reportTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const kidNavGroup = document.getElementById('kidNavGroup');
let cachedKidsForNav = [];

const reportRenderer = window.KidReportCommon.createReport({
    elements: {
        summaryGrid: document.getElementById('summaryGrid'),
        dailyChartBody: document.getElementById('dailyChartBody'),
        dailyChartLegend: document.getElementById('dailyChartLegend'),
        dailyChartPageLabel: document.getElementById('dailyChartPageLabel'),
        dailyChartNewerBtn: document.getElementById('dailyChartNewerBtn'),
        dailyChartOlderBtn: document.getElementById('dailyChartOlderBtn'),
        sessionsList: document.getElementById('sessionsList'),
    },
    buildSessionUrl: (session) => {
        const qs = new URLSearchParams();
        qs.set('id', String(kidId));
        qs.set('sessionId', String(session?.id || ''));
        if (from === 'kid-home') qs.set('from', 'kid-home');
        return `/kid-session-report.html?${qs.toString()}`;
    },
});

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }
    reportRenderer.renderInitialLoading();
    if (backBtn) {
        backBtn.href = from === 'kid-home'
            ? `/kid-practice-home.html?id=${encodeURIComponent(kidId)}`
            : '/admin.html';
    }
    loadKidNav();
    await loadReport();
});

async function loadKidNav() {
    if (!kidNavGroup) return;
    try {
        const response = await fetch(`${API_BASE}/kids`);
        if (!response.ok) return;
        const kids = await response.json();
        cachedKidsForNav = Array.isArray(kids) ? kids : [];
        renderKidNav();
    } catch (error) {
        console.error('Error loading kids for nav:', error);
    }
}

function renderKidNav() {
    if (!kidNavGroup) return;
    const kids = Array.isArray(cachedKidsForNav) ? cachedKidsForNav : [];
    if (kids.length < 2) {
        kidNavGroup.classList.add('hidden');
        kidNavGroup.innerHTML = '';
        return;
    }
    const userIconSvg = '<svg class="kid-nav-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    kidNavGroup.innerHTML = kids.map((kid) => {
        const id = String(kid?.id || '').trim();
        const name = String(kid?.name || '').trim() || 'Kid';
        const isActive = id === String(kidId);
        if (isActive) {
            return `<span class="kid-nav-card active" role="tab" aria-selected="true">${userIconSvg}<span>${escapeHtml(name)}</span></span>`;
        }
        const href = buildKidReportHref(id);
        return `<a class="kid-nav-card" role="tab" aria-selected="false" href="${escapeHtml(href)}">${userIconSvg}<span>${escapeHtml(name)}</span></a>`;
    }).join('');
    kidNavGroup.classList.remove('hidden');
}

function buildKidReportHref(targetKidId) {
    const qs = new URLSearchParams();
    qs.set('id', String(targetKidId));
    if (from === 'kid-home') qs.set('from', 'kid-home');
    return `/kid-report.html?${qs.toString()}`;
}

async function loadReport() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        reportRenderer.setData({ sessions, familyTimezone: data.family_timezone });
        reportTitle.textContent = 'Practice Report';
        document.title = 'Practice Report - Kids Daily Chores';
    } catch (error) {
        console.error('Error loading report:', error);
        showError('Failed to load practice report.');
        document.title = 'Kid Practice Report - Kids Daily Chores';
    }
}

function showError(message) {
    if (message) {
        const text = String(message);
        if (errorMessage) {
            errorMessage.textContent = '';
            errorMessage.classList.add('hidden');
        }
        if (showError._lastMessage !== text) {
            window.alert(text);
            showError._lastMessage = text;
        }
    } else {
        showError._lastMessage = '';
        if (errorMessage) {
            errorMessage.classList.add('hidden');
        }
    }
}
