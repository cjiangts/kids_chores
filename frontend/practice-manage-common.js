window.PracticeManageCommon = {
    sortCardsForView(cards, mode) {
        const copy = [...cards];

        if (mode === 'added_time') {
            return copy.sort((a, b) => this.parseTime(b.parent_added_at || b.created_at) - this.parseTime(a.parent_added_at || a.created_at));
        }

        if (mode === 'avg_green_desc') {
            return copy.sort((a, b) => {
                const aMs = a.avg_green_ms ?? -1;
                const bMs = b.avg_green_ms ?? -1;
                if (aMs === bMs) {
                    return this.compareQueueOrder(a, b);
                }
                return bMs - aMs;
            });
        }

        return copy.sort((a, b) => this.compareQueueOrder(a, b));
    },

    compareQueueOrder(a, b) {
        const aOrder = Number.isFinite(a.queue_order) ? a.queue_order : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(b.queue_order) ? b.queue_order : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
    },

    parseTime(value) {
        if (!value) {
            return 0;
        }
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    },

    formatAvgGreen(avgMs) {
        if (avgMs === null || avgMs === undefined) {
            return '-';
        }
        return `${Math.round(avgMs)} ms`;
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
