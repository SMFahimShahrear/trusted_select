// ==============================
// layout.js — the parts every page shares:
// sidebar menu, top header, footer, login check, and the date-range filter.
// ==============================

import settings from "../settings.json" with { type: "json" };
import { hf } from "./utils.js";
import { watchUser, logout } from "./firebase.js";

// Simple line icons (24×24)
const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    products: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    purchases: '<path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    sales: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    expenses: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/>',
    print: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>',
    customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.3A6.5 6.5 0 0 1 21.5 20"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 8-4 4 4 4"/><path d="M6 12h10"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};

const PAGES = [
    { href: 'dashboard.html', label: 'Dashboard', icon: 'dashboard' },
    { href: 'products.html', label: 'Products', icon: 'products' },
    { href: 'purchases.html', label: 'Purchases', icon: 'purchases' },
    { href: 'sales.html', label: 'Sales', icon: 'sales' },
    { href: 'expenses.html', label: 'Expenses', icon: 'expenses' },
    { href: 'customers.html', label: 'Customers', icon: 'customers' },
    { href: 'print.html', label: 'Print', icon: 'print' },
    { href: 'settings.html', label: 'Settings', icon: 'settings', separate: true },
];

function icon(name) {
    const span = hf.create('span', { className: 'icon', attrs: { 'aria-hidden': 'true' } });
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    return span;
}

function currentPage() {
    const file = location.pathname.split('/').pop() || 'index.html';
    return file;
}

function buildSidebar(nav) {
    const brand = hf.create('a', { className: 'brand', attrs: { href: 'dashboard.html' } });
    const mark = hf.create('span', { className: 'brand-mark', text: (settings.business?.name || 'T')[0] });
    const text = hf.create('span', { className: 'brand-text' });
    text.append(
        hf.create('strong', { text: settings.business?.name || 'Trusted Select' }),
        hf.create('small', { text: settings.business?.tagline || 'Business Tracker' }),
    );
    brand.append(mark, text);

    const list = hf.create('ul', { className: 'nav-list' });
    for (const page of PAGES) {
        const link = hf.create('a', { className: 'nav-link', attrs: { href: page.href } });
        if (currentPage() === page.href) {
            link.classList.add('active');
            link.setAttribute('aria-current', 'page');
        }
        link.append(icon(page.icon), hf.create('span', { text: page.label }));
        const li = hf.create('li', { className: page.separate ? 'nav-sep' : '' });
        li.append(link);
        list.append(li);
    }

    nav.replaceChildren(brand, list);
    nav.setAttribute('aria-label', 'Main menu');
}

function buildHeader(header, title) {
    const menuBtn = hf.create('button', {
        className: 'menu-btn', attrs: { type: 'button', 'aria-label': 'Open menu' },
    });
    menuBtn.append(icon('menu'));
    hf.on(menuBtn, 'click', () => document.body.classList.toggle('nav-open'));

    const h1 = hf.create('h1', { className: 'page-title', text: title });

    const user = hf.create('div', { className: 'header-user' });
    const email = hf.create('span', { className: 'user-email' });
    const logoutBtn = hf.create('button', {
        className: 'btn btn-ghost btn-sm logout-btn', attrs: { type: 'button' },
    });
    logoutBtn.append(icon('logout'), hf.create('span', { text: 'Log out' }));
    hf.on(logoutBtn, 'click', async () => {
        await logout();
        location.href = 'login.html';
    });
    user.append(email, logoutBtn);

    header.replaceChildren(menuBtn, h1, user);
}

// Call once at the top of every logged-in page:
// startPage({ title: 'Products', onReady: (user) => loadProducts() });
export function startPage({ title, onReady }) {
    hf.title(title);

    const nav = hf.q('.sidenav');
    const header = hf.q('.header');
    const footer = hf.q('.footer');
    if (nav) buildSidebar(nav);
    if (header) buildHeader(header, title);
    if (footer) footer.textContent = `© ${new Date().getFullYear()} ${settings.business?.name || ''}`;

    // Tap outside the menu (on phones) to close it
    const overlay = hf.create('div', { className: 'nav-overlay' });
    hf.on(overlay, 'click', () => document.body.classList.remove('nav-open'));
    document.body.append(overlay);

    let started = false;
    watchUser((user) => {
        if (!user) {
            location.href = 'login.html';
            return;
        }
        const email = hf.q('.user-email');
        if (email) email.textContent = user.email;
        if (!started) {
            started = true;
            onReady(user);
        }
    });
}

// Date-range picker: [This month ▾] [from] to [to]
// const range = createRangeFilter(hf.q('#sales-range'), loadSales);  →  range.from, range.to
export function createRangeFilter(container, onChange) {
    const presets = { thisMonth: 'This month', lastMonth: 'Last month', thisYear: 'This year', custom: 'Custom' };

    const preset = hf.create('select', { className: 'range-preset', attrs: { 'aria-label': 'Period' } });
    Object.entries(presets).forEach(([value, text]) => preset.add(new Option(text, value)));
    const from = hf.create('input', { attrs: { type: 'date', 'aria-label': 'From date' } });
    const to = hf.create('input', { attrs: { type: 'date', 'aria-label': 'To date' } });
    const sep = hf.create('span', { className: 'range-sep', text: 'to' });

    container.classList.add('range-filter');
    container.replaceChildren(preset, from, sep, to);

    const applyPreset = (name) => {
        const r = hf[name]();
        from.value = r.from;
        to.value = r.to;
    };
    applyPreset('thisMonth');

    hf.on(preset, 'change', () => {
        if (preset.value === 'custom') return;
        applyPreset(preset.value);
        onChange();
    });

    const manualChange = () => {
        preset.value = 'custom';
        if (!from.value || !to.value) return;
        if (from.value > to.value) [from.value, to.value] = [to.value, from.value];
        onChange();
    };
    hf.on(from, 'change', manualChange);
    hf.on(to, 'change', manualChange);

    return {
        get from() { return from.value; },
        get to() { return to.value; },
        get label() {
            return preset.value === 'custom'
                ? `${hf.date(from.value)} – ${hf.date(to.value)}`
                : presets[preset.value];
        },
    };
}
