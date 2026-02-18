function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function parseDateOnly(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
}

function calculateAge(birthday) {
    const today = new Date();
    const birthDate = parseDateOnly(birthday);
    if (!birthDate) return 0;
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

function formatDate(dateString) {
    const date = parseDateOnly(dateString);
    if (!date) return dateString || '-';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function validateBirthday(birthday) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(birthday)) return false;
    const [year, month, day] = birthday.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date > today) return false;
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 150);
    if (date < minDate) return false;
    return true;
}

window.PracticeManageCommon = {
    _passwordDialogStyleInjected: false,

    _ensurePasswordDialogStyles() {
        if (this._passwordDialogStyleInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .pwd-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.45);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                padding: 1rem;
            }
            .pwd-dialog {
                width: 100%;
                max-width: 360px;
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
                padding: 1rem;
            }
            .pwd-title {
                margin: 0 0 0.6rem 0;
                font-size: 1rem;
                color: #2f3c7e;
                font-weight: 700;
            }
            .pwd-warning {
                margin: 0 0 0.8rem 0;
                color: #9c3600;
                font-size: 0.9rem;
                background: #fff4e6;
                border: 1px solid #ffd8a8;
                border-radius: 8px;
                padding: 0.55rem 0.6rem;
            }
            .pwd-input {
                width: 100%;
                padding: 0.55rem 0.65rem;
                border: 1px solid #ccd2e0;
                border-radius: 8px;
                font-size: 0.95rem;
                margin-bottom: 0.8rem;
                box-sizing: border-box;
            }
            .pwd-message {
                margin: 0 0 0.8rem 0;
                color: #c92a2a;
                font-size: 0.9rem;
            }
            .pwd-actions {
                display: flex;
                justify-content: flex-end;
                gap: 0.5rem;
            }
            .pwd-btn {
                border: 0;
                border-radius: 8px;
                padding: 0.5rem 0.75rem;
                font-size: 0.9rem;
                cursor: pointer;
            }
            .pwd-btn.cancel {
                background: #f1f3f5;
                color: #495057;
            }
            .pwd-btn.confirm {
                background: #2f9e44;
                color: #fff;
            }
        `;
        document.head.appendChild(style);
        this._passwordDialogStyleInjected = true;
    },

    _showPasswordInputDialog(actionLabel = 'this action', options = {}) {
        this._ensurePasswordDialogStyles();
        const warningMessage = String(options.warningMessage || '').trim();
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'pwd-overlay';
            overlay.innerHTML = `
                <div class="pwd-dialog" role="dialog" aria-modal="true" aria-label="Password Confirmation">
                    <h3 class="pwd-title">Enter family password to confirm ${escapeHtml(actionLabel)}:</h3>
                    ${warningMessage ? `<p class="pwd-warning">${escapeHtml(warningMessage)}</p>` : ''}
                    <input class="pwd-input" type="password" autocomplete="current-password" />
                    <div class="pwd-actions">
                        <button type="button" class="pwd-btn cancel">Cancel</button>
                        <button type="button" class="pwd-btn confirm">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const input = overlay.querySelector('.pwd-input');
            const cancelBtn = overlay.querySelector('.pwd-btn.cancel');
            const confirmBtn = overlay.querySelector('.pwd-btn.confirm');

            const close = (result) => {
                overlay.remove();
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => close({ cancelled: true }));
            confirmBtn.addEventListener('click', () => close({ cancelled: false, password: String(input.value || '').trim() }));
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    close({ cancelled: false, password: String(input.value || '').trim() });
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    close({ cancelled: true });
                }
            });
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) {
                    close({ cancelled: true });
                }
            });

            input.focus();
        });
    },

    _showPasswordMessageDialog(actionLabel = 'this action', message = '') {
        this._ensurePasswordDialogStyles();
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'pwd-overlay';
            overlay.innerHTML = `
                <div class="pwd-dialog" role="dialog" aria-modal="true" aria-label="Password Error">
                    <h3 class="pwd-title">Enter family password to confirm ${escapeHtml(actionLabel)}:</h3>
                    <p class="pwd-message">${escapeHtml(message || 'Invalid password')}</p>
                    <div class="pwd-actions">
                        <button type="button" class="pwd-btn cancel">OK</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            const okBtn = overlay.querySelector('.pwd-btn.cancel');
            const escOnce = (event) => {
                if (event.key === 'Escape') {
                    close();
                }
            };
            const close = () => {
                window.removeEventListener('keydown', escOnce);
                overlay.remove();
                resolve();
            };
            okBtn.addEventListener('click', close);
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close();
            });
            window.addEventListener('keydown', escOnce);
            okBtn.focus();
        });
    },

    buildPasswordHeaders(password, withJsonContentType = false) {
        const headers = {};
        if (withJsonContentType) {
            headers['Content-Type'] = 'application/json';
        }
        if (password) {
            headers['X-Confirm-Password'] = password;
        }
        return headers;
    },

    async requestWithPasswordDialog(actionLabel, requestFactory, options = {}) {
        const inputResult = await this._showPasswordInputDialog(actionLabel, options);
        if (inputResult.cancelled) {
            return { cancelled: true };
        }
        const password = String(inputResult.password || '').trim();
        if (!password) {
            await this._showPasswordMessageDialog(actionLabel, 'Password is required.');
            return { cancelled: true };
        }

        let response;
        try {
            response = await requestFactory(password);
        } catch (error) {
            return { ok: false, error: error?.message || 'Request failed' };
        }

        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
            return { ok: true, response, payload };
        }

        const apiError = String(payload.error || `HTTP ${response.status}`);
        if (response.status === 400 || response.status === 403) {
            await this._showPasswordMessageDialog(actionLabel, apiError);
            return { cancelled: true, invalidPassword: true, error: apiError };
        }

        return { ok: false, error: apiError, response, payload };
    },

    sortCardsForView(cards, mode) {
        const copy = [...cards];

        if (mode === 'added_time') {
            return copy.sort((a, b) => this.parseTime(b.created_at) - this.parseTime(a.created_at));
        }

        if (mode === 'hardness_desc') {
            return copy.sort((a, b) => {
                const aHard = Number.isFinite(a.hardness_score) ? a.hardness_score : -1;
                const bHard = Number.isFinite(b.hardness_score) ? b.hardness_score : -1;
                if (aHard === bHard) {
                    return this.compareQueueOrder(a, b);
                }
                return bHard - aHard;
            });
        }

        return copy.sort((a, b) => this.compareQueueOrder(a, b));
    },

    compareQueueOrder(a, b) {
        const aOrder = Number.isFinite(a.next_session_order) ? a.next_session_order : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(b.next_session_order) ? b.next_session_order : Number.MAX_SAFE_INTEGER;

        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }

        return (a.id || 0) - (b.id || 0);
    },

    parseTime(value) {
        if (!value) {
            return 0;
        }
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    },

    formatHardnessScore(score) {
        if (score === null || score === undefined) {
            return '-';
        }
        const value = Number(score);
        if (Number.isNaN(value)) {
            return '-';
        }
        return Number.isInteger(value) ? `${value}` : `${value.toFixed(1)}`;
    },

    formatAddedDate(dateStr) {
        if (!dateStr) {
            return '-';
        }
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) {
            return '-';
        }
        return date.toLocaleDateString();
    },

    formatLastSeenDays(dateStr) {
        if (!dateStr) {
            return 'Never';
        }
        const seenDate = new Date(dateStr);
        if (Number.isNaN(seenDate.getTime())) {
            return 'Unknown';
        }

        const now = new Date();
        const msPerDay = 24 * 60 * 60 * 1000;
        const dayDiff = Math.floor((now - seenDate) / msPerDay);

        if (dayDiff <= 0) {
            return 'Today';
        }
        if (dayDiff === 1) {
            return '1 day ago';
        }
        return `${dayDiff} days ago`;
    }
};
