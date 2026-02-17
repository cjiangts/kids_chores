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
