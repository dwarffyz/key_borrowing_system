(() => {
    const STORAGE_KEY = 'theme';
    const DARK_CLASS = 'theme-dark';
    const NAVBAR_HEIGHT_VAR = '--navbar-height';
    const BOTTOM_NAV_HEIGHT_VAR = '--bottom-nav-height';

    const applyTheme = (theme) => {
        const isDark = theme === 'dark';
        document.body.classList.toggle(DARK_CLASS, isDark);
        document.documentElement.classList.toggle(DARK_CLASS, isDark);

        document.querySelectorAll('[data-theme-toggle]').forEach((toggle) => {
            if (toggle.type === 'checkbox') {
                toggle.checked = isDark;
            } else {
                toggle.textContent = isDark ? 'Light Mode' : 'Dark Mode';
                toggle.setAttribute('aria-pressed', String(isDark));
            }
        });
    };

    const getStoredTheme = () => localStorage.getItem(STORAGE_KEY) || 'light';

    const toggleTheme = () => {
        const next = document.body.classList.contains(DARK_CLASS) ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, next);
        applyTheme(next);
    };

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(getStoredTheme());

        document.querySelectorAll('[data-theme-toggle]').forEach((toggle) => {
            if (toggle.type === 'checkbox') {
                toggle.addEventListener('change', toggleTheme);
            } else {
                toggle.addEventListener('click', toggleTheme);
            }
        });

        const updateNavbarHeight = () => {
            const navbar = document.querySelector('.navbar');
            if (!navbar) return;
            const height = Math.ceil(navbar.getBoundingClientRect().height);
            document.documentElement.style.setProperty(NAVBAR_HEIGHT_VAR, `${height}px`);
        };

        const updateBottomNavHeight = () => {
            const nav = document.querySelector('.dashboard-nav');
            if (!nav) {
                document.documentElement.style.removeProperty(BOTTOM_NAV_HEIGHT_VAR);
                return;
            }
            const height = Math.ceil(nav.getBoundingClientRect().height);
            document.documentElement.style.setProperty(BOTTOM_NAV_HEIGHT_VAR, `${height}px`);
        };

        const scheduleLayoutUpdate = () => {
            updateNavbarHeight();
            updateBottomNavHeight();
            window.requestAnimationFrame(() => {
                updateNavbarHeight();
                updateBottomNavHeight();
            });
        };

        // Ensure content padding matches the real navbar height (important on mobile where the navbar stacks).
        scheduleLayoutUpdate();
        window.addEventListener('resize', scheduleLayoutUpdate);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', scheduleLayoutUpdate);
        }
    });
})();
