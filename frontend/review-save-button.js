// Shared save control for worksheet and online parent reviews.
window.ReviewSaveButton = {
    create({ showCounts = true } = {}) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'paradigm-btn paradigm-submit-confirm paradigm-compact-control';
        const label = document.createElement('span');
        button.appendChild(label);
        const badges = (showCounts ? ['correct', 'wrong'] : []).map((key) => {
            const badge = document.createElement('span');
            badge.className = `review-save-count is-${key}`;
            badge.innerHTML = window.icon(key === 'correct' ? 'check' : 'x', { size: 16 });
            const value = document.createElement('span');
            badge.appendChild(value);
            button.appendChild(badge);
            return { key, badge, value };
        });
        function update({ text = 'Save review', correct = 0, wrong = 0, disabled = false } = {}) {
            button.disabled = disabled;
            label.textContent = text;
            const counts = { correct, wrong };
            badges.forEach(({ key, badge, value }) => {
                value.textContent = String(counts[key]);
                badge.title = `${counts[key]} ${key}`;
                badge.setAttribute('aria-label', badge.title);
            });
            button.setAttribute('aria-label', showCounts ? `${text}: ${correct} correct, ${wrong} wrong` : text);
        }
        update();
        return { button, update };
    },
};
