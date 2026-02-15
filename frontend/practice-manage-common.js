window.PracticeManageCommon = {
    sortCardsForView(cards, mode) {
        const copy = [...cards];

        if (mode === 'added_time') {
            return copy.sort((a, b) => this.parseTime(b.parent_added_at || b.created_at) - this.parseTime(a.parent_added_at || a.created_at));
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
