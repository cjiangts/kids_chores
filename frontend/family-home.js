const API_BASE = `${window.location.origin}/api`;
const LAST_VIEWED_KID_STORAGE_KEY = 'parent_admin_last_kid_id_v1';
const CURRENT_USER_MODE_STORAGE_KEY = 'family_current_user_mode_v1';
const CURRENT_USER_NAME_STORAGE_KEY = 'family_current_user_name_v1';
const CURRENT_USER_AVATAR_STORAGE_KEY = 'family_current_user_avatar_v1';
const TRUSTED_PARENT_BROWSER_STORAGE_KEY = 'trusted_parent_browser_v1';
const bubbleGrid = document.getElementById('userBubbleGrid');
const errorMessage = document.getElementById('errorMessage');
const logoutBtn = document.getElementById('logoutBtn');
let currentKids = [];
let familyHomeRefreshing = false;

document.addEventListener('DOMContentLoaded', bootFamilyHome);
logoutBtn?.addEventListener('click', logoutFamily);

async function bootFamilyHome() {
    try {
        const [status, kids] = await Promise.all([fetchJson(`${API_BASE}/family-auth/status`), fetchJson(`${API_BASE}/kids?view=family_home`)]);
        if (!status.authenticated) return void (window.location.href = '/family-login.html?next=/family-home.html');
        currentKids = Array.isArray(kids) ? kids : [];
        renderBubbles();
    } catch (error) {
        if (String(error?.message || '').includes('401')) return void (window.location.href = '/family-login.html?next=/family-home.html');
        showError(error.message || 'Failed to load family home.');
    }
}

function renderBubbles() {
    bubbleGrid.innerHTML = [renderParentBubble(), ...currentKids.map(renderKidBubble)].join('');
    bubbleGrid.querySelectorAll('[data-user-mode="parent"]').forEach((bubble) => bubble.addEventListener('click', (event) => {
        event.preventDefault(); void enterParentMode(bubble.getAttribute('href') || '/admin.html');
    }));
    bubbleGrid.querySelectorAll('[data-kid-id]').forEach((bubble) => bubble.addEventListener('click', async (event) => {
        event.preventDefault();
        const id = String(bubble.dataset.kidId || '');
        showError(''); await refreshFamilyHomeSnapshot();
        const kid = currentKids.find((item) => String(item?.id || '') === id);
        persist(LAST_VIEWED_KID_STORAGE_KEY, id); persist(CURRENT_USER_MODE_STORAGE_KEY, 'kid');
        persist(CURRENT_USER_NAME_STORAGE_KEY, String(kid?.name || 'Kid')); persistAvatar(kid?.avatarUrl);
        window.location.href = `/kid-practice-home.html?id=${encodeURIComponent(id)}`;
    }));
}

function renderParentBubble() {
    return `<a class="user-bubble user-bubble--parent" href="/admin.html" data-user-mode="parent" aria-label="Parent home"><span class="user-bubble-avatar" aria-hidden="true">${iconHtml('user-cog')}</span><span class="user-bubble-name">Parent</span><span class="user-bubble-role">Parent</span></a>`;
}

function renderKidBubble(kid, index) {
    const id = String(kid?.id || ''); const name = String(kid?.name || '').trim() || 'Kid';
    const avatar = String(kid?.avatarUrl || '');
    const avatarHtml = avatar ? `<img class="user-bubble-avatar-img" src="${escapeHtml(avatar)}" alt="" loading="lazy">` : `<span class="user-bubble-initials">${escapeHtml(name.slice(0, 2).toUpperCase())}</span>`;
    return `<a class="user-bubble user-bubble--tone-${index % 4}" href="/kid-practice-home.html?id=${encodeURIComponent(id)}" data-kid-id="${escapeHtml(id)}" aria-label="${escapeHtml(`${name} practice home`)}"><span class="user-bubble-avatar" aria-hidden="true">${avatarHtml}</span><span class="user-bubble-name">${escapeHtml(name)}</span><span class="user-bubble-role">Kid</span></a>`;
}

async function refreshFamilyHomeSnapshot() {
    if (familyHomeRefreshing) return;
    familyHomeRefreshing = true;
    try { currentKids = await fetchJson(`${API_BASE}/kids?view=family_home`); } finally { familyHomeRefreshing = false; }
}

async function logoutFamily() {
    try { await fetch(`${API_BASE}/family-auth/logout`, { method: 'POST' }); } finally { window.sessionStorage.clear(); window.location.href = '/family-login.html'; }
}

async function enterParentMode(targetHref) {
    showError('');
    if (await enterParentModeWithTrustedBrowser(targetHref)) return;

    if (!window.PracticeManageCommon || typeof window.PracticeManageCommon.requestWithPasswordDialog !== 'function') {
        showError('The password dialog is unavailable. Please reload and try again.');
        return;
    }
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            'parent mode',
            (password, inputResult) => fetch(`${API_BASE}/family-auth/confirm-password`, {
                method: 'POST',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, true),
                body: JSON.stringify({
                    confirmPassword: password,
                    trustBrowser: Boolean(inputResult?.trustBrowser),
                    browserLabel: parseTrustedBrowserLabel(),
                }),
            }),
            { trustOptionLabel: 'Trust this browser for parent mode' },
        );
        if (result.cancelled) return;
        if (!result.ok) throw new Error(result.error || 'Could not enter parent mode.');
        storeTrustedBrowser(result.payload?.trustedBrowser);
        enterParentModeComplete(targetHref);
    } catch (error) { showError(error.message || 'Could not enter parent mode.'); }
}

async function enterParentModeWithTrustedBrowser(targetHref) {
    const trusted = readTrustedBrowser();
    if (!trusted) return false;
    try {
        const response = await fetch(`${API_BASE}/family-auth/trusted-browsers/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trustedBrowserToken: trusted.token }),
        });
        if (!response.ok) {
            clearTrustedBrowser();
            return false;
        }
        enterParentModeComplete(targetHref);
        return true;
    } catch (_) {
        return false;
    }
}

function enterParentModeComplete(targetHref) {
    persist(CURRENT_USER_MODE_STORAGE_KEY, 'parent');
    persist(CURRENT_USER_NAME_STORAGE_KEY, 'Parent');
    persistAvatar('');
    window.location.href = targetHref;
}

function parseTrustedBrowserLabel() {
    const ua = String(navigator.userAgent || '');
    if (/iPad/i.test(ua)) return 'iPad Browser';
    if (/iPhone/i.test(ua)) return 'iPhone Browser';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac Browser';
    if (/Windows/i.test(ua)) return 'Windows Browser';
    if (/Android/i.test(ua)) return 'Android Browser';
    return 'Trusted browser';
}

function readTrustedBrowser() {
    try {
        const parsed = JSON.parse(window.localStorage?.getItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY) || 'null');
        const token = String(parsed?.token || '').trim();
        return token ? { token, id: String(parsed?.id || ''), label: String(parsed?.label || '') } : null;
    } catch (_) { return null; }
}

function storeTrustedBrowser(trustedBrowser) {
    if (!trustedBrowser?.token) return;
    try {
        window.localStorage?.setItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY, JSON.stringify({
            id: String(trustedBrowser.id || ''),
            token: String(trustedBrowser.token),
            label: String(trustedBrowser.label || parseTrustedBrowserLabel()),
        }));
    } catch (_) { /* Best-effort storage only. */ }
}

function clearTrustedBrowser() {
    try { window.localStorage?.removeItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY); } catch (_) { /* ignore */ }
}

async function fetchJson(url) { const response = await fetch(url); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`); return data; }
function persist(key, value) { try { window.sessionStorage?.setItem(key, value); } catch (_) {} }
function persistAvatar(value) { try { value ? window.sessionStorage?.setItem(CURRENT_USER_AVATAR_STORAGE_KEY, value) : window.sessionStorage?.removeItem(CURRENT_USER_AVATAR_STORAGE_KEY); } catch (_) {} }
function iconHtml(name, size = 44) { return typeof window.icon === 'function' ? window.icon(name, { className: 'icon', size, strokeWidth: 2.1 }) : ''; }
function showError(message) { if (!errorMessage) return; errorMessage.textContent = message; errorMessage.classList.toggle('hidden', !message); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
