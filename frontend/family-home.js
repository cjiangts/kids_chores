const API_BASE = `${window.location.origin}/api`;
const LAST_VIEWED_KID_STORAGE_KEY = 'parent_admin_last_kid_id_v1';
const CURRENT_USER_MODE_STORAGE_KEY = 'family_current_user_mode_v1';
const CURRENT_USER_NAME_STORAGE_KEY = 'family_current_user_name_v1';
const CURRENT_USER_AVATAR_STORAGE_KEY = 'family_current_user_avatar_v1';
const TRUSTED_PARENT_BROWSER_STORAGE_KEY = 'trusted_parent_browser_v1';

const bubbleGrid = document.getElementById('userBubbleGrid');
const errorMessage = document.getElementById('errorMessage');
const logoutBtn = document.getElementById('logoutBtn');
const offlineModeBtn = document.getElementById('offlineModeBtn');
const offlineActionFooter = document.getElementById('offlineActionFooter');
const familyHomeTitle = document.getElementById('familyHomeTitle');

let currentKids = [];
let offlineSelectionMode = false;
const offlineSelectedKidIds = new Set();
let offlineOwnedKidIds = new Set();
let familyHomeRefreshing = false;
let offlineHubMode = false;

document.addEventListener('DOMContentLoaded', bootFamilyHome);
logoutBtn.addEventListener('click', logoutFamily);
if (offlineModeBtn) {
    offlineModeBtn.addEventListener('click', () => {
        if (offlineSelectionMode) {
            exitOfflineSelectionMode();
        } else {
            enterOfflineSelectionMode();
        }
    });
}

async function bootFamilyHome() {
    // When this device owns offline packs it is in offline mode — family-home
    // is the hub for switching between downloaded kids and syncing them. Render
    // straight from local packs without touching the network.
    if (await tryBootOfflineHub()) return;
    try {
        const [status, kids] = await Promise.all([
            fetchJson(`${API_BASE}/family-auth/status`),
            fetchJson(`${API_BASE}/kids?view=family_home`),
        ]);
        if (!status.authenticated) {
            window.location.href = '/family-login.html?next=/family-home.html';
            return;
        }
        currentKids = Array.isArray(kids) ? kids : [];
        await refreshOfflineOwnedKidIds();
        renderBubbles();
    } catch (error) {
        if (String(error && error.message || '').includes('401')) {
            window.location.href = '/family-login.html?next=/family-home.html';
            return;
        }
        showError(error.message || 'Failed to load family home.');
    }
}

function renderBubbles() {
    currentKids.forEach((kid) => {
        if (kid?.offlineLock) {
            offlineSelectedKidIds.delete(String(kid?.id || ''));
        }
    });
    const userBubbles = [
        renderParentBubble(),
        ...currentKids.map(renderKidBubble),
    ];
    bubbleGrid.classList.toggle('is-offline-selecting', offlineSelectionMode);
    bubbleGrid.innerHTML = userBubbles.join('');
    bubbleGrid.querySelectorAll('[data-user-mode]').forEach((bubble) => {
        bubble.addEventListener('click', (event) => {
            if (offlineSelectionMode) {
                event.preventDefault();
                return;
            }
            if (bubble.dataset.userMode === 'kid') {
                return;
            }
            event.preventDefault();
            void enterParentModeWithPassword(bubble.getAttribute('href') || '/admin.html');
        });
    });
    bubbleGrid.querySelectorAll('[data-offline-trash-kid-id]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void forceReleaseOfflineKid(button.dataset.offlineTrashKidId);
        });
    });
    bubbleGrid.querySelectorAll('[data-kid-id]').forEach((bubble) => {
        bubble.addEventListener('click', async (event) => {
            const kidId = bubble.dataset.kidId;
            if (offlineSelectionMode) {
                event.preventDefault();
                toggleOfflineKidSelection(kidId);
                return;
            }
            event.preventDefault();
            showError('');
            await refreshFamilyHomeSnapshot();
            const id = String(kidId || '');
            const kid = currentKids.find((item) => String(item?.id || '') === id);
            const lockedElsewhere = Boolean(kid?.offlineLock) && !offlineOwnedKidIds.has(id);
            if (lockedElsewhere) {
                const name = String(kid?.name || 'This child').trim() || 'This child';
                showError(`${name} is offline on another device. Sync that device before practicing here.`);
                return;
            }
            persistLastViewedKidId(id);
            persistCurrentUserMode('kid');
            persistCurrentUserName(String(kid?.name || 'Kid'));
            persistCurrentUserAvatar(kid?.avatarUrl);
            window.location.href = id ? `/kid-practice-home.html?id=${encodeURIComponent(id)}` : '/kid-practice-home.html';
        });
        bubble.addEventListener('keydown', (event) => {
            if (bubble.tagName === 'A') return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            bubble.click();
        });
    });
    renderOfflineActionFooter();
}

function renderParentBubble() {
    const label = 'Parent';
    const disabledClass = offlineSelectionMode ? ' is-offline-disabled' : '';
    const tabIndex = offlineSelectionMode ? ' tabindex="-1" aria-hidden="true"' : '';
    return `
        <a class="user-bubble user-bubble--parent${disabledClass}" href="/admin.html" data-user-mode="parent" aria-label="${escapeHtml(`${label} parent home`)}"${tabIndex}>
            <span class="user-bubble-avatar" aria-hidden="true">${iconHtml('user-cog')}</span>
            <span class="user-bubble-name">${escapeHtml(label)}</span>
            <span class="user-bubble-role">Parent</span>
        </a>
    `;
}

function renderKidBubble(kid, index) {
    const id = String(kid && kid.id || '').trim();
    const name = String(kid && kid.name || '').trim() || 'Kid';
    const practiceHref = id ? `/kid-practice-home.html?id=${encodeURIComponent(id)}` : '/kid-practice-home.html';
    const selected = offlineSelectedKidIds.has(id);
    const locked = Boolean(kid?.offlineLock);
    const ownedHere = offlineOwnedKidIds.has(id);
    const lockedElsewhere = locked && !ownedHere;
    const href = practiceHref;
    const disabledInOfflineSelection = offlineSelectionMode && locked;
    const offlineClass = offlineSelectionMode && !locked ? ' is-offline-pickable' : '';
    const selectedClass = selected && !locked ? ' is-offline-selected' : '';
    const lockedClass = !offlineSelectionMode && lockedElsewhere ? ' is-offline-locked' : '';
    const offlineInfoClass = locked && !offlineSelectionMode ? ' is-offline-info-card' : '';
    const ownedClass = locked && ownedHere ? ' is-offline-owned' : '';
    const disabledClass = disabledInOfflineSelection ? ' is-offline-disabled' : '';
    const roleText = offlineSelectionMode
        ? (locked ? 'Offline' : (selected ? 'Selected' : 'Select'))
        : (ownedHere ? 'Resume offline' : (lockedElsewhere ? '' : 'Kid'));
    const checkHtml = offlineSelectionMode && !locked
        ? (selected
            ? `<span class="user-bubble-offline-check" aria-hidden="true">${iconHtml('check')}</span>`
            : '<span class="user-bubble-offline-check is-empty" aria-hidden="true"></span>')
        : '';
    const lockedBadgeHtml = !offlineSelectionMode && lockedElsewhere
        ? `<span class="user-bubble-offline-check user-bubble-offline-check--locked" aria-hidden="true">${iconHtml('cloud-off')}</span>`
        : '';
    const lockInfoHtml = locked && !offlineSelectionMode ? renderOfflineLockInfo(kid.offlineLock, id, name, { ownedHere }) : '';
    const renderAsLockedInfo = locked && !offlineSelectionMode;
    const renderAsDisabled = disabledInOfflineSelection;
    const tagName = renderAsLockedInfo || renderAsDisabled ? 'div' : 'a';
    const hrefAttr = tagName === 'a' ? ` href="${href}"` : '';
    const interactiveAttrs = renderAsLockedInfo ? ' role="button" tabindex="0"' : '';
    const disabledAttrs = lockedElsewhere || renderAsDisabled ? ' aria-disabled="true"' : '';
    return `
        <${tagName} class="user-bubble user-bubble--tone-${index % 4}${offlineClass}${selectedClass}${lockedClass}${offlineInfoClass}${ownedClass}${disabledClass}"${hrefAttr} data-user-mode="kid" data-kid-id="${escapeHtml(id)}" aria-label="${escapeHtml(locked ? `${name} is offline` : (offlineSelectionMode ? `${name} offline practice` : `${name} practice home`))}"${interactiveAttrs}${disabledAttrs}>
            ${offlineSelectionMode ? checkHtml : ''}
            ${lockedBadgeHtml}
            <span class="user-bubble-avatar" aria-hidden="true">${kidBubbleAvatarInner(kid, name)}</span>
            <span class="user-bubble-name">${escapeHtml(name)}</span>
            ${roleText ? `<span class="user-bubble-role">${escapeHtml(roleText)}</span>` : ''}
            ${lockInfoHtml}
        </${tagName}>
    `;
}

function renderOfflineLockInfo(lock, kidId, kidName, options = {}) {
    const device = String(lock?.device_label || '').trim() || 'Offline device';
    const acquired = formatOfflineLockTime(lock?.acquired_at_utc);
    const bytes = formatOfflineBytes(lock?.pack_total_bytes);
    const ownerLabel = options.ownedHere ? '<span class="user-bubble-offline-chip user-bubble-offline-chip--owner">This device</span>' : '';
    return `
        <span class="user-bubble-offline-info" aria-label="${escapeHtml(`${kidName} offline pack details`)}">
            <span class="user-bubble-offline-chip user-bubble-offline-chip--device" title="${escapeHtml(`${device} · ${bytes}`)}">${iconHtml('monitor', 12)}<span>${escapeHtml(device)}</span><span class="user-bubble-offline-chip-divider" aria-hidden="true"></span><span>${escapeHtml(bytes)}</span></span>
            ${ownerLabel}
            <span class="user-bubble-offline-chip" title="${escapeHtml(acquired)}">${iconHtml('clock', 12)}<span>${escapeHtml(acquired)}</span></span>
            <button type="button" class="user-bubble-offline-trash" data-offline-trash-kid-id="${escapeHtml(kidId)}" aria-label="${escapeHtml(`Release offline pack for ${kidName}`)}" title="Release offline pack">
                ${iconHtml('trash-2', 22)}
            </button>
        </span>
    `;
}

function enterOfflineSelectionMode() {
    offlineSelectionMode = true;
    offlineSelectedKidIds.clear();
    if (offlineModeBtn) offlineModeBtn.classList.add('is-active');
    if (familyHomeTitle) familyHomeTitle.textContent = 'Choose kids for offline';
    showError('');
    renderBubbles();
}

function exitOfflineSelectionMode() {
    offlineSelectionMode = false;
    offlineSelectedKidIds.clear();
    if (offlineModeBtn) offlineModeBtn.classList.remove('is-active');
    if (familyHomeTitle) familyHomeTitle.textContent = 'Choose user';
    renderBubbles();
}

function toggleOfflineKidSelection(kidId) {
    const id = String(kidId || '').trim();
    if (!id) return;
    const kid = currentKids.find((item) => String(item?.id || '') === id);
    if (!kid) return;
    if (kid.offlineLock) return;
    if (offlineSelectedKidIds.has(id)) {
        offlineSelectedKidIds.delete(id);
    } else {
        offlineSelectedKidIds.add(id);
    }
    renderBubbles();
}

function renderOfflineActionFooter() {
    if (!offlineActionFooter) return;
    if (!offlineSelectionMode) {
        offlineActionFooter.classList.add('hidden');
        offlineActionFooter.innerHTML = '';
        return;
    }
    const count = offlineSelectedKidIds.size;
    offlineActionFooter.classList.remove('hidden');
    offlineActionFooter.innerHTML = `
        <button type="button" class="family-offline-footer-btn family-offline-footer-btn--cancel" data-offline-cancel>Cancel</button>
        <button type="button" class="family-offline-footer-btn family-offline-footer-btn--download" data-offline-download ${count === 0 ? 'disabled' : ''}>
            ${iconHtml('download', 18)}
            <span data-offline-download-label>${count === 0 ? 'Select a kid' : `Enter offline (${count})`}</span>
        </button>
    `;
    const cancelBtn = offlineActionFooter.querySelector('[data-offline-cancel]');
    if (cancelBtn) cancelBtn.addEventListener('click', exitOfflineSelectionMode);
    const downloadBtn = offlineActionFooter.querySelector('[data-offline-download]');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadSelectedOffline);
}

async function downloadSelectedOffline() {
    if (!offlineSelectionMode || offlineSelectedKidIds.size === 0) return;
    if (!window.OfflineCommon) {
        showError('Offline tools are not available. Please reload and try again.');
        return;
    }
    const ids = Array.from(offlineSelectedKidIds);
    const downloadBtn = offlineActionFooter ? offlineActionFooter.querySelector('[data-offline-download]') : null;
    const cancelBtn = offlineActionFooter ? offlineActionFooter.querySelector('[data-offline-cancel]') : null;
    const labelEl = downloadBtn ? downloadBtn.querySelector('[data-offline-download-label]') : null;
    const setLabel = (text) => {
        if (labelEl) labelEl.textContent = text;
    };

    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.classList.add('is-busy');
    }
    if (cancelBtn) cancelBtn.disabled = true;
    setLabel('Preparing...');

    const results = [];
    for (const kidId of ids) {
        const kid = currentKids.find((item) => String(item?.id || '') === kidId);
        const kidName = String(kid?.name || 'Kid');
        const onProgress = (info) => {
            if (!info) return;
            if (info.phase === 'subjects_known') {
                setLabel(`${kidName} · Subjects 0/${Number(info.subjectCount || 0)}`);
            } else if (info.phase === 'subject_done') {
                setLabel(`${kidName} · Downloading...`);
            } else if (info.phase === 'audio_progress') {
                setLabel(`${kidName} · Audio ${Number(info.completed || 0)}/${Number(info.total || 0)}`);
            } else if (info.phase === 'audio_done') {
                setLabel(`${kidName} · Finishing...`);
            }
        };
        try {
            let res = await window.OfflineCommon.acquirePack(kidId, {
                deviceLabel: window.OfflineCommon.parseDeviceLabel(),
                onProgress,
            });
            if (!res.ok && res.inflight) {
                const proceed = window.confirm('This child has unfinished practice in progress. Discard and continue offline?');
                if (proceed) {
                    res = await window.OfflineCommon.acquirePack(kidId, {
                        deviceLabel: window.OfflineCommon.parseDeviceLabel(),
                        forceDiscardInflight: true,
                        onProgress,
                    });
                }
            }
            results.push({ kidId, res });
        } catch (error) {
            results.push({ kidId, res: { ok: false, error: String(error) } });
        }
    }

    const firstSuccess = results.find((item) => item.res && item.res.ok);
    const failures = results.filter((item) => !(item.res && item.res.ok));
    if (failures.length > 0) {
        const message = failures.map((item) => {
            const kid = currentKids.find((entry) => String(entry?.id || '') === item.kidId);
            const name = String(kid?.name || `Kid ${item.kidId}`);
            if (item.res && item.res.conflict) return `${name}: already offline on another device.`;
            if (item.res && item.res.inflight) return `${name}: unfinished session in progress.`;
            return `${name}: ${(item.res && item.res.error) || 'unknown error'}`;
        }).join('\n');
        alert(`Some kids could not enter offline mode:\n${message}`);
    }

    if (firstSuccess) {
        // Land on the offline hub (this same page re-boots into hub mode) so the
        // parent can pick any downloaded kid, not just the first.
        setLabel('Entering offline...');
        window.location.href = '/family-home.html';
        return;
    }

    if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('is-busy');
    }
    if (cancelBtn) cancelBtn.disabled = false;
    setLabel(ids.length === 1 ? 'Try again' : `Try again (${ids.length})`);
}

async function tryBootOfflineHub() {
    if (!window.OfflineStorage) return false;
    let packs = [];
    try {
        packs = await window.OfflineStorage.listAllPacks();
    } catch (_) {
        return false;
    }
    if (!Array.isArray(packs) || packs.length === 0) return false;

    offlineHubMode = true;
    offlineOwnedKidIds = new Set(packs.map((p) => String(p.kidId)));
    currentKids = packs.map((p) => ({
        id: String(p.kidId),
        name: String(p?.packEnvelope?.kidInfo?.name || p?.packEnvelope?.kid_name || 'Kid').trim() || 'Kid',
        acquiredAtUtc: String(p?.packEnvelope?.acquired_at_utc || ''),
    }));
    if (offlineModeBtn) offlineModeBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (familyHomeTitle) familyHomeTitle.textContent = 'Offline practice';
    await renderOfflineHubBubbles();
    return true;
}

async function renderOfflineHubBubbles() {
    const meta = await Promise.all(currentKids.map((kid) => buildOfflineHubKidMeta(kid)));
    bubbleGrid.classList.remove('is-offline-selecting');
    bubbleGrid.innerHTML = currentKids.map((kid, i) => renderOfflineHubBubble(kid, i, meta[i])).join('');
    if (offlineActionFooter) {
        offlineActionFooter.classList.add('hidden');
        offlineActionFooter.innerHTML = '';
    }
    bubbleGrid.querySelectorAll('[data-kid-id]').forEach((bubble) => {
        bubble.addEventListener('click', () => {
            goPracticeOffline(bubble.dataset.kidId);
        });
        bubble.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            bubble.click();
        });
    });
    bubbleGrid.querySelectorAll('[data-offline-sync-kid-id]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void syncOneOfflineKid(button.dataset.offlineSyncKidId);
        });
    });
}

async function buildOfflineHubKidMeta(kid) {
    const id = String(kid?.id || '').trim();
    const pendingCount = await countPendingAnswersForKid(id);
    let totalBytes = 0;
    if (window.OfflineStorage) {
        try {
            const stats = await window.OfflineStorage.getPackStats(id);
            totalBytes = Math.max(0, Number(stats?.totalBytes) || 0);
        } catch (_) {
            // best-effort size readout
        }
    }
    const deviceLabel = (window.OfflineCommon && typeof window.OfflineCommon.parseDeviceLabel === 'function')
        ? window.OfflineCommon.parseDeviceLabel()
        : 'This device';
    return {
        pendingCount,
        sizeText: formatOfflineBytes(totalBytes),
        deviceLabel,
        acquiredText: formatOfflineLockTime(kid?.acquiredAtUtc),
    };
}

function renderOfflineHubBubble(kid, index, meta) {
    const id = String(kid?.id || '').trim();
    const name = String(kid?.name || 'Kid').trim() || 'Kid';
    const info = meta || {};
    const count = Math.max(0, Number.parseInt(info.pendingCount, 10) || 0);
    const countBadge = count > 0
        ? `<span class="offline-sync-count" aria-label="${count} answers pending">${count}</span>`
        : '';
    const deviceLabel = String(info.deviceLabel || 'This device');
    const sizeText = String(info.sizeText || '');
    const acquiredText = String(info.acquiredText || '');
    return `
        <div class="offline-hub-item">
            <div class="user-bubble user-bubble--tone-${index % 4} is-offline-hub-card" role="button" tabindex="0" data-kid-id="${escapeHtml(id)}" aria-label="${escapeHtml(`${name} offline practice`)}">
                <span class="user-bubble-avatar" aria-hidden="true"><span class="user-bubble-initials">${escapeHtml(initialsFor(name))}</span></span>
                <span class="user-bubble-name">${escapeHtml(name)}</span>
                <span class="offline-hub-info">
                    <span class="offline-hub-chip offline-hub-chip--device" title="${escapeHtml(`${deviceLabel} · ${sizeText}`)}">
                        ${iconHtml('monitor', 13)}<span>${escapeHtml(deviceLabel)}</span><span class="offline-hub-chip-divider" aria-hidden="true"></span><span>${escapeHtml(sizeText)}</span>
                    </span>
                    <span class="offline-hub-chip" title="${escapeHtml(acquiredText)}">
                        ${iconHtml('clock', 13)}<span>${escapeHtml(acquiredText)}</span>
                    </span>
                </span>
            </div>
            <button type="button" class="offline-hub-sync-btn" data-offline-sync-kid-id="${escapeHtml(id)}" aria-label="${escapeHtml(`Sync ${name}'s practice results`)}" title="Sync practice results">
                ${iconHtml('refresh-ccw', 18)}<span>Sync</span>${countBadge}
            </button>
        </div>
    `;
}

function goPracticeOffline(kidId) {
    const id = String(kidId || '').trim();
    if (!id) return;
    const kid = currentKids.find((item) => String(item?.id || '') === id);
    persistLastViewedKidId(id);
    persistCurrentUserMode('kid');
    persistCurrentUserName(String(kid?.name || 'Kid'));
    persistCurrentUserAvatar(kid?.avatarUrl);
    window.location.href = `/kid-practice-home.html?id=${encodeURIComponent(id)}`;
}

async function countPendingAnswersForKid(kidId) {
    if (!window.OfflineStorage) return 0;
    try {
        const rows = await window.OfflineStorage.listPendingResults(kidId);
        let total = 0;
        for (const row of rows) {
            total += Array.isArray(row?.answers) ? row.answers.length : 0;
        }
        return total;
    } catch (_) {
        return 0;
    }
}

async function syncOneOfflineKid(kidId) {
    const id = String(kidId || '').trim();
    if (!id) return;
    if (!window.OfflineCommon || !window.OfflineStorage) {
        showError('Offline tools are not available. Please reload and try again.');
        return;
    }
    const button = bubbleGrid.querySelector(`[data-offline-sync-kid-id="${id}"]`);
    if (button) {
        button.disabled = true;
        button.classList.add('is-busy');
    }
    const restoreButton = () => {
        if (!button) return;
        button.disabled = false;
        button.classList.remove('is-busy');
    };
    try {
        const localPack = await window.OfflineStorage.loadPack(id);
        const rows = await window.OfflineStorage.listPendingResults(id);
        const queuedThumbDownCount = Array.isArray(localPack?.packEnvelope?.thumbDownEvents)
            ? localPack.packEnvelope.thumbDownEvents.length
            : 0;
        const result = (rows.length === 0 && queuedThumbDownCount === 0)
            ? await window.OfflineCommon.releasePack(id)
            : await window.OfflineCommon.syncPack(id);
        if (!result || !result.ok) {
            const errText = (result && (result.error || (result.response && result.response.error))) || 'Sync failed';
            restoreButton();
            window.alert(
                `Could not sync this pack:\n${errText}\n\n`
                + 'Your practice results are still saved on this device — reconnect and tap Sync again.',
            );
            return;
        }
        const resp = result.response || {};
        if (resp.conflict_warning) {
            const totalAnswers = Number(resp.discarded_answer_count) || 0;
            const forceReleased = String(resp.conflict_warning) === 'lock_expired_or_released';
            const headline = forceReleased
                ? 'The server has dropped this offline pack — most likely because someone clicked the trash button on the family home, or the pack expired at midnight.'
                : 'Another device has taken over this offline pack since this device went offline.';
            window.alert(
                `${headline}\n\n`
                + `${totalAnswers} practice answer${totalAnswers === 1 ? '' : 's'} from this device `
                + 'had to be discarded. Nothing on the server changed.',
            );
        }
        // sync/release already deleted the local pack. When the last one is gone
        // the device is no longer offline — reload into the normal online home.
        await refreshOfflineOwnedKidIds();
        if (offlineOwnedKidIds.size === 0) {
            window.location.reload();
            return;
        }
        await tryBootOfflineHub();
    } catch (error) {
        restoreButton();
        const msg = (error && error.message) ? String(error.message) : String(error);
        window.alert(
            `Sync error: ${msg}\n\n`
            + 'Your practice results are still saved on this device — reconnect and tap Sync again.',
        );
    }
}

async function refreshOfflineOwnedKidIds() {
    if (!window.OfflineStorage) {
        offlineOwnedKidIds = new Set();
        return;
    }
    try {
        const ids = await window.OfflineStorage.listOwnedKidIds();
        offlineOwnedKidIds = new Set(ids.map(String));
    } catch (error) {
        offlineOwnedKidIds = new Set();
    }
}

async function refreshFamilyHomeSnapshot() {
    if (familyHomeRefreshing) return;
    familyHomeRefreshing = true;
    try {
        const kids = await fetchJson(`${API_BASE}/kids?view=family_home`);
        currentKids = Array.isArray(kids) ? kids : [];
        await refreshOfflineOwnedKidIds();
        renderBubbles();
    } catch (error) {
        if (String(error && error.message || '').includes('401')) {
            window.location.href = '/family-login.html?next=/family-home.html';
            return;
        }
        showError(error.message || 'Failed to refresh family home.');
    } finally {
        familyHomeRefreshing = false;
    }
}

async function forceReleaseOfflineKid(kidId) {
    const id = String(kidId || '').trim();
    if (!id) return;
    const kid = currentKids.find((item) => String(item?.id || '') === id);
    const name = String(kid?.name || 'this child').trim() || 'this child';
    const password = window.prompt(`Release ${name}'s offline pack?\n\nThis can discard unsynced practice from the offline device. Enter family password to continue.`);
    if (!password) return;
    showError('');
    try {
        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(id)}/offline/force-release`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Confirm-Password': password,
            },
            body: JSON.stringify({ confirmPassword: password }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `Release failed (${response.status})`);
        }
        if (window.OfflineStorage && offlineOwnedKidIds.has(id)) {
            try {
                await window.OfflineStorage.deletePack(id);
            } catch (_) {
                // Server lock is already released; local cleanup is best-effort.
            }
        }
        offlineSelectedKidIds.delete(id);
        await refreshFamilyHomeSnapshot();
    } catch (error) {
        showError(error.message || 'Could not release offline pack.');
    }
}

async function logoutFamily() {
    try {
        await fetch(`${API_BASE}/family-auth/logout`, { method: 'POST' });
    } catch (error) {
        // Still clear the current page; the server will re-check auth next load.
    }
    window.location.href = '/family-login.html';
}

async function enterParentModeWithPassword(href = '/admin.html') {
    showError('');
    const targetHref = String(href || '/admin.html').trim() || '/admin.html';
    if (await enterParentModeWithTrustedBrowser(targetHref)) {
        return;
    }
    if (window.PracticeManageCommon && typeof window.PracticeManageCommon.requestWithPasswordDialog === 'function') {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            'parent mode',
            (password, inputResult) => fetch(`${API_BASE}/family-auth/confirm-password`, {
                method: 'POST',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, true),
                body: JSON.stringify({
                    confirmPassword: password,
                    trustBrowser: Boolean(inputResult && inputResult.trustBrowser),
                    browserLabel: parseTrustedBrowserLabel(),
                }),
            }),
            { trustOptionLabel: 'Trust this browser for parent mode' },
        );
        if (result.cancelled) return;
        if (!result.ok) {
            showError(result.error || 'Could not enter parent mode.');
            return;
        }
        storeTrustedBrowser(result.payload && result.payload.trustedBrowser);
        persistCurrentUserMode('parent');
        persistCurrentUserName('Parent');
        persistCurrentUserAvatar('');
        window.location.href = targetHref;
        return;
    }

    const password = window.prompt('Enter family password to enter parent mode:');
    if (!password) return;
    try {
        const response = await fetch(`${API_BASE}/family-auth/confirm-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Confirm-Password': password,
            },
            body: JSON.stringify({ confirmPassword: password }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `Password check failed (${response.status})`);
        }
        persistCurrentUserMode('parent');
        persistCurrentUserName('Parent');
        persistCurrentUserAvatar('');
        window.location.href = targetHref;
    } catch (error) {
        showError(error.message || 'Could not enter parent mode.');
    }
}

async function enterParentModeWithTrustedBrowser(targetHref) {
    const trusted = readTrustedBrowser();
    if (!trusted || !trusted.token) {
        return false;
    }
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
        persistCurrentUserMode('parent');
        persistCurrentUserName('Parent');
        persistCurrentUserAvatar('');
        window.location.href = targetHref;
        return true;
    } catch (error) {
        return false;
    }
}

function parseTrustedBrowserLabel() {
    if (window.OfflineCommon && typeof window.OfflineCommon.parseDeviceLabel === 'function') {
        return window.OfflineCommon.parseDeviceLabel();
    }
    try {
        const ua = String(navigator.userAgent || '');
        if (/iPad/i.test(ua)) return 'iPad Browser';
        if (/iPhone/i.test(ua)) return 'iPhone Browser';
        if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac Browser';
        if (/Windows/i.test(ua)) return 'Windows Browser';
    } catch (error) {
        // ignore
    }
    return 'Trusted browser';
}

function readTrustedBrowser() {
    try {
        if (!window.localStorage) return null;
        const raw = window.localStorage.getItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const token = String(parsed?.token || '').trim();
        if (!token) return null;
        return {
            id: String(parsed?.id || ''),
            token,
            label: String(parsed?.label || ''),
        };
    } catch (error) {
        return null;
    }
}

function storeTrustedBrowser(trustedBrowser) {
    if (!trustedBrowser || !trustedBrowser.token) return;
    try {
        if (!window.localStorage) return;
        window.localStorage.setItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY, JSON.stringify({
            id: String(trustedBrowser.id || ''),
            token: String(trustedBrowser.token || ''),
            label: String(trustedBrowser.label || parseTrustedBrowserLabel()),
        }));
    } catch (error) {
        // best-effort trust token storage
    }
}

function clearTrustedBrowser() {
    try {
        if (window.localStorage) {
            window.localStorage.removeItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY);
        }
    } catch (error) {
        // ignore
    }
}

function persistCurrentUserMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    if (normalized !== 'kid' && normalized !== 'parent') return;
    try {
        if (window.sessionStorage) {
            window.sessionStorage.setItem(CURRENT_USER_MODE_STORAGE_KEY, normalized);
        }
    } catch (error) {
        // best-effort identity mode memory
    }
}

function persistCurrentUserName(name) {
    const normalized = String(name || '').trim();
    if (!normalized) return;
    try {
        if (window.sessionStorage) {
            window.sessionStorage.setItem(CURRENT_USER_NAME_STORAGE_KEY, normalized);
        }
    } catch (error) {
        // best-effort identity name memory
    }
}

function persistCurrentUserAvatar(avatarUrl) {
    const normalized = String(avatarUrl || '').trim();
    try {
        if (!window.sessionStorage) return;
        if (normalized) {
            window.sessionStorage.setItem(CURRENT_USER_AVATAR_STORAGE_KEY, normalized);
        } else {
            window.sessionStorage.removeItem(CURRENT_USER_AVATAR_STORAGE_KEY);
        }
    } catch (error) {
        // best-effort identity avatar memory
    }
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}

function iconHtml(name, size = 44) {
    if (typeof window.icon !== 'function') return '';
    return window.icon(name, { className: 'icon', size, strokeWidth: 2.1 });
}

function initialsFor(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function kidBubbleAvatarInner(kid, name) {
    const avatarUrl = String(kid && kid.avatarUrl || '').trim();
    if (avatarUrl) {
        return `<img class="user-bubble-avatar-img" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy">`;
    }
    return `<span class="user-bubble-initials">${escapeHtml(initialsFor(name))}</span>`;
}

function formatOfflineLockTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Unknown time';
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const date = new Date(hasTimezone ? raw : `${raw}Z`);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();
    const options = sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatOfflineBytes(value) {
    const bytes = Math.max(0, Number.parseInt(value, 10) || 0);
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${bytes} B`;
}

function persistLastViewedKidId(kidId) {
    const normalized = String(kidId || '').trim();
    if (!normalized) return;
    try {
        if (window.sessionStorage) {
            window.sessionStorage.setItem(LAST_VIEWED_KID_STORAGE_KEY, normalized);
        }
    } catch (error) {
        // best-effort navigation memory
    }
}

function showError(message) {
    if (!errorMessage) return;
    errorMessage.textContent = message;
    errorMessage.classList.toggle('hidden', !message);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}
