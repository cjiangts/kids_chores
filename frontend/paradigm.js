(function () {
    function autoSizeMultilineInput(input) {
        if (!(input instanceof HTMLTextAreaElement)) return;
        input.style.height = 'auto';
        input.style.height = `${Math.max(28, input.scrollHeight)}px`;
    }

    window.Paradigm = window.Paradigm || {};
    window.Paradigm.autoSizeMultilineInput = autoSizeMultilineInput;
})();
