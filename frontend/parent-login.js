const API_BASE = `${window.location.origin}/api`;

const form = document.getElementById('loginForm');
const passwordInput = document.getElementById('parentPassword');
const errorMessage = document.getElementById('errorMessage');

const params = new URLSearchParams(window.location.search);
const next = params.get('next') || '/admin.html';

document.addEventListener('DOMContentLoaded', async () => {
    await maybeRedirectIfAuthed();
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await login();
});

async function maybeRedirectIfAuthed() {
    try {
        const response = await fetch(`${API_BASE}/parent-auth/status`);
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

async function login() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/parent-auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: passwordInput.value || '' })
        });

        if (!response.ok) {
            if (response.status === 401) {
                showError('Wrong password');
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        window.location.href = next;
    } catch (error) {
        console.error('Login failed:', error);
        showError('Login failed');
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
