// Shared search-bar component: wraps an existing <input> with a magnifying-glass icon and a clear (×) button.
// Usage: SearchBar.enhance(inputEl, { onClear })
//   - Wraps the input in a `.search-bar` container if not already.
//   - Adds `.search-bar-icon` (search) on the left and `.search-bar-clear` (x) on the right.
//   - Toggles clear-button visibility based on input value; clicking clears the value, fires an 'input' event, and refocuses the input.
(function () {
    function ensureWrap(input) {
        const parent = input.parentElement;
        if (parent && parent.classList.contains('search-bar')) {
            return parent;
        }
        const wrap = document.createElement('div');
        wrap.className = 'search-bar';
        if (parent) parent.insertBefore(wrap, input);
        wrap.appendChild(input);
        return wrap;
    }

    function ensureIcon(wrap, input) {
        if (wrap.querySelector('.search-bar-icon')) return;
        const icon = document.createElement('span');
        icon.className = 'search-bar-icon';
        icon.setAttribute('data-icon', 'search');
        icon.setAttribute('data-icon-size', '16');
        icon.setAttribute('data-icon-stroke', '2');
        icon.setAttribute('aria-hidden', 'true');
        wrap.insertBefore(icon, input);
    }

    function ensureClearBtn(wrap) {
        const existing = wrap.querySelector('.search-bar-clear');
        if (existing) return existing;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'search-bar-clear hidden';
        btn.setAttribute('aria-label', 'Clear search');
        btn.title = 'Clear search';
        btn.innerHTML = '<span data-icon="x" data-icon-size="14" data-icon-stroke="2.4" aria-hidden="true"></span>';
        wrap.appendChild(btn);
        return btn;
    }

    function enhance(input, options) {
        if (!input || input.dataset.searchBarEnhanced === '1') return;
        input.dataset.searchBarEnhanced = '1';
        input.classList.add('paradigm-search-input');

        const wrap = ensureWrap(input);
        ensureIcon(wrap, input);
        const clearBtn = ensureClearBtn(wrap);

        const sync = () => {
            clearBtn.classList.toggle('hidden', input.value.length === 0);
        };

        input.addEventListener('input', sync);
        clearBtn.addEventListener('click', () => {
            if (input.value === '') {
                input.focus();
                return;
            }
            input.value = '';
            sync();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            if (options && typeof options.onClear === 'function') {
                options.onClear();
            }
            input.focus();
        });

        sync();
        if (window.hydrateIcons) window.hydrateIcons(wrap);
    }

    window.SearchBar = { enhance };
})();
