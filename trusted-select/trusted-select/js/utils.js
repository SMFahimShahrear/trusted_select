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
};
