(() => {
    const drawer = document.querySelector('[data-nav-drawer]');
    const toggleBtn = document.querySelector('[data-nav-toggle]');

    if (!drawer || !toggleBtn) return;

    const panel = drawer.querySelector('.nav-drawer-panel');
    const closeTargets = Array.from(drawer.querySelectorAll('[data-nav-close]'));

    let lastFocusedEl = null;

    const isOpen = () => document.body.classList.contains('nav-drawer-open');

    const setAria = (open) => {
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    };

    const openDrawer = () => {
        if (isOpen()) return;

        lastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.classList.add('nav-drawer-open');
        setAria(true);

        // Focus the panel so screen readers announce it.
        setTimeout(() => {
            if (panel && typeof panel.focus === 'function') {
                panel.focus({ preventScroll: true });
            }
        }, 0);
    };

    const closeDrawer = () => {
        if (!isOpen()) return;

        document.body.classList.remove('nav-drawer-open');
        setAria(false);

        const fallback = toggleBtn;
        const target = lastFocusedEl || fallback;
        lastFocusedEl = null;

        if (target && typeof target.focus === 'function') {
            setTimeout(() => target.focus({ preventScroll: true }), 0);
        }
    };

    toggleBtn.addEventListener('click', () => {
        if (isOpen()) closeDrawer();
        else openDrawer();
    });

    closeTargets.forEach((el) => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            closeDrawer();
        });
    });

    // Close when picking a menu item.
    drawer.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        const menu = target.closest('.nav-drawer-menu');
        if (!menu) return;
        const interactive = target.closest('button, a');
        if (!interactive) return;
        if (interactive.hasAttribute('disabled')) return;
        closeDrawer();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
            e.preventDefault();
            closeDrawer();
        }
    });

    // Close if screen changes layout.
    window.addEventListener('resize', () => {
        if (!isOpen()) return;
        closeDrawer();
    });

    setAria(false);
})();

