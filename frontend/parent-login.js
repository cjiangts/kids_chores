const API_BASE = `${window.location.origin}/api`;
const params = new URLSearchParams(window.location.search);
const next = params.get('next') || '/admin.html';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            window.location.href = '/family-login.html';
            return;
        }
        const data = await response.json();
        if (data.authenticated) {
            window.location.href = next;
            return;
        }
        window.location.href = '/family-login.html';
    } catch (error) {
        window.location.href = '/family-login.html';
    }
});
