(function initKidBadgeCelebration(global) {
    const state = {
        checkedKidIds: new Set(),
        activeOverlay: null,
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function resolveBadgeImageUrl(item) {
        const imageUrl = String(item && item.badgeImageUrl ? item.badgeImageUrl : '').trim();
        if (imageUrl) {
            return imageUrl;
        }
        const imagePath = String(item && item.badgeImagePath ? item.badgeImagePath : '').trim();
        if (!imagePath) {
            return '';
        }
        return `/${imagePath.replace(/^\/+/, '')}`;
    }

    function getPaletteKey(item) {
        const categoryKey = String(item && item.categoryKey ? item.categoryKey : '').trim().toLowerCase();
        if (categoryKey === 'chinese_characters') {
            return 'characters';
        }
        if (categoryKey === 'chinese_writing') {
            return 'writing';
        }
        if (categoryKey === 'chinese_reading') {
            return 'reading';
        }
        if (categoryKey === 'math') {
            return 'math';
        }
        return 'global';
    }

    function buildConfettiMarkup() {
        const pieces = [
            { left: '7%', delay: '0ms', duration: '3400ms', drift: '22px', rotate: '-14deg', width: '12px', height: '22px', a: '#ffd35f', b: '#ff8a7c' },
            { left: '15%', delay: '320ms', duration: '3700ms', drift: '-24px', rotate: '12deg', width: '10px', height: '20px', a: '#7fd7ff', b: '#5b8dff' },
            { left: '23%', delay: '680ms', duration: '3500ms', drift: '18px', rotate: '22deg', width: '14px', height: '24px', a: '#ff9fd0', b: '#ff7b92' },
            { left: '34%', delay: '150ms', duration: '3900ms', drift: '-16px', rotate: '-8deg', width: '11px', height: '18px', a: '#9deda9', b: '#59c990' },
            { left: '44%', delay: '1040ms', duration: '3600ms', drift: '28px', rotate: '10deg', width: '12px', height: '22px', a: '#ffd35f', b: '#ffa75f' },
            { left: '56%', delay: '460ms', duration: '3450ms', drift: '-22px', rotate: '-20deg', width: '10px', height: '18px', a: '#a8b8ff', b: '#7285ff' },
            { left: '66%', delay: '880ms', duration: '3720ms', drift: '14px', rotate: '16deg', width: '13px', height: '24px', a: '#ffb4e0', b: '#ff8f7a' },
            { left: '74%', delay: '210ms', duration: '3550ms', drift: '-28px', rotate: '-12deg', width: '10px', height: '18px', a: '#8fe9ce', b: '#6bc3ff' },
            { left: '82%', delay: '1120ms', duration: '3820ms', drift: '20px', rotate: '14deg', width: '12px', height: '22px', a: '#ffe07b', b: '#ffc357' },
            { left: '90%', delay: '560ms', duration: '3650ms', drift: '-18px', rotate: '-18deg', width: '14px', height: '24px', a: '#8fc0ff', b: '#7a8cff' },
        ];
        return pieces.map((piece) => `
            <span
                class="kid-badge-celebration-confetti-piece"
                style="
                    --piece-left:${piece.left};
                    --piece-delay:${piece.delay};
                    --piece-duration:${piece.duration};
                    --piece-drift:${piece.drift};
                    --piece-rotate:${piece.rotate};
                    --piece-width:${piece.width};
                    --piece-height:${piece.height};
                    --piece-color-a:${piece.a};
                    --piece-color-b:${piece.b};
                "
            ></span>
        `).join('');
    }

    async function markSeen({ kidId, apiBase, awardIds }) {
        try {
            await fetch(`${apiBase}/kids/${encodeURIComponent(kidId)}/badges/celebrations/seen`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    awardIds: Array.isArray(awardIds) ? awardIds : [],
                }),
            });
        } catch (error) {
            console.error('Failed to mark badge celebration seen:', error);
        }
    }

    function closeOverlay(overlay) {
        if (!overlay) {
            return Promise.resolve();
        }
        if (overlay.dataset.closing === '1') {
            return Promise.resolve();
        }
        overlay.dataset.closing = '1';
        overlay.classList.add('closing');
        return new Promise((resolve) => {
            window.setTimeout(() => {
                overlay.remove();
                if (state.activeOverlay === overlay) {
                    state.activeOverlay = null;
                }
                resolve();
            }, 210);
        });
    }

    function buildOverlay({ kidId, apiBase, pendingCelebrations }) {
        const first = pendingCelebrations[0] || {};
        const awardIds = pendingCelebrations
            .map((item) => Number.parseInt(item && item.awardId, 10))
            .filter((value) => Number.isInteger(value) && value > 0);
        const imageUrl = resolveBadgeImageUrl(first);
        const paletteKey = getPaletteKey(first);
        const title = String(first.title || 'New badge');
        const reason = String(first.reasonText || 'You unlocked a new reward badge!');
        const totalCount = Math.max(1, pendingCelebrations.length);

        const overlay = document.createElement('div');
        overlay.className = 'kid-badge-celebration-overlay';
        overlay.innerHTML = `
            <div class="kid-badge-celebration-confetti" aria-hidden="true">
                ${buildConfettiMarkup()}
            </div>
            <div class="kid-badge-celebration-modal" role="dialog" aria-modal="true" aria-label="New badge unlocked">
                <div class="kid-badge-celebration-kicker">Reward unlocked</div>
                <h2 class="kid-badge-celebration-title">New badge unlocked</h2>
                <p class="kid-badge-celebration-sub">Your hard work added a new reward to your badge shelf.</p>
                <div class="kid-badge-celebration-art-stage">
                    <span class="kid-badge-celebration-spark kid-badge-celebration-spark-1" aria-hidden="true"></span>
                    <span class="kid-badge-celebration-spark kid-badge-celebration-spark-2" aria-hidden="true"></span>
                    <span class="kid-badge-celebration-spark kid-badge-celebration-spark-3" aria-hidden="true"></span>
                    <span class="kid-badge-celebration-spark kid-badge-celebration-spark-4" aria-hidden="true"></span>
                    <span class="kid-badge-celebration-spark kid-badge-celebration-spark-5" aria-hidden="true"></span>
                    <span class="kid-badge-celebration-spark kid-badge-celebration-spark-6" aria-hidden="true"></span>
                    <div class="kid-badge-celebration-art-wrap kid-badge-celebration-palette-${escapeHtml(paletteKey)}">
                        ${
    imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)} badge art">`
        : '<span class="kid-badge-art-fallback">🏅</span>'
}
                    </div>
                </div>
                <div class="kid-badge-celebration-name">${escapeHtml(title)}</div>
                <div class="kid-badge-celebration-reason">${escapeHtml(reason)}</div>
                <div class="kid-badge-celebration-meta">
                    ${
    totalCount > 1
        ? `${totalCount} new badges are waiting in the shelf.`
        : '1 new badge added to your shelf.'
}
                </div>
                <div class="kid-badge-celebration-actions">
                    <button type="button" class="control-btn start-btn" data-celebration-action="view">🏅 View Badges</button>
                    <button type="button" class="control-btn secondary-btn" data-celebration-action="close">Nice!</button>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                void markSeen({ kidId, apiBase, awardIds });
                void closeOverlay(overlay);
            }
        });

        const viewBtn = overlay.querySelector('[data-celebration-action="view"]');
        const closeBtn = overlay.querySelector('[data-celebration-action="close"]');
        if (viewBtn) {
            viewBtn.addEventListener('click', async () => {
                const closePromise = closeOverlay(overlay);
                await markSeen({ kidId, apiBase, awardIds });
                await closePromise;
                if (window.KidBadgeShelfModal && typeof window.KidBadgeShelfModal.open === 'function') {
                    await window.KidBadgeShelfModal.open({
                        kidId,
                        kidName: '',
                        apiBase,
                        forceRefresh: true,
                    });
                    return;
                }
                window.location.href = `/kid-practice-home.html?id=${encodeURIComponent(kidId)}`;
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                void markSeen({ kidId, apiBase, awardIds });
                await closeOverlay(overlay);
            });
        }
        return overlay;
    }

    async function maybeShowForKid({ kidId, apiBase }) {
        const normalizedKidId = String(kidId || '').trim();
        if (!normalizedKidId) {
            return;
        }
        if (state.checkedKidIds.has(normalizedKidId) || state.activeOverlay) {
            return;
        }
        state.checkedKidIds.add(normalizedKidId);

        try {
            const response = await fetch(
                `${apiBase}/kids/${encodeURIComponent(normalizedKidId)}/badges/celebrations/pending`
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                return;
            }
            if (!payload || !payload.trackingEnabled) {
                return;
            }
            const pendingCelebrations = Array.isArray(payload.pendingCelebrations)
                ? payload.pendingCelebrations
                : [];
            if (pendingCelebrations.length <= 0) {
                return;
            }
            const overlay = buildOverlay({
                kidId: normalizedKidId,
                apiBase,
                pendingCelebrations,
            });
            state.activeOverlay = overlay;
            document.body.appendChild(overlay);
        } catch (error) {
            console.error('Error loading badge celebrations:', error);
        }
    }

    global.KidBadgeCelebration = {
        maybeShowForKid,
    };
}(window));
