// Reusable circular avatar cropper. Self-contained: builds its own modal on
// first open. Caller supplies an onSave(result) callback; result is
// { blob, dataUrl, size } for a circular PNG. Backend persistence is the
// caller's concern — this module only produces the cropped image.
(function () {
    const STAGE_SIZE = 280;
    const MAX_ZOOM = 4;
    const DEFAULT_OUTPUT = 256;

    const state = {
        built: false,
        modal: null,
        canvas: null,
        ctx: null,
        img: null,
        iw: 0,
        ih: 0,
        scale: 1,
        coverScale: 1,
        maxScale: 1,
        tx: 0,
        ty: 0,
        objectUrl: '',
        outputSize: DEFAULT_OUTPUT,
        onSave: null,
        pointers: new Map(),
        prevDist: 0,
        prevMid: { x: 0, y: 0 },
        saving: false,
    };

    function iconHtml(name, opts) {
        return typeof window.icon === 'function' ? window.icon(name, opts || {}) : '';
    }

    function el(sel) {
        return state.modal ? state.modal.querySelector(sel) : null;
    }

    function build() {
        if (state.built) return;
        const modal = document.createElement('div');
        modal.className = 'avatar-editor-modal modal hidden';
        modal.innerHTML = `
            <div class="modal-content avatar-editor" role="dialog" aria-modal="true" aria-labelledby="avatarEditorTitle">
                <h2 id="avatarEditorTitle">${iconHtml('image', { size: 22 })} <span class="avatar-editor-title-text">Set photo</span></h2>

                <div class="avatar-editor-pick" data-avatar-pick>
                    <button type="button" class="paradigm-btn" data-avatar-choose>${iconHtml('image', { size: 18 })} <span>Choose image</span></button>
                    <p class="avatar-editor-hint">PNG or JPG. Drag to reposition and pinch / scroll to zoom.</p>
                </div>

                <div class="avatar-editor-stage-wrap hidden" data-avatar-stage-wrap>
                    <div class="avatar-editor-stage" data-avatar-stage>
                        <canvas class="avatar-editor-canvas" data-avatar-canvas></canvas>
                        <div class="avatar-editor-mask" aria-hidden="true"></div>
                    </div>
                    <div class="avatar-editor-zoom">
                        <button type="button" class="avatar-editor-zoom-btn" data-avatar-zoom-out aria-label="Zoom out">${iconHtml('minus', { size: 18 }) || '&minus;'}</button>
                        <input type="range" class="avatar-editor-zoom-range" data-avatar-zoom min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="Zoom">
                        <button type="button" class="avatar-editor-zoom-btn" data-avatar-zoom-in aria-label="Zoom in">${iconHtml('plus', { size: 18 }) || '+'}</button>
                    </div>
                </div>

                <input type="file" accept="image/*" class="hidden" data-avatar-file>
                <div class="avatar-editor-error error hidden" data-avatar-error></div>

                <div class="avatar-editor-actions">
                    <button type="button" class="paradigm-decision-btn paradigm-decision-btn--confirm" data-avatar-save aria-label="Save" title="Save" disabled>${iconHtml('check', { size: 18 })}</button>
                    <button type="button" class="paradigm-btn avatar-editor-rechoose hidden" data-avatar-rechoose>${iconHtml('image', { size: 18 })} <span>Choose different</span></button>
                    <button type="button" class="paradigm-decision-btn paradigm-decision-btn--cancel" data-avatar-cancel aria-label="Cancel" title="Cancel">${iconHtml('x', { size: 18 })}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        state.modal = modal;
        state.canvas = modal.querySelector('[data-avatar-canvas]');
        state.ctx = state.canvas.getContext('2d');
        state.built = true;
        bindEvents();
    }

    function bindEvents() {
        const modal = state.modal;
        const fileInput = el('[data-avatar-file]');

        el('[data-avatar-choose]').addEventListener('click', () => fileInput.click());
        el('[data-avatar-rechoose]').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', onFileChange);

        el('[data-avatar-cancel]').addEventListener('click', close);
        el('[data-avatar-save]').addEventListener('click', save);

        modal.addEventListener('mousedown', (event) => {
            if (event.target === modal) close();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
        });

        const range = el('[data-avatar-zoom]');
        range.addEventListener('input', () => {
            if (!state.img) return;
            zoomAt(state.coverScale * Number(range.value || 1), STAGE_SIZE / 2, STAGE_SIZE / 2);
        });
        el('[data-avatar-zoom-in]').addEventListener('click', () => nudgeZoom(1.18));
        el('[data-avatar-zoom-out]').addEventListener('click', () => nudgeZoom(1 / 1.18));

        const canvas = state.canvas;
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
    }

    function showError(text) {
        const node = el('[data-avatar-error]');
        if (!node) return;
        node.textContent = text || '';
        node.classList.toggle('hidden', !text);
    }

    function onFileChange(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            showError('Please choose an image file.');
            return;
        }
        showError('');
        if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
        state.objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            state.img = img;
            state.iw = img.naturalWidth;
            state.ih = img.naturalHeight;
            el('[data-avatar-pick]').classList.add('hidden');
            el('[data-avatar-stage-wrap]').classList.remove('hidden');
            el('[data-avatar-rechoose]').classList.remove('hidden');
            el('[data-avatar-save]').disabled = false;
            setupCanvas();
            fitImage();
        };
        img.onerror = () => showError('Could not load that image.');
        img.src = state.objectUrl;
    }

    function setupCanvas() {
        // Backing-store resolution only; CSS controls the displayed size so the
        // stage can shrink to fit narrow screens. Pointer math maps through
        // getBoundingClientRect, so any CSS scaling stays accurate.
        const dpr = window.devicePixelRatio || 1;
        state.canvas.width = STAGE_SIZE * dpr;
        state.canvas.height = STAGE_SIZE * dpr;
    }

    function fitImage() {
        const { iw, ih } = state;
        state.coverScale = Math.max(STAGE_SIZE / iw, STAGE_SIZE / ih);
        state.maxScale = state.coverScale * MAX_ZOOM;
        state.scale = state.coverScale;
        state.tx = (STAGE_SIZE - iw * state.scale) / 2;
        state.ty = (STAGE_SIZE - ih * state.scale) / 2;
        clamp();
        syncZoomSlider();
        draw();
    }

    function clamp() {
        const w = state.iw * state.scale;
        const h = state.ih * state.scale;
        state.tx = Math.min(0, Math.max(STAGE_SIZE - w, state.tx));
        state.ty = Math.min(0, Math.max(STAGE_SIZE - h, state.ty));
    }

    function draw() {
        const { ctx, img } = state;
        if (!ctx || !img) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, STAGE_SIZE, STAGE_SIZE);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, state.tx, state.ty, state.iw * state.scale, state.ih * state.scale);
    }

    function syncZoomSlider() {
        const range = el('[data-avatar-zoom]');
        if (range) range.value = String(state.scale / state.coverScale);
    }

    function zoomAt(nextScale, focalX, focalY) {
        const clamped = Math.min(state.maxScale, Math.max(state.coverScale, nextScale));
        const imgX = (focalX - state.tx) / state.scale;
        const imgY = (focalY - state.ty) / state.scale;
        state.scale = clamped;
        state.tx = focalX - imgX * state.scale;
        state.ty = focalY - imgY * state.scale;
        clamp();
        syncZoomSlider();
        draw();
    }

    function nudgeZoom(factor) {
        if (!state.img) return;
        zoomAt(state.scale * factor, STAGE_SIZE / 2, STAGE_SIZE / 2);
    }

    function toStage(event) {
        const rect = state.canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (STAGE_SIZE / rect.width),
            y: (event.clientY - rect.top) * (STAGE_SIZE / rect.height),
        };
    }

    function onWheel(event) {
        if (!state.img) return;
        event.preventDefault();
        const focal = toStage(event);
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomAt(state.scale * factor, focal.x, focal.y);
    }

    function pointerMid() {
        const points = Array.from(state.pointers.values());
        const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: sum.x / points.length, y: sum.y / points.length };
    }

    function pointerDist() {
        const points = Array.from(state.pointers.values());
        if (points.length < 2) return 0;
        return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }

    function onPointerDown(event) {
        if (!state.img) return;
        state.canvas.setPointerCapture(event.pointerId);
        state.pointers.set(event.pointerId, toStage(event));
        state.prevMid = pointerMid();
        state.prevDist = pointerDist();
    }

    function onPointerMove(event) {
        if (!state.img || !state.pointers.has(event.pointerId)) return;
        state.pointers.set(event.pointerId, toStage(event));
        const mid = pointerMid();
        if (state.pointers.size >= 2) {
            const dist = pointerDist();
            if (state.prevDist > 0 && dist > 0) {
                zoomAt(state.scale * (dist / state.prevDist), mid.x, mid.y);
            }
            state.tx += mid.x - state.prevMid.x;
            state.ty += mid.y - state.prevMid.y;
            clamp();
            draw();
        } else {
            state.tx += mid.x - state.prevMid.x;
            state.ty += mid.y - state.prevMid.y;
            clamp();
            draw();
        }
        state.prevMid = mid;
        state.prevDist = pointerDist();
    }

    function onPointerUp(event) {
        if (!state.pointers.has(event.pointerId)) return;
        state.pointers.delete(event.pointerId);
        state.prevMid = state.pointers.size ? pointerMid() : { x: 0, y: 0 };
        state.prevDist = pointerDist();
    }

    function save() {
        if (!state.img || state.saving) return;
        state.saving = true;
        const out = state.outputSize;
        const canvas = document.createElement('canvas');
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.save();
        ctx.beginPath();
        ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const ratio = out / STAGE_SIZE;
        ctx.drawImage(
            state.img,
            state.tx * ratio,
            state.ty * ratio,
            state.iw * state.scale * ratio,
            state.ih * state.scale * ratio,
        );
        ctx.restore();
        const finish = async (blob) => {
            const dataUrl = canvas.toDataURL('image/png');
            try {
                if (typeof state.onSave === 'function') {
                    await state.onSave({ blob, dataUrl, size: out });
                }
                close();
            } catch (error) {
                showError(error && error.message ? error.message : 'Failed to save photo.');
            } finally {
                state.saving = false;
            }
        };
        if (canvas.toBlob) {
            canvas.toBlob((blob) => finish(blob), 'image/png');
        } else {
            finish(null);
        }
    }

    function resetUi() {
        showError('');
        state.pointers.clear();
        el('[data-avatar-pick]').classList.remove('hidden');
        el('[data-avatar-stage-wrap]').classList.add('hidden');
        el('[data-avatar-rechoose]').classList.add('hidden');
        el('[data-avatar-save]').disabled = true;
        const range = el('[data-avatar-zoom]');
        if (range) range.value = '1';
    }

    function open(options) {
        build();
        const opts = options || {};
        state.onSave = typeof opts.onSave === 'function' ? opts.onSave : null;
        state.outputSize = Number.parseInt(opts.outputSize, 10) > 0 ? Number.parseInt(opts.outputSize, 10) : DEFAULT_OUTPUT;
        state.img = null;
        state.saving = false;
        el('.avatar-editor-title-text').textContent = String(opts.title || 'Set photo');
        resetUi();
        state.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function close() {
        if (!state.modal) return;
        state.modal.classList.add('hidden');
        document.body.style.overflow = '';
        if (state.objectUrl) {
            URL.revokeObjectURL(state.objectUrl);
            state.objectUrl = '';
        }
        state.img = null;
        state.pointers.clear();
    }

    window.AvatarEditor = { open, close };
})();
