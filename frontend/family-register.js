const API_BASE = `${window.location.origin}/api`;

const registerForm = document.getElementById('familyRegisterForm');
const errorMessage = document.getElementById('errorMessage');
const params = new URLSearchParams(window.location.search);
const next = params.get('next') || '/';

document.addEventListener('DOMContentLoaded', async () => {
    await maybeRedirect();
});

registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
    if (password !== passwordConfirm) {
        showError('Passwords do not match');
        return;
    }
    await submitRegister({ username, password });
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

async function submitRegister(payload) {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/family-auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            showError(data.error || 'Register failed');
            return;
        }
        window.location.href = next;
    } catch (error) {
        showError('Register failed');
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
