// Keep offline entry independent of the online practice data loader.
window.OfflineRouting = {
    async openPracticeHome(kidId, packageId) {
        const setup = await window.OfflineSetupStore.getBoundSetup();
        if (!setup) {
            if (packageId) throw new Error('This device has no saved offline package.');
            return false;
        }
        if (String(setup.kidId) !== String(kidId)) throw new Error('This device is bound to another child’s offline package.');
        if (setup.status === 'preparing') {
            const query = new URLSearchParams({ id: kidId, packageId: setup.id });
            window.location.replace(`/offline/home.html?${query}`);
            return true;
        }
        await window.OfflinePracticeClient.ready;
        return false;
    },
};
