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

    function buildBadgeSlideMarkup(item, index) {
        const imageUrl = resolveBadgeImageUrl(item);
        const paletteKey = getPaletteKey(item);
        const title = String(item && item.title ? item.title : 'New badge');
        const reason = String(item && item.reasonText ? item.reasonText : 'You unlocked a new reward badge!');
        return `
            <article class="kid-badge-celebration-slide" data-slide-index="${index}">
                <div class="kid-badge-celebration-art-wrap kid-badge-celebration-palette-${escapeHtml(paletteKey)}">
                    ${
    imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)} badge art">`
        : '<span class="kid-badge-art-fallback">🏅</span>'
}
                </div>
                <div class="kid-badge-celebration-slide-title">${escapeHtml(title)}</div>
                <div class="kid-badge-celebration-slide-reason">${escapeHtml(reason)}</div>
            </article>
        `;
    }

    function scrollCelebrationCarouselToIndex(track, slides, index) {
        if (!track || !Array.isArray(slides) || slides.length <= 0) {
            return;
        }
        const nextIndex = Math.max(0, Math.min(slides.length - 1, index));
        const targetSlide = slides[nextIndex];
        if (!targetSlide) {
            return;
        }
        targetSlide.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
        });
    }

    function initializeCelebrationCarousel(overlay) {
        if (!overlay) {
            return;
        }
        const carousel = overlay.querySelector('.kid-badge-celebration-carousel');
        const track = carousel ? carousel.querySelector('.kid-badge-celebration-track') : null;
        if (!carousel || !track) {
            return;
        }
        const slides = Array.from(track.querySelectorAll('.kid-badge-celebration-slide'));
        if (slides.length <= 0) {
            return;
        }
        const prevBtn = carousel.querySelector('[data-carousel-action="prev"]');
        const nextBtn = carousel.querySelector('[data-carousel-action="next"]');
        const counter = carousel.querySelector('.kid-badge-celebration-carousel-counter');
        const dots = Array.from(carousel.querySelectorAll('[data-carousel-dot-index]'));

        function getActiveIndex() {
            const viewportCenter = track.scrollLeft + (track.clientWidth / 2);
            let bestIndex = 0;
            let bestDistance = Number.POSITIVE_INFINITY;
            slides.forEach((slide, index) => {
                const slideCenter = slide.offsetLeft + (slide.offsetWidth / 2);
                const distance = Math.abs(slideCenter - viewportCenter);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = index;
                }
            });
            return bestIndex;
        }

        function updateState() {
            const activeIndex = getActiveIndex();
            carousel.setAttribute('data-active-index', String(activeIndex));
            if (counter) {
                counter.textContent = `${activeIndex + 1} of ${slides.length}`;
            }
            if (prevBtn) {
                prevBtn.disabled = activeIndex <= 0;
            }
            if (nextBtn) {
                nextBtn.disabled = activeIndex >= slides.length - 1;
            }
            dots.forEach((dot) => {
                const dotIndex = Number.parseInt(dot.getAttribute('data-carousel-dot-index') || '', 10);
                const isActive = dotIndex === activeIndex;
                dot.classList.toggle('active', isActive);
                dot.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        }

        let scrollTimer = 0;
        track.addEventListener('scroll', () => {
            window.clearTimeout(scrollTimer);
            scrollTimer = window.setTimeout(updateState, 50);
        }, { passive: true });

        track.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                scrollCelebrationCarouselToIndex(track, slides, getActiveIndex() - 1);
                return;
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                scrollCelebrationCarouselToIndex(track, slides, getActiveIndex() + 1);
            }
        });

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                scrollCelebrationCarouselToIndex(track, slides, getActiveIndex() - 1);
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                scrollCelebrationCarouselToIndex(track, slides, getActiveIndex() + 1);
            });
        }
        dots.forEach((dot) => {
            dot.addEventListener('click', () => {
                const dotIndex = Number.parseInt(dot.getAttribute('data-carousel-dot-index') || '', 10);
                if (!Number.isInteger(dotIndex)) {
                    return;
                }
                scrollCelebrationCarouselToIndex(track, slides, dotIndex);
            });
        });

        window.setTimeout(updateState, 0);
    }

    function buildOverlay({ kidId, apiBase, pendingCelebrations }) {
        const awardIds = pendingCelebrations
            .map((item) => Number.parseInt(item && item.awardId, 10))
            .filter((value) => Number.isInteger(value) && value > 0);
        const totalCount = Math.max(1, pendingCelebrations.length);
        const titleText = totalCount === 1 ? 'New badge unlocked' : 'New badges unlocked';
        const subText = totalCount === 1
            ? 'Your hard work added a new reward to your badge shelf.'
            : 'Swipe through your new rewards.';
        const metaText = totalCount === 1
            ? '1 new badge added to your shelf.'
            : `${totalCount} new badges added to your shelf.`;
        const slideMarkup = pendingCelebrations
            .map((item, index) => buildBadgeSlideMarkup(item, index))
            .join('');
        const dotsMarkup = totalCount > 1
            ? pendingCelebrations.map((item, index) => `
                <button
                    type="button"
                    class="kid-badge-celebration-carousel-dot${index === 0 ? ' active' : ''}"
                    data-carousel-dot-index="${index}"
                    aria-label="Show badge ${index + 1}"
                    aria-pressed="${index === 0 ? 'true' : 'false'}"
                ></button>
            `).join('')
            : '';

        const overlay = document.createElement('div');
        overlay.className = 'kid-badge-celebration-overlay';
        overlay.innerHTML = `
            <div class="kid-badge-celebration-confetti" aria-hidden="true">
                ${buildConfettiMarkup()}
            </div>
            <div class="kid-badge-celebration-modal" role="dialog" aria-modal="true" aria-label="New badge unlocked">
                <div class="kid-badge-celebration-kicker">Reward unlocked</div>
                <h2 class="kid-badge-celebration-title">${escapeHtml(titleText)}</h2>
                <p class="kid-badge-celebration-sub">${escapeHtml(subText)}</p>
                <div class="kid-badge-celebration-carousel${totalCount === 1 ? ' kid-badge-celebration-carousel-single' : ''}" data-active-index="0">
                    <div class="kid-badge-celebration-track" tabindex="0" aria-label="Unlocked badges">
                        ${slideMarkup}
                    </div>
                    ${
    totalCount > 1
        ? `
                    <div class="kid-badge-celebration-carousel-controls">
                        <button type="button" class="kid-badge-celebration-carousel-nav" data-carousel-action="prev" aria-label="Previous badge">Prev</button>
                        <div class="kid-badge-celebration-carousel-counter">1 of ${totalCount}</div>
                        <button type="button" class="kid-badge-celebration-carousel-nav" data-carousel-action="next" aria-label="Next badge">Next</button>
                    </div>
                    <div class="kid-badge-celebration-carousel-dots" aria-label="Badge pages">
                        ${dotsMarkup}
                    </div>
        `
        : ''
}
                </div>
                <div class="kid-badge-celebration-meta">${escapeHtml(metaText)}</div>
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
        initializeCelebrationCarousel(overlay);
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
