// Local contracts consumed by the existing parent Home and grading controls.
globalThis.OfflineParentApi = (() => {
    const data = () => globalThis.OfflinePracticeData;
    const json = (...args) => globalThis.OfflinePracticeApi.json(...args);
    const id = (setup, task) => setup.manifest.tasks.indexOf(task) + 1;
    const available = (setup) => setup.manifest.tasks.filter((task) => task.date <= data().today(setup));
    const unsettled = (record) => record && !['done', 'closed', 'not_started'].includes(record.status);
    function selected(setup, all, key) {
        const tasks = available(setup).filter((task) => task.categoryKey === key);
        if (setup.reviewDate) return tasks.find((task) => task.date === setup.reviewDate);
        return tasks.find((task) => unsettled(all[task.id]))
            || tasks.find((task) => task.date === data().today(setup));
    }
    function kid(setup, all) {
        const payload = data().kidPayload(setup, all);
        const keys = [...new Set(available(setup).filter((task) => !setup.reviewDate || task.date === setup.reviewDate).map((task) => task.categoryKey).filter(Boolean))];
        payload.optedInDeckCategoryKeys = keys;
        payload.deckCategoryMetaByKey = Object.fromEntries(keys.map((key) => [key, payload.deckCategoryMetaByKey[key]]));
        for (const key of keys) {
            const task = selected(setup, all, key);
            if (!task) continue;
            const record = all[task.id];
            payload.practiceTargetByDeckCategory[key] = task.target;
            payload.todaySessionStatusByDeckCategory[key] = {
                status: ['done', 'closed', 'pending_review'].includes(record?.status) ? 'done'
                    : record?.answers?.length || record?.status === 'in_progress' ? 'in_progress' : 'not_started',
                pendingReview: record?.status === 'pending_review',
                sessionId: record && record.status !== 'not_started' ? id(setup, task) : null,
            };
        }
        return payload;
    }
    function offappTasks(setup, all) {
        const tasks = available(setup).filter((task) => task.delivery === 'offapp');
        if (setup.reviewDate) return tasks.filter((task) => task.date === setup.reviewDate);
        return [...new Set(tasks.map((task) => task.ruleId))].map((ruleId) =>
            tasks.find((task) => task.ruleId === ruleId && all[task.id]?.status === 'pending_review')
            || tasks.find((task) => task.ruleId === ruleId && task.date === data().today(setup))).filter(Boolean);
    }
    function offapp(setup, all) {
        const chores = offappTasks(setup, all).map((task) => {
            const record = all[task.id];
            const rule = { ruleId: task.ruleId, name: task.name, emoji: task.emoji, ruleKind: 'off_app_chore', isActive: true };
            return { ...rule, pending: record?.status === 'pending_review' ? {
                pendingId: id(setup, task), ruleId: task.ruleId, rule, createdAt: task.date,
            } : null, creditedToday: record?.status === 'done', creditedEvent: record?.status === 'done' ? {
                eventId: id(setup, task), ruleId: task.ruleId, pointsDelta: record.points, note: record.note || '', rule,
            } : null };
        });
        return { chores, pending: chores.map((item) => item.pending).filter(Boolean) };
    }
    function sheet(task, record = {}) {
        return { id: task.sheetTaskId, category_key: task.categoryKey,
            items: task.items.map((item) => ({ ...item,
                correct: typeof record.grades?.[item.id] === 'boolean' ? (record.grades[item.id] ? 1 : -1) : null,
                result_id: typeof record.grades?.[item.id] === 'boolean' ? item.id : null })),
            grading_policy: task.behavior === 'type_ii' ? 'completion' : 'per_item',
            unique_character_count: task.target, practice_box_count: task.items.length,
            status: ['done', 'closed'].includes(record.status) ? 'reviewed'
                : record.status === 'pending_review' ? 'pending_review' : 'in_progress' };
    }
    function report(setup, task, record = {}) {
        const mode = record.practiceMode || task.mode;
        return { kid: { id: setup.kidId, name: setup.manifest.kidName, avatarUrl: setup.manifest.practiceConfig?.avatarUrl },
            session: { id: id(setup, task), type: task.categoryKey, category_display_name: task.name,
                behavior_type: task.behavior, has_chinese_specific_logic: task.chinese,
                practice_mode: mode, delivery_mode: task.delivery, planned_count: task.target,
                parent_finalized: ['done', 'closed'].includes(record.status),
                started_at: record.startedAt || `${task.date}T12:00:00Z` },
            sheet_task: task.delivery === 'sheet' ? sheet(task, record) : null,
            answers: (record.answers || []).flatMap((answer, index) => {
                if (!answer) return [];
                const card = task.cards.find((item) => String(item.id) === String(answer.cardId));
                const score = answer.grade == null ? 0 : answer.grade ? (answer.firstCorrect === false ? -2 : 1) : -1;
                return [{ result_id: index + 1, card_id: answer.cardId,
                    presentation_order: answer.presentationOrder ?? index,
                    front: card?.prompt ?? card?.front ?? '', back: card?.back ?? card?.answer ?? '',
                    prompt: card?.prompt, answer: card?.answer, correct_score: score,
                    grade_status: score === 0 ? 'ungraded' : score > 0 ? 'pass' : 'fail',
                    submitted_answers: answer.submittedAnswer != null ? [answer.submittedAnswer] : [],
                    submitted_grades: [score], response_time_ms: answer.responseTimeMs || 0,
                    audio_url: answer.audioId ? `/api/kids/${encodeURIComponent(setup.kidId)}/lesson-reading/audio/${encodeURIComponent(answer.audioId)}` : null }];
            }) };
    }
    function reviewStatus(task, record) {
        const answers = (record.answers || []).filter(Boolean);
        if (answers.some((answer) => answer.grade == null)) record.status = 'pending_review';
        else if (answers.length < task.target) record.status = 'in_progress';
        else if (task.behavior !== 'type_iii' && answers.some((answer) => !answer.grade)) record.status = 'corrections';
        else { record.status = 'done'; record.completedAt = new Date().toISOString(); }
    }
    async function handle(request, setup) {
        const token = request.headers.get('X-Offline-Parent');
        if (!token) return null;
        if (token !== await globalThis.OfflineSetupStore.readValue(`parent-auth:${setup.id}`)) return json({ error: 'Enter offline parent mode again.' }, 403);
        const reviewDate = request.headers.get('X-Offline-Day');
        if (reviewDate) {
            if (reviewDate > data().today(setup) || !setup.manifest.tasks.some((task) => task.date === reviewDate)) return json({ error: 'This practice day is unavailable.' }, 400);
            setup = { ...setup, reviewDate };
        }
        const url = new URL(request.url);
        const prefix = `/api/kids/${encodeURIComponent(setup.kidId)}`;
        try {
            const all = await data().records(setup);
            if (request.method === 'GET') {
                if (url.pathname === '/api/kids') return json([kid(setup, all)]);
                if (url.pathname === '/api/shared-decks/categories') {
                    const meta = kid(setup, all).deckCategoryMetaByKey;
                    return json({ categories: Object.entries(meta).map(([category_key, value]) => ({ ...value, category_key })) });
                }
                if (url.pathname === '/api/points/rules') return json({ rules: offapp(setup, all).chores });
                if (url.pathname === '/api/parent-settings/timezone') return json({ familyTimezone: setup.manifest.timezone });
                if (url.pathname.endsWith('/pending-summary')) return json({ kids: [] });
                if (url.pathname === prefix) return json(kid(setup, all));
                if (url.pathname === prefix + '/off-app-chores') return json(offapp(setup, all));
            }
            const session = url.pathname.match(new RegExp(`^${prefix}/report/sessions/(\\d+)(?:/(parent-review|finish-here|results/(\\d+)/grade))?$`));
            if (session) {
                const task = available(setup).find((item) => id(setup, item) === Number(session[1]) && item.categoryKey);
                if (!task || !all[task.id] || all[task.id].status === 'not_started') throw new Error('No local session is available to review.');
                if (request.method === 'GET' && !session[2]) return json(report(setup, task, all[task.id]));
                const body = request.headers.get('Content-Type')?.includes('application/json') ? await request.json() : {};
                const saved = await data().change(setup, task, (record) => {
                    if (session[2] === 'parent-review' && request.method === 'PUT') {
                        const grades = new Map((body.grades || []).map((item) => [Number(item.result_id), item.correct]));
                        if (record.answers.some((_, index) => ![-1, 1].includes(grades.get(index + 1)))) throw new Error('Review every answered question.');
                        record.answers.forEach((answer, index) => {
                            answer.grade = grades.get(index + 1) === 1;
                            answer.firstCorrect ??= answer.grade;
                        });
                        reviewStatus(task, record);
                    } else if (session[3] && request.method === 'PUT' && task.behavior === 'type_iii') {
                        const answer = record.answers[Number(session[3]) - 1];
                        if (!answer || !['pass', 'fail', 'clear'].includes(body.reviewGrade)) throw new Error('Invalid recording grade.');
                        answer.grade = body.reviewGrade === 'clear' ? null : body.reviewGrade === 'pass';
                        if (answer.grade != null) answer.firstCorrect ??= answer.grade;
                        reviewStatus(task, record);
                    } else if (session[2] === 'finish-here' && request.method === 'POST') {
                        if (!record.answers.some(Boolean) || record.answers.some((answer) => answer.grade == null)) throw new Error('Review the answered questions before ending this chore.');
                        record.status = 'closed';
                        record.completedAt = new Date().toISOString();
                    } else throw new Error('This action is unavailable offline.');
                    record.pendingId = null; // A stale child tab must resume before adding more answers.
                });
                const answer = saved.answers[Number(session[3]) - 1];
                return json(answer ? { correct_score: answer.grade == null ? 0 : answer.grade ? 1 : -1,
                    grade_status: answer.grade == null ? 'ungraded' : answer.grade ? 'pass' : 'fail' } : { saved: true });
            }
            const path = url.pathname.slice(prefix.length);
            const pending = path.match(/^\/off-app-chores\/pending\/(\d+)\/review$/);
            const event = path.match(/^\/points\/events(?:\/(\d+))?$/);
            if (url.pathname.startsWith(prefix + '/') && (pending || event) && ['POST', 'PATCH'].includes(request.method)) {
                const body = await request.json();
                const task = pending || event[1]
                    ? available(setup).find((item) => item.delivery === 'offapp' && id(setup, item) === Number(pending?.[1] || event[1]))
                    : available(setup).find((item) => item.delivery === 'offapp' && String(item.ruleId) === String(body.ruleId) && item.date === (setup.reviewDate || data().today(setup)));
                if (!task) throw new Error('Off-app chore not found.');
                if (!Number.isSafeInteger(body.pointsDelta) || body.pointsDelta <= 0) throw new Error('Points must be a positive integer.');
                await data().change(setup, task, (record) => {
                    record.points = body.pointsDelta; record.note = String(body.note || '');
                    record.status = 'done'; record.completedAt = new Date().toISOString();
                    record.submittedAt ||= record.completedAt;
                });
                return json({ saved: true });
            }
            const sheetReview = path.match(/^\/sheet-tasks\/(-\d+)\/review$/);
            if (url.pathname.startsWith(prefix + '/') && sheetReview && request.method === 'PUT') {
                const task = available(setup).find((item) => item.sheetTaskId === Number(sheetReview[1]));
                if (!task || all[task.id]?.status !== 'pending_review') throw new Error('This sheet is not awaiting review.');
                const body = await request.json();
                const saved = await data().change(setup, task, (record) => {
                    const grades = Object.fromEntries((body.grades || []).map((item) => [item.id, item.correct]));
                    if (task.behavior === 'type_ii' ? body.confirmed !== true : task.items.some((item) => typeof grades[item.id] !== 'boolean')) throw new Error('Review every assigned question.');
                    record.grades = grades; record.status = 'done'; record.completedAt = new Date().toISOString();
                });
                return json(sheet(task, saved));
            }
            // Printed layouts, recordings, and the kid profile remain package-owned.
            if (request.method === 'GET' && url.pathname.startsWith(prefix + '/') && /\/(avatar|lesson-reading\/audio|sheet-tasks|type2\/chinese-print-sheets|type4\/math-sheets)(\/|$)/.test(path)) return null;
            return json({ error: 'Only Home and local grading are available in offline parent mode.' }, 403);
        } catch (error) { return json({ error: error.message || 'Could not save local review.' }, 400); }
    }
    return { handle };
})();
