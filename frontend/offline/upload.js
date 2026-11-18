// Upload one settled package. Keep acknowledged data until the next package download.
window.OfflineUpload = (() => {
    const key = (setup) => `practice:${setup.id}`;
    function results(all) {
        return Object.fromEntries(Object.entries(all).filter(([id]) => id !== '__uploading')
            .map(([id, record]) => [id, { ...record, answers: (record.answers || []).filter(Boolean)
                .sort((a, b) => (a.presentationOrder ?? 0) - (b.presentationOrder ?? 0)) }]));
    }
    function requireSettled(setup, all) {
        const blockers = setup.manifest.tasks.flatMap((task) => {
            const record = all[task.id];
            if (!record || ['not_started', 'done', 'closed'].includes(record.status)) return [];
            return [{ name: `${task.name} · ${task.date}`, reason: record.status === 'pending_review'
                ? 'Parent review is required before uploading.'
                : 'Finish this chore or have a parent close it before uploading.' }];
        });
        if (blockers.length) {
            const error = new Error('Finish or close these chores before uploading:');
            error.blockers = blockers;
            throw error;
        }
    }
    async function buildBody(setup, records) {
        // Use byte-backed parts instead of FormData's browser-managed files.
        const boundary = `offline-${crypto.randomUUID()}`;
        const parts = [];
        for (const [name, value] of [['manifest', setup.manifest], ['records', records]]) {
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${JSON.stringify(value)}\r\n`);
        }
        const audioIds = new Set(Object.values(records).flatMap((record) =>
            (record.answers || []).map((answer) => answer?.audioId).filter(Boolean)));
        for (const audioId of audioIds) {
            const clip = await window.OfflineSetupStore.readValue(audioId);
            if (!clip?.blob?.size) throw new Error('A recording is missing on this device. Local results have been kept.');
            if (/[\r\n"\\]/.test(audioId)) throw new Error('Invalid recording identifier. Local results have been kept.');
            let bytes;
            try { bytes = new Uint8Array(await clip.blob.arrayBuffer()); }
            catch (_) { throw new Error(`Could not read saved recording ${audioId} on this device. Local results have been kept.`); }
            const mime = clip.blob.type || clip.mimeType || 'application/octet-stream';
            if (/[\r\n]/.test(mime)) throw new Error('Invalid recording format. Local results have been kept.');
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${audioId}"; filename="recording"\r\nContent-Type: ${mime}\r\n\r\n`, bytes, '\r\n');
        }
        parts.push(`--${boundary}--\r\n`);
        return new Blob(parts, { type: `multipart/form-data; boundary=${boundary}` });
    }
    async function size(setup, all) {
        return (await buildBody(setup, results(all))).size;
    }
    async function upload(setup, password) {
        if (!setup.manifest || setup.manifest.id !== setup.id
            || String(setup.manifest.kidId) !== String(setup.kidId)) {
            throw new Error('The saved task plan on this device has missing or mismatched package identification. Nothing was uploaded. Local results have been kept.');
        }
        const store = window.OfflineSetupStore;
        let alreadyFrozen = false;
        // Freeze the snapshot in the same transaction as practice writes. Other
        // tabs cannot add answers after this upload has begun.
        const frozen = await store.changeValue(key(setup), (all = {}) => {
            alreadyFrozen = Boolean(all.__uploading);
            requireSettled(setup, all);
            return { ...all, __uploading: true };
        });
        const records = results(frozen);
        let body;
        try {
            body = await buildBody(setup, records);
        } catch (error) {
            if (!alreadyFrozen) await store.changeValue(key(setup), (all) => { delete all.__uploading; return all; });
            throw error;
        }
        let response, payload;
        try {
            response = await fetch(`/api/offline/packages/${encodeURIComponent(setup.id)}/upload?${new URLSearchParams({ kidId: setup.kidId })}`, {
                method: 'POST', body,
                headers: { ...window.PracticeManageCommon.buildPasswordHeaders(password),
                    'Content-Type': body.type, 'X-Offline-Device': setup.deviceId },
            });
            payload = await response.json();
        } catch (_) {
            throw new Error('Upload was not confirmed. Reconnect and retry Upload with your family password. Local results are kept and practice is paused until the upload is confirmed.');
        }
        if (!response.ok) {
            // A definite rejection means nothing was imported. An unconfirmed
            // server failure stays frozen so a retry sends exactly the same data.
            if (response.status < 500 && !alreadyFrozen) await store.changeValue(key(setup), (all) => { delete all.__uploading; return all; });
            const error = new Error(payload.error || 'Could not upload offline results. Please retry.');
            error.status = response.status;
            throw error;
        }
        if (payload.packageId !== setup.id || payload.status !== 'completed') {
            throw new Error('Upload completion was not confirmed. Local data is kept; retry Upload.');
        }
        await store.saveSetup({ ...setup, status: 'completed', completedAt: new Date().toISOString(), receipt: payload });
        return payload;
    }
    return { upload, size };
})();
