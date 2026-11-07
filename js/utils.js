// ==============================
// utils.js — shared helper functions (hf)
// Use in any page:  import { hf } from "./utils.js";
// ==============================

import settings from "../settings.json" with { type: "json" };

const pad = (n) => String(n).padStart(2, '0');

export const hf = {

    // ---------- Finding elements ----------
    q: (selector, parent = document) => parent.querySelector(selector),
    qa: (selector, parent = document) => [...parent.querySelectorAll(selector)],

    // ---------- Events ----------
    on: (element, event, handler) => element.addEventListener(event, handler),

    // ---------- Creating & changing elements ----------
    // hf.create('td', { className: 'price', text: '450', attrs: { colspan: 3 } })
    create: (tag, { className = '', text = '', attrs = {} } = {}) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== '' && text !== null && text !== undefined) el.textContent = text;
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        return el;
    },

    clear: (element) => element.replaceChildren(),
    show: (element) => { element.hidden = false; },
    hide: (element) => { element.hidden = true; },

    // Fill a <select> from a list of strings.
    fillSelect: (select, items = [], placeholder = '') => {
        select.replaceChildren();
        if (placeholder) {
            const first = new Option(placeholder, '');
            first.disabled = true;
            first.selected = true;
            select.add(first);
        }
        items.forEach((item) => select.add(new Option(item, item)));
    },

    // One message row spanning a whole table (Loading..., No data, errors)
    tableMessage: (tbody, text, colspan) => {
        tbody.replaceChildren();
        const row = document.createElement('tr');
        const cell = hf.create('td', { className: 'empty', text, attrs: { colspan } });
        row.append(cell);
        tbody.append(row);
    },

    // A small button for table rows.   hf.rowButton('Delete', 'danger', () => ...)
    rowButton: (label, variant, onClick) => {
        const btn = hf.create('button', {
            className: `btn btn-sm btn-${variant}`, text: label, attrs: { type: 'button' },
        });
        btn.addEventListener('click', onClick);
        return btn;
    },

    // ---------- Forms ----------
    formData: (form) => Object.fromEntries(new FormData(form)),

    num: (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    },

    // hf.message(msgEl, 'Saved ✓')   hf.message(msgEl, 'Something went wrong', 'error', 0)
    message: (element, text, type = 'success', seconds = 4) => {
        element.textContent = text;
        element.className = `form-message ${type}`;
        clearTimeout(element._timer);
        if (seconds) {
            element._timer = setTimeout(() => {
                element.textContent = '';
                element.className = 'form-message';
            }, seconds * 1000);
        }
    },

    busy: (button, isBusy, busyText = 'Saving...') => {
        if (isBusy) {
            button.dataset.text = button.textContent;
            button.textContent = busyText;
        } else if (button.dataset.text) {
            button.textContent = button.dataset.text;
        }
        button.disabled = isBusy;
    },

    // ---------- Money ----------
    // hf.money(12500) → "Tk 12,500"
    money: (value) => {
        const { symbol = 'Tk', locale = 'en-IN', decimals = 0 } = settings.currency || {};
        const n = Number(value || 0);
        const amount = Math.abs(n).toLocaleString(locale, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
        return `${n < 0 ? '−' : ''}${symbol} ${amount}`;
    },

    percent: (value, decimals = 1) => `${(Number(value || 0) * 100).toFixed(decimals)}%`,

    // ---------- Dates ----------
    today: () => hf.toInputDate(new Date()),

    // Date → "YYYY-MM-DD" in local time
    toInputDate: (date) => {
        const d = new Date(date);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },

    // Firestore Timestamp / Date / string → "05/11/2026"
    toDate: (value) => (value && typeof value.toDate === 'function' ? value.toDate() : new Date(value)),
    date: (value) => {
        if (!value) return '';
        const d = hf.toDate(value);
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    },

    // Date ranges for filters → { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
    thisMonth: () => {
        const now = new Date();
        return {
            from: hf.toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
            to: hf.toInputDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
        };
    },
    lastMonth: () => {
        const now = new Date();
        return {
            from: hf.toInputDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
            to: hf.toInputDate(new Date(now.getFullYear(), now.getMonth(), 0)),
        };
    },
    thisYear: () => {
        const y = new Date().getFullYear();
        return { from: `${y}-01-01`, to: `${y}-12-31` };
    },

    // ---------- Phone numbers ----------
    // Clean a Bangladeshi mobile number: "+880 1711-123456" → "01711123456"
    phone: (value = '') => {
        let digits = String(value).replace(/\D/g, '');
        if (digits.startsWith('880')) digits = digits.slice(2);       // 8801711... → 01711...
        else if (digits.startsWith('1') && digits.length === 10) digits = '0' + digits;
        return digits;
    },

    // true for 11-digit numbers starting with 013–019
    isPhone: (value) => /^01[3-9]\d{8}$/.test(value),

    // ---------- Misc ----------
    debounce: (fn, ms = 300) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    },

    // hf.title('Products') → "Products | Trusted Select"
    title: (pageName = '') => {
        const name = settings.business?.name || 'Trusted Select';
        document.title = pageName ? `${pageName} | ${name}` : name;
    },

    // ---------- Bangla ----------
    // hf.bn(1250) → "১২৫০"   hf.bnMoney(1250) → "৳১,২৫০"
    bn: (value) => String(value).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]),
    bnMoney: (value) => `৳${hf.bn(Math.round(Number(value) || 0).toLocaleString('en-IN'))}`,

    // ---------- Clipboard ----------
    copy: async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Older browsers / no permission: copy through a hidden text box
            const box = hf.create('textarea', { attrs: { readonly: '' } });
            box.value = text;
            box.style.position = 'fixed';
            box.style.opacity = '0';
            document.body.append(box);
            box.select();
            const ok = document.execCommand('copy');
            box.remove();
            return ok;
        }
    },

    // ---------- Sortable tables ----------
    // const sorter = hf.sortable(table)  → click a column header to sort, click again to reverse.
    // Keeps the sort when rows are redrawn and remembers it for next time.
    // A cell can set data-sort="..." to control its sort value.
    sortable: (table) => {
        const tbody = table.tBodies[0];
        const headers = [...table.tHead.rows[0].cells];
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const storeKey = `sort:${location.pathname.split('/').pop()}:${[...document.querySelectorAll('table')].indexOf(table)}`;
        const listeners = [];
        let col = -1;
        let dir = 1;

        const valueOf = (cell) => {
            if (!cell) return '';
            if (cell.dataset.sort !== undefined) return cell.dataset.sort;
            const select = cell.querySelector('select');
            if (select) return select.options[select.selectedIndex]?.text || '';
            const first = [...cell.childNodes].find((n) => n.textContent.trim());
            return (first ? first.textContent : cell.textContent).trim();
        };
        const toComparable = (raw) => {
            const date = raw.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/);           // 05/11/2026
            if (date) return { n: Number(date[3] + date[2] + date[1]) };
            const num = raw.replace(/Tk|৳|,|%|\s/g, '').replace('−', '-');
            if (/^-?\d+(\.\d+)?$/.test(num)) return { n: Number(num) };
            if (raw === '—' || raw === '') return { n: -Infinity, empty: true };
            return { s: raw };
        };
        const compare = (a, b) => {
            if (col < 0) return Number(a.dataset.orig) - Number(b.dataset.orig);   // back to the original order
            const x = toComparable(valueOf(a.cells[col]));
            const y = toComparable(valueOf(b.cells[col]));
            if (x.n !== undefined && y.n !== undefined && !x.empty && !y.empty) return (x.n - y.n) * dir;
            if (x.empty && !y.empty) return 1;
            if (y.empty && !x.empty) return -1;
            return collator.compare(String(x.s ?? x.n), String(y.s ?? y.n)) * dir;
        };

        const observer = new MutationObserver(() => apply());
        function apply() {
            const rowsNow = [...tbody.rows];
            if (rowsNow.some((r) => r.querySelector('td.empty'))) return;
            let next = Math.max(-1, ...rowsNow.map((r) => Number(r.dataset.orig ?? -1)));
            rowsNow.forEach((r) => { if (r.dataset.orig === undefined) r.dataset.orig = ++next; });   // remember the original order
            if (rowsNow.length < 2) return;
            observer.disconnect();
            rowsNow.sort(compare).forEach((r) => tbody.append(r));
            observer.observe(tbody, { childList: true });
        }

        function setSort(index, direction) {
            col = index;
            dir = direction;
            headers.forEach((h) => h.removeAttribute('aria-sort'));
            if (col >= 0) headers[col].setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
            try { localStorage.setItem(storeKey, `${col}:${dir}`); } catch { /* storage not available */ }
            apply();
            listeners.forEach((fn) => fn(col, dir));
        }

        const columns = [];
        headers.forEach((th, index) => {
            if (th.classList.contains('actions') || th.classList.contains('select-col') || !th.textContent.trim()) return;
            const name = th.textContent.trim().replace(/\s+/g, ' ');
            const type = th.classList.contains('num') ? 'num' : /date|last order/i.test(name) ? 'date' : 'text';
            columns.push({ index, name, type });
            th.classList.add('sortable');
            th.tabIndex = 0;
            th.title = 'Click to sort';
            const click = () => setSort(index, col === index ? -dir : (type === 'text' ? 1 : -1));
            th.addEventListener('click', click);
            th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } });
        });
        observer.observe(tbody, { childList: true });

        // Restore last time's sort
        try {
            const [c, d] = (localStorage.getItem(storeKey) || '').split(':').map(Number);
            if (columns.some((x) => x.index === c) && (d === 1 || d === -1)) setSort(c, d);
        } catch { /* storage not available */ }

        return {
            columns,
            setSort,
            reset: () => setSort(-1, 1),
            onChange: (fn) => listeners.push(fn),
            get state() { return { col, dir }; },
        };
    },

    // A "Sort by" dropdown for a sortable table: hf.sortSelect(hf.sortable(table))
    sortSelect: (sorter) => {
        const select = hf.create('select', { className: 'sort-select', attrs: { 'aria-label': 'Sort by' } });
        select.add(new Option('Sort: default order', ''));
        const words = {
            text: ['A → Z', 'Z → A'],
            num: ['low → high', 'high → low'],
            date: ['oldest first', 'newest first'],
        };
        for (const c of sorter.columns) {
            const [up, down] = words[c.type];
            const label = c.name.charAt(0) + c.name.slice(1).toLowerCase();
            select.add(new Option(`Sort: ${label} ${up}`, `${c.index}:1`));
            select.add(new Option(`Sort: ${label} ${down}`, `${c.index}:-1`));
        }
        const sync = (col, dir) => { select.value = col < 0 ? '' : `${col}:${dir}`; };
        sync(sorter.state.col, sorter.state.dir);
        sorter.onChange(sync);
        select.addEventListener('change', () => {
            if (!select.value) return sorter.reset();
            const [c, d] = select.value.split(':').map(Number);
            sorter.setSort(c, d);
        });
        return select;
    },

    // ---------- CSV export ----------
    // Saves what the table shows (after search / filters) as a CSV file that opens in Excel.
    exportTable: (table, fileName) => {
        const skip = new Set();
        const headers = [...table.tHead.rows[0].cells];
        headers.forEach((th, i) => {
            if (th.classList.contains('actions') || th.classList.contains('select-col') || !th.textContent.trim()) skip.add(i);
        });
        const cellText = (cell) => {
            const select = cell.querySelector('select');
            if (select) return select.options[select.selectedIndex]?.text || '';
            return [...cell.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' · ');
        };
        const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
        const lines = [headers.filter((_, i) => !skip.has(i)).map((th) => quote(th.textContent.trim())).join(',')];
        for (const row of table.tBodies[0].rows) {
            if (row.querySelector('td.empty')) continue;
            lines.push([...row.cells].filter((_, i) => !skip.has(i)).map((c) => quote(cellText(c))).join(','));
        }
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });   // BOM: Bangla shows correctly in Excel
        const url = URL.createObjectURL(blob);
        const a = hf.create('a', { attrs: { href: url, download: `${fileName}-${hf.today()}.csv` } });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    // An "Export CSV" button for a table
    exportButton: (table, fileName) => {
        const btn = hf.create('button', { className: 'btn btn-ghost btn-sm', text: 'Export CSV', attrs: { type: 'button' } });
        btn.addEventListener('click', () => hf.exportTable(table, fileName));
        return btn;
    },

    // ---------- Pop-up window ----------
    // const m = hf.modal({ title: 'Hello', body: element, actions: [buttons] });  m.close()
    modal: ({ title, body, actions = [], wide = false }) => {
        const overlay = hf.create('div', { className: 'modal-overlay' });
        const box = hf.create('div', { className: `modal${wide ? ' modal-wide' : ''}`, attrs: { role: 'dialog', 'aria-modal': 'true' } });
        const head = hf.create('div', { className: 'modal-head' });
        const close = hf.create('button', { className: 'btn btn-ghost btn-sm btn-icon', text: '✕', attrs: { type: 'button', 'aria-label': 'Close' } });
        head.append(hf.create('h2', { text: title }), close);
        const content = hf.create('div', { className: 'modal-body' });
        content.append(body);
        box.append(head, content);
        if (actions.length) {
            const foot = hf.create('div', { className: 'modal-foot' });
            foot.append(...actions);
            box.append(foot);
        }
        overlay.append(box);
        document.body.append(overlay);
        const onKey = (e) => { if (e.key === 'Escape') done(); };
        function done() {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        }
        close.addEventListener('click', done);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) done(); });
        document.addEventListener('keydown', onKey);
        setTimeout(() => (box.querySelector('textarea, input, button:not(.btn-icon)') || close).focus(), 0);
        return { close: done, box };
    },

    // ---------- Row menu (⋯) ----------
    // hf.menuButton([{ label: 'Print', onClick }, { label: 'Delete', onClick, danger: true }])
    menuButton: (items) => {
        const wrap = hf.create('span', { className: 'menu-wrap' });
        const btn = hf.create('button', {
            className: 'btn btn-ghost btn-sm btn-icon', text: '⋯', attrs: { type: 'button', 'aria-label': 'More actions', 'aria-haspopup': 'true' },
        });
        wrap.append(btn);
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            document.querySelectorAll('.menu-pop').forEach((m) => m.remove());
            const pop = hf.create('div', { className: 'menu-pop', attrs: { role: 'menu' } });
            for (const item of items) {
                const option = hf.create(item.href ? 'a' : 'button', {
                    className: `menu-item${item.danger ? ' danger' : ''}`, text: item.label,
                    attrs: item.href ? { href: item.href, role: 'menuitem' } : { type: 'button', role: 'menuitem' },
                });
                if (item.onClick) option.addEventListener('click', () => { pop.remove(); item.onClick(); });
                pop.append(option);
            }
            document.body.append(pop);
            const r = btn.getBoundingClientRect();
            const top = r.bottom + 4 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 4 : r.bottom + 4;
            pop.style.top = `${top + window.scrollY}px`;
            pop.style.left = `${Math.max(8, r.right - pop.offsetWidth) + window.scrollX}px`;
            const closeMenu = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', closeMenu); } };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        });
        return wrap;
    },
};
