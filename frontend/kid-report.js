const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const from = String(params.get('from') || '').trim().toLowerCase();

const reportTitle = document.getElementById('reportTitle');
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
    loadKidNav();
    await loadReport();
});

async function loadKidNav() {
    if (!kidNavGroup) return;
    try {
        const response = await fetch(`${API_BASE}/kids?view=practice_nav`);
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
    const userIconSvg = window.icon('user', { className: 'kid-nav-card-icon', strokeWidth: 2 });
    kidNavGroup.innerHTML = kids.map((kid) => {
        const id = String(kid?.id || '').trim();
        const name = String(kid?.name || '').trim() || '...';
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
        reportTitle.textContent = 'View Reports';
        document.title = 'View Reports - The mommy app';
    } catch (error) {
        console.error('Error loading report:', error);
        showError('Failed to load practice report.');
        document.title = 'View Reports - The mommy app';
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
