const API_BASE = `${window.location.origin}/api`;

const loginForm = document.getElementById('familyLoginForm');
const errorMessage = document.getElementById('errorMessage');
const params = new URLSearchParams(window.location.search);
const next = params.get('next') || '/';

document.addEventListener('DOMContentLoaded', async () => {
    await maybeRedirect();
});

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    await submitAuth('/family-auth/login', { username, password });
});

async function maybeRedirect() {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        if (data.authenticated) {
            window.location.href = next;
        }
    } catch (error) {
        // no-op
    }
}

async function submitAuth(endpoint, payload) {
    try {
        showError('');
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            showError(data.error || 'Request failed');
            return;
        }
        window.location.href = next;
    } catch (error) {
        showError('Request failed');
    }
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
