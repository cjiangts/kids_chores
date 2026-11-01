/* Shared dialog chrome and lifecycle for all printable sheet builders. */
window.SheetBuilderDialog = (() => {
    const template = document.getElementById('sheetBuilderChromeTemplate');
    document.querySelectorAll('[data-builder-prefix]').forEach((modal) => {
        const prefix = modal.dataset.builderPrefix;
        const dialog = modal.querySelector('.paradigm-sheet-dialog');
        const chrome = template.content.cloneNode(true);
        const header = chrome.querySelector('.paradigm-sheet-header');
        const actions = chrome.querySelector('.sheet-builder-actions');
        const heading = header.querySelector('h2');
        heading.id = `${prefix}Heading`;
        heading.textContent = modal.dataset.builderTitle;
        header.querySelector('button').id = `${prefix}CloseBtn`;
        actions.querySelector('[role="status"]').id = `${prefix}QuestionCount`;
        actions.querySelector('[data-builder-confirm]').id = `${prefix}DoneBtn`;
        const cancel = actions.querySelector('[data-builder-cancel]');
        cancel.id = `${prefix}CancelBtn`;
        cancel.addEventListener('click', () => header.querySelector('button').click());
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', heading.id);
        dialog.prepend(header);
        dialog.append(actions);
    });

    function update(prefix, count, unit = 'question', detail = '') {
        const counter = document.getElementById(`${prefix}QuestionCount`);
        const button = document.getElementById(`${prefix}DoneBtn`);
        if (counter) counter.textContent = `${count} ${unit}${count === 1 ? '' : 's'} total${detail ? ` · ${detail}` : ''}`;
        if (button) button.disabled = count === 0 || button.getAttribute('aria-busy') === 'true';
    }

    function setOpen(modalId, open) {
        const modal = document.getElementById(modalId);
        modal.classList.toggle('hidden', !open);
        modal.setAttribute('aria-hidden', String(!open));
        document.body.classList.toggle('modal-open', Boolean(document.querySelector('.modal:not(.hidden)')));
    }

    function setSaving(prefix, saving) {
        const button = document.getElementById(`${prefix}DoneBtn`);
        if (!button) return;
        const cancel = document.getElementById(`${prefix}CancelBtn`);
        if (cancel) cancel.disabled = saving;
        if (saving) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        } else {
            button.removeAttribute('aria-busy');
        }
    }

    return { update, setOpen, setSaving };
})();
