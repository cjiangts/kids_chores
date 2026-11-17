// The device picker stays hidden until its local offline binding has been read.
window.OfflineGate = (() => {
    function homeUrl(setup) {
        return `/offline/home.html?${new URLSearchParams({ id: setup.kidId, packageId: setup.id })}`;
    }
    async function check() {
        document.documentElement.classList.add('offline-binding-check');
        try {
            const setup = await window.OfflineSetupStore.getBoundSetup();
            document.documentElement.classList.toggle('offline-device-active', setup?.status === 'active');
            if (setup?.status === 'preparing') {
                location.replace(homeUrl(setup));
                return true;
            }
        } catch (error) {
            // Keep the ordinary online picker usable if browser storage is unavailable.
            console.warn('Could not check offline device binding:', error);
        }
        document.documentElement.classList.remove('offline-binding-check');
        return false;
    }
    window.addEventListener('pageshow', (event) => { if (event.persisted) void check(); });
    window.addEventListener('pagehide', () => document.documentElement.classList.add('offline-binding-check'));
    if ('BroadcastChannel' in window) {
        try {
            const channel = new BroadcastChannel('mommy-offline-binding');
            channel.onmessage = () => { void check(); };
        } catch (_) { /* Page entry checks still enforce the binding. */ }
    }
    return { homeUrl, ready: check() };
})();
