// Device-local parent entry. The package contains a salted password hash, never the password.
window.OfflineParentAuth = (() => {
    const key = (setup) => `parent-auth:${setup.id}`;
    const sessionKey = (setup) => `offline-parent:${setup.id}`;
    async function token(setup) {
        const saved = sessionStorage.getItem(sessionKey(setup));
        return saved && saved === await window.OfflineSetupStore.readValue(key(setup)) ? saved : null;
    }
    async function grant(setup) {
        const value = crypto.randomUUID();
        await window.OfflineSetupStore.changeValue(key(setup), () => value);
        sessionStorage.setItem(sessionKey(setup), value);
    }
    async function enter(setup) {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog('offline parent mode', async (password) => {
            const auth = setup.manifest.parentAuth;
            const salt = Uint8Array.from(auth.salt.match(/../g), (part) => parseInt(part, 16));
            const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
            const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: auth.iterations }, material, 256);
            const hash = [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            if (hash !== auth.hash) return new Response(JSON.stringify({ error: 'Invalid password' }), { status: 403 });
            if (!setup.parentReady) await window.OfflineDownload.start(setup);
            await grant(setup);
            return new Response(JSON.stringify({ confirmed: true }));
        });
        if (!result.cancelled && !result.ok) throw new Error(result.error || 'Could not enter offline parent mode.');
        return !result.cancelled && result.ok;
    }
    const leave = (setup) => sessionStorage.removeItem(sessionKey(setup));
    return { token, enter, leave, grant };
})();
