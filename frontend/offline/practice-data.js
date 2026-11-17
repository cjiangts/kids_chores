// Device-owned practice records. Uses the existing metadata store, with no schema upgrade.
globalThis.OfflinePracticeData = (() => {
    const store = () => globalThis.OfflineSetupStore;
    const recordKey = (setup) => `practice:${setup.id}`;
    function today(setup) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
            timeZone: setup.manifest.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(new Date()).map((part) => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }
    const records = async (setup) => await store().readValue(recordKey(setup)) || {};
    const taskFor = (setup, category) => setup.manifest.tasks.find((task) => task.date === today(setup) && task.categoryKey === category);
    function pendingTask(setup, pendingId) {
        const id = decodeURIComponent(String(pendingId || '').split(':')[1] || '');
        const task = setup.manifest.tasks.find((item) => item.id === id && item.date <= today(setup));
        if (!task) throw new Error('Offline session not found.');
        return task;
    }
    function change(setup, task, update) {
        return store().changeValue(recordKey(setup), (all, metadata) => {
            all ||= {};
            if (all.__uploading) throw new Error('This offline package is being uploaded. Return to Choose user to finish or retry the upload.');
            const record = all[task.id] || { status: 'not_started', answers: [] };
            update(record, metadata);
            record.updatedAt = new Date().toISOString();
            all[task.id] = record;
            return all;
        }).then((all) => all[task.id]);
    }
    function indices(task, record = {}) {
        const answers = record.answers || [];
        if (record.drill && answers.length < task.target) return [];
        const count = record.drill ? task.target : Math.min(task.target, task.cards.length);
        const missing = Array.from({ length: count }, (_, index) => index).filter((index) => !answers[index]);
        if (missing.length) return missing;
        return answers.map((answer, index) => answer?.grade === false ? index : -1).filter((index) => index >= 0);
    }
    function isReview(task) {
        return task.review || task.behavior === 'type_iii' || task.behavior === 'type_iv';
    }
    function updateStatus(task, record) {
        const answers = (record.answers || []).filter(Boolean);
        const count = record.drill ? task.target : Math.min(task.target, task.cards.length);
        record.status = answers.length < count ? 'in_progress'
            : answers.some((answer) => answer.grade == null) ? 'pending_review'
            : answers.some((answer) => !answer.grade) ? 'corrections' : 'done';
        if (record.status === 'done') record.completedAt = new Date().toISOString();
    }
    function cardAt(task, record, index) {
        const answer = record.answers?.[index];
        return answer ? task.cards.find((card) => String(card.id) === String(answer.cardId)) : task.cards[index];
    }
    async function start(setup, task, requestedMode) {
        return change(setup, task, (record) => {
            if (['done', 'pending_review', 'closed'].includes(record.status)) throw new Error('This task is already submitted.');
            const fresh = !record.answers.length;
            if (fresh) {
                record.drill = Boolean(task.drill && String(requestedMode).endsWith('+drill'));
                record.practiceMode = task.behavior === 'type_ii' && task.review ? 'parent_review' : requestedMode || task.mode;
            }
            record.batchIndices = indices(task, record);
            record.batchOffset = record.answers.length;
            record.batchStartProgress = record.clientProgress || null;
            record.batchRetry = !record.drill && record.batchIndices.some((index) => Boolean(record.answers[index]));
            if (record.drill && record.answers.length >= task.target) record.batchRetry = true;
            record.pendingId = `offline:${encodeURIComponent(task.id)}:${crypto.randomUUID()}`;
            record.startedAt ||= new Date().toISOString();
            record.status = record.answers.some(Boolean) ? 'in_progress' : 'not_started';
        });
    }
    function batchCards(task, record) {
        return record.drill && !record.batchRetry ? task.cards
            : record.batchIndices.map((index) => cardAt(task, record, index)).filter(Boolean);
    }
    async function save(setup, task, payload, audio = {}) {
        if (!Array.isArray(payload.answers)) throw new Error('Answers are required.');
        return change(setup, task, (record, metadata) => {
            if (record.pendingId !== payload.pendingSessionId) throw new Error('This session was opened in another tab. Reload to resume.');
            if (['done', 'closed'].includes(record.status)) return;
            const used = new Set();
            for (let i = 0; i < payload.answers.length; i++) {
                const raw = payload.answers[i];
                // The existing player shuffles cards. Match their IDs rather than
                // assuming the player's display order is the package order.
                const index = record.drill && !record.batchRetry ? record.batchOffset + i
                    : record.batchIndices.find((slot) => !used.has(slot)
                        && String(cardAt(task, record, slot)?.id) === String(raw.cardId));
                if (index == null || index >= task.target) throw new Error('Answer is outside the assigned session.');
                used.add(index);
                const card = task.cards.find((item) => String(item.id) === String(raw.cardId));
                if (!card) throw new Error('Answer references an unassigned card.');
                const previous = record.answers[index];
                const grade = isReview(task) ? null : Boolean(raw.known);
                const result = { ...raw, cardId: card.id, grade,
                    firstCorrect: previous?.firstCorrect ?? (grade == null ? undefined : grade),
                    responseTimeMs: Math.max(0, Number(raw.responseTimeMs) || 0),
                    audioId: previous?.audioId };
                const clip = audio[String(card.id)];
                if (clip) {
                    result.audioId = `audio:${setup.id}:${task.id}:${index}`;
                    metadata.put(clip, result.audioId);
                }
                record.answers[index] = result;
            }
            if (payload.clientProgress) record.clientProgress = payload.clientProgress;
            updateStatus(task, record);
        });
    }
    async function complete(setup, task, payload) {
        await save(setup, task, payload);
        return change(setup, task, (record) => {
            updateStatus(task, record);
            record.submittedAt = new Date().toISOString();
        });
    }
    function kidPayload(setup, all) {
        const manifest = setup.manifest;
        const config = manifest.practiceConfig || {};
        const meta = { ...config.categoryMetaByKey };
        const targets = { ...config.targetsByCategory };
        for (const task of manifest.tasks.filter((item) => item.categoryKey)) {
            meta[task.categoryKey] ||= { behavior_type: task.behavior, has_chinese_specific_logic: task.chinese,
                display_name: task.name, chinese_back_content: task.chinese ? 'pinyin' : '' };
            targets[task.categoryKey] ||= task.target;
        }
        const completed = {}, tried = {}, right = {}, status = {}, percent = {}, dailyTarget = {};
        for (const [key, target] of Object.entries(targets)) {
            const task = taskFor(setup, key);
            const record = task ? all[task.id] : null;
            const alreadyDone = !task && today(setup) === manifest.startDate && manifest.completedToday?.includes(meta[key]?.display_name);
            targets[key] = task?.target || (alreadyDone ? target : 0);
            const answers = (record?.answers || []).filter(Boolean);
            tried[key] = alreadyDone ? target : task?.delivery === 'sheet' && record?.status === 'pending_review' ? task.target : answers.length;
            right[key] = alreadyDone ? target : answers.filter((answer) => answer.grade === true).length;
            completed[key] = alreadyDone || record?.status === 'done' ? target : 0;
            dailyTarget[key] = task?.target || target;
            percent[key] = target ? 100 * right[key] / target : 0;
            status[key] = { status: alreadyDone || ['done', 'pending_review', 'closed'].includes(record?.status) ? 'done'
                : tried[key] ? 'in_progress' : 'not_started', pendingReview: record?.status === 'pending_review',
                deliveryMode: task?.delivery || 'online', earnedPoints: 0 };
        }
        return { id: setup.kidId, name: manifest.kidName, avatarUrl: config.avatarUrl,
            sessionCardCountByCategory: targets, practiceTargetByDeckCategory: targets,
            optedInDeckCategoryKeys: Object.keys(targets).filter((key) => targets[key] > 0), deckCategoryMetaByKey: meta,
            dailyCompletedByDeckCategory: completed, dailyTriedByDeckCategory: tried, dailyRightByDeckCategory: right,
            dailyTargetByDeckCategory: dailyTarget, dailyPercentByDeckCategory: percent, dailyStarTiersByDeckCategory: {},
            todaySessionStatusByDeckCategory: status, dailyStartedByDeckCategory: tried };
    }
    return { today, records, taskFor, pendingTask, change, indices, start, batchCards, save, complete, kidPayload, recordKey };
})();
