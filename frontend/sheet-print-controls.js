// Shared toolbar buttons for math and writing print pages.
window.SheetPrintControls = (() => {
    const controls = {
        backToSheetManage: ['arrow-left', 'Back'],
        showAnswersBtn: ['eye', 'Show Answers'],
        regenerateBtn: ['refresh-cw', 'Regenerate'],
        finalizeBtn: ['check', 'Finalize'],
        printBtn: ['printer', 'Print'],
    };

    function setLabel(button, text) {
        if (button) button.querySelector('[data-button-label]').textContent = text;
    }

    for (const [id, [iconName, label]] of Object.entries(controls)) {
        const button = document.getElementById(id);
        if (!button) continue;
        button.classList.add('paradigm-btn', 'paradigm-btn--pill');
        button.innerHTML = window.icon(iconName, { size: 12 });
        const text = document.createElement('span');
        text.dataset.buttonLabel = '';
        text.textContent = label;
        button.appendChild(text);
    }

    return { setLabel };
})();
