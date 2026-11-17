// Local implementation of the existing kid practice API contracts. No UI code.
globalThis.OfflinePracticeApi = (() => {
    const data = () => globalThis.OfflinePracticeData;
    const json = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    const shuffle = (items) => [...items].sort(() => Math.random() - 0.5);
    function responseCard(card, task, mode) {
        if (task.behavior !== 'type_iv') return { ...card, prompt_audio_url: card.audioUrl || card.prompt_audio_url,
            available_for_practice: true };
        return { id: card.id, front: card.prompt, isMultichoiceOnly: Boolean(card.is_multichoice_only),
            choices: mode === 'multi' || card.is_multichoice_only
                ? shuffle([...new Set([String(card.answer), ...(card.distractor_answers || []).map(String)])]) : undefined };
    }
    function readiness(task, record = {}) {
        const retry = record.answers?.length && data().indices(task, record).some((index) => Boolean(record.answers[index]));
        const remaining = record.drill && record.answers.length < task.target
            ? task.target - record.answers.length : data().indices(task, record).length;
        return { is_continue_session: Boolean(record.answers?.length && !retry && remaining),
            continue_card_count: remaining, continue_source_session_id: 1,
            is_retry_session: Boolean(retry), retry_card_count: remaining, retry_source_session_id: 1,
            source_practice_mode: retry ? String(record.practiceMode || task.mode).replace('+drill', '') : record.practiceMode,
            latest_practice_mode: record.practiceMode || task.mode, total_session_count: remaining || task.target,
            configured_session_count: task.target, total_active_cards: task.cards.length };
    }
    function sheetTask(task, record = {}) {
        return { id: task.sheetTaskId, category_key: task.categoryKey, items: task.items.map((item) => ({ ...item,
            correct: typeof record.grades?.[item.id] === 'boolean' ? (record.grades[item.id] ? 1 : -1) : null,
            result_id: typeof record.grades?.[item.id] === 'boolean' ? item.id : null })),
            grading_policy: task.behavior === 'type_ii' ? 'completion' : 'per_item',
            unique_character_count: task.target, practice_box_count: task.items.length,
            status: ['done', 'closed'].includes(record.status) ? 'reviewed'
                : record.status === 'pending_review' ? 'pending_review' : 'in_progress' };
    }
    async function handle(request, setup) {
        const url = new URL(request.url);
        const prefix = `/api/kids/${encodeURIComponent(setup.kidId)}`;
        if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return null;
        const path = url.pathname.slice(prefix.length);
        try {
            let all = await data().records(setup);
            if (!path && request.method === 'GET') return json(data().kidPayload(setup, all));
            if (path === '/points' && request.method === 'GET') return json({
                kidId: setup.kidId, totalPoints: setup.manifest.practiceConfig?.pointTotal || 0,
                rewardBucketTotals: {}, events: [],
            });
            if (path.startsWith('/avatar')) return null; // Downloaded versioned image.
            const audioPath = '/lesson-reading/audio/';
            if (path.startsWith(audioPath)) {
                const clip = await globalThis.OfflineSetupStore.readValue(decodeURIComponent(path.slice(audioPath.length)));
                if (!clip?.blob) return json({ error: 'Recording not found on this device.' }, 404);
                const headers = { 'Content-Type': clip.mimeType || clip.blob.type, 'Accept-Ranges': 'bytes' };
                const range = request.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/);
                if (range && (range[1] || range[2])) {
                    const size = clip.blob.size;
                    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
                    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
                    if (start >= size || end < start) return new Response(null, { status: 416,
                        headers: { ...headers, 'Content-Range': `bytes */${size}` } });
                    return new Response(clip.blob.slice(start, end + 1), { status: 206,
                        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
                }
                return new Response(clip.blob, { headers: { ...headers, 'Content-Length': String(clip.blob.size) } });
            }
            if (path.startsWith('/off-app-chores')) {
                const tasks = setup.manifest.tasks.filter((task) => task.delivery === 'offapp' && task.date === data().today(setup));
                if (request.method === 'GET') {
                    const chores = tasks.map((task) => ({ ruleId: task.ruleId, name: task.name, emoji: task.emoji,
                        creditedToday: all[task.id]?.status === 'done', creditedEvent: all[task.id]?.status === 'done'
                            ? { pointsDelta: all[task.id].points } : null,
                        pending: all[task.id]?.status === 'pending_review' ? { pendingId: setup.manifest.tasks.indexOf(task) + 1, ruleId: task.ruleId } : null }));
                    return json({ chores, pending: chores.map((chore) => chore.pending).filter(Boolean) });
                }
                const rule = path.match(/^\/off-app-chores\/(\d+)\/submit$/);
                const pending = path.match(/^\/off-app-chores\/pending\/(\d+)$/);
                const task = rule ? tasks.find((item) => String(item.ruleId) === rule[1])
                    : pending ? tasks.find((item) => setup.manifest.tasks.indexOf(item) + 1 === Number(pending[1])) : null;
                if (!task) throw new Error('Off-app task not found for today.');
                await data().change(setup, task, (record) => {
                    if (record.status === 'done') throw new Error('This task has already been reviewed.');
                    record.status = request.method === 'DELETE' ? 'not_started' : 'pending_review';
                    record.submittedAt = new Date().toISOString();
                });
                return json({ saved: true });
            }
            const body = request.method === 'GET' ? {} : request.headers.get('Content-Type')?.includes('application/json')
                ? await request.json() : null;
            let task = data().taskFor(setup, url.searchParams.get('categoryKey') || body?.categoryKey);
            if (path === '/offline-practice/progress' || path.endsWith('/practice/upload-audio')) {
                const form = await request.formData();
                const payload = form.has('payload') ? JSON.parse(form.get('payload')) : {
                    pendingSessionId: form.get('pendingSessionId'), answers: [],
                };
                task = data().pendingTask(setup, payload.pendingSessionId);
                const clips = {};
                for (const [key, blob] of form.entries()) {
                    if (key.startsWith('audio:')) clips[key.slice(6)] = { blob, mimeType: blob.type };
                }
                if (path.endsWith('/upload-audio')) {
                    const record = all[task.id];
                    if (record?.pendingId !== payload.pendingSessionId) throw new Error('Offline session not found.');
                    const cardId = form.get('cardId');
                    const clip = form.get('audio');
                    let audioId;
                    await data().change(setup, task, (saved, metadata) => {
                        const answer = saved.answers.find((item) => String(item?.cardId) === cardId);
                        if (!answer || !clip?.size) throw new Error('Recording is empty or unassigned.');
                        answer.audioId ||= `audio:${setup.id}:${task.id}:${cardId}`;
                        audioId = answer.audioId;
                        metadata.put({ blob: clip, mimeType: clip.type }, answer.audioId);
                    });
                    return json({ saved: true, audio_url: `${prefix}${audioPath}${encodeURIComponent(audioId)}` });
                }
                await data().save(setup, task, payload, clips);
                return json({ saved: true });
            }
            if (path === '/offline-practice/discard') {
                task = data().pendingTask(setup, body.pendingSessionId);
                await data().change(setup, task, (record) => {
                    if (record.pendingId !== body.pendingSessionId || !record.drill || record.batchRetry) throw new Error('This attempt cannot be discarded.');
                    record.answers = record.answers.slice(0, record.batchOffset);
                    record.clientProgress = record.batchStartProgress;
                    record.pendingId = null;
                    record.status = record.answers.length ? 'in_progress' : 'not_started';
                    delete record.completedAt;
                });
                return json({ saved: true });
            }
            if (path.startsWith('/sheet-tasks')) {
                const detail = path.match(/^\/sheet-tasks\/(-?\d+)(?:\/(undo|review))?$/);
                if (detail) task = setup.manifest.tasks.find((item) => item.sheetTaskId === Number(detail[1]));
                if (path === '/sheet-tasks') return json({ supported: true, mode: task?.delivery || 'online', target_count: task?.target || 0 });
                if (!task || task.delivery !== 'sheet') return json(null);
                if (request.method !== 'GET') await data().change(setup, task, (record) => {
                    if (['done', 'closed'].includes(record.status)) throw new Error('This sheet has already been reviewed.');
                    if (detail?.[2] === 'undo') {
                        if (record.status !== 'pending_review') throw new Error('This sheet has not been submitted.');
                        record.status = 'in_progress';
                    }
                    else if (detail?.[2] === 'review') {
                        throw new Error('Enter offline parent mode to review this sheet.');
                    } else if (path === '/sheet-tasks/submit' && request.method === 'POST') record.status = 'pending_review';
                    else throw new Error('This sheet action is unavailable offline.');
                    record.submittedAt = new Date().toISOString();
                });
                all = await data().records(setup);
                return json(sheetTask(task, all[task.id]));
            }
            const snapshot = Object.entries(setup.manifest.snapshots || {}).find(([key]) => new URL(key, url.origin).pathname === url.pathname);
            if (snapshot && request.method === 'GET') return json(snapshot[1]);
            if (path.endsWith('/speed-drill-mode')) return json({ supported: Boolean(task?.drill),
                speed_drill_enabled: Boolean(task?.drill), drill_speed_target_ms: task?.speedTargetMs, minimum_daily_target: 20 });
            if (request.method === 'POST' && path.endsWith('/thumb-down')) {
                const cardId = path.split('/')[2];
                if (!task) task = setup.manifest.tasks.find((item) => item.date === data().today(setup) && item.cards?.some((card) => String(card.id) === cardId));
                if (!task) throw new Error('Card not assigned for today.');
                await data().change(setup, task, (record) => { record.thumbsDown = [...new Set([...(record.thumbsDown || []), Number(cardId)])]; });
                return json({ saved: true });
            }
            const practicePath = path.endsWith('/decks') || path === '/type2/cards'
                || path.endsWith('/practice/start') || path.endsWith('/practice/complete');
            if (!practicePath) return null;
            if (path.endsWith('/practice/complete')) task = data().pendingTask(setup, body.pendingSessionId);
            if (!task) throw new Error('No task is assigned for this subject today.');
            const record = all[task.id] || {};
            const meta = setup.manifest.practiceConfig?.categoryMetaByKey?.[task.categoryKey] || {};
            if (request.method === 'GET' && (path.endsWith('/decks') || path === '/type2/cards')) {
                const ready = readiness(task, record);
                return json({ ...ready, has_chinese_specific_logic: task.chinese, chinese_back_content: meta.chinese_back_content,
                    cards: task.cards.map((card) => responseCard(card, task, record.practiceMode || task.mode)),
                    decks: [{ deck_id: 1, label: task.name, total_cards: task.cards.length, session_count: ready.total_session_count,
                        opted_in: true, included_in_queue: true }], drill_speed_target_ms: task.speedTargetMs });
            }
            if (request.method === 'POST' && path.endsWith('/practice/start')) {
                const saved = await data().start(setup, task, body.practiceMode);
                const runMode = saved.batchRetry ? String(saved.practiceMode).replace('+drill', '') : saved.practiceMode;
                return json({ ...readiness(task, saved), pending_session_id: saved.pendingId, practice_mode: runMode,
                    cards: data().batchCards(task, saved).map((card) => responseCard(card, task, runMode)),
                    planned_count: task.target, drill_speed_target_ms: task.speedTargetMs,
                    client_progress: saved.drill && !saved.batchRetry ? saved.clientProgress : null,
                    multiple_choice_pool_cards: task.choicePool?.map((back, index) => ({ id: -(index + 1), back })) || task.cards });
            }
            if (request.method === 'POST' && path.endsWith('/practice/complete')) {
                task = data().pendingTask(setup, body.pendingSessionId);
                const saved = await data().complete(setup, task, body);
                const answers = saved.answers.filter(Boolean);
                return json({ session_id: setup.manifest.tasks.indexOf(task) + 1, answer_count: answers.length,
                    planned_count: task.target, target_answer_count: task.target,
                    wrong_count: answers.filter((answer) => answer.grade === false).length, partial_count: 0,
                    requires_review: saved.status === 'pending_review', is_retry_session: saved.batchRetry });
            }
            return null;
        } catch (error) { return json({ error: error.message || 'Could not save local practice data.' }, 400); }
    }
    return { handle, json };
})();
