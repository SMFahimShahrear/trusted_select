// ==============================
// print.js — print invoices / order confirmations for one or many orders
// Open directly with: print.html?sales=<id>,<id>&doc=invoice-2up | invoice-1up | order-confirmation
//
// Libraries (loaded only on this page):
//   docxtemplater + PizZip  → fill the {placeholders} in the Word design
//   docx-preview (+ JSZip)  → show the filled document on screen so it can be printed
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage, createRangeFilter } from "./layout.js";
import { loadSettings, DEFAULT_SETTINGS } from "./app-settings.js";
import { STATUSES, statusOf, statusBadge, totalDueOf, toShip, isActive } from "./orders.js";
import { orderData } from "./documents.js";
import { getSales, getSale, getTemplate, saveTemplate, deleteTemplate } from "./firebase.js";


// ---------- Elements ----------
const kindRadios = hf.qa('input[name="doc-kind"]');
const printBtn = hf.q('.print-btn');
const downloadBtn = hf.q('.download-btn');
const printSummary = hf.q('.print-summary');
const message = hf.q('#form-message');
const statusFilter = hf.q('#status-filter');
const searchInput = hf.q('#order-search');
const selectAll = hf.q('#select-all');
const tableBody = hf.q('#order-table-body');
const preview = hf.q('#preview');
const templateList = hf.q('#template-list');
const pageSizeStyle = hf.q('#page-size');

const KINDS = {
    'invoice-2up': { label: 'Invoice · 2 per page', file: 'templates/invoice-2up.docx', landscape: true, perPage: 2 },
    'invoice-1up': { label: 'Invoice · 1 per page', file: 'templates/invoice-1up.docx', landscape: false, perPage: 1 },
    'order-confirmation': { label: 'Order confirmation', file: 'templates/order-confirmation.docx', landscape: false, perPage: 1 },
};
const MAX_TEMPLATE_BYTES = 700 * 1024;   // a Firestore document holds at most 1 MB
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PAGE_BREAK = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

let settings = DEFAULT_SETTINGS;
let range;
let sales = [];                    // orders in the chosen period (+ any opened from a link)
const selected = new Set();
const custom = {};                 // your uploaded designs, by kind (null = use built-in)
const builtIn = {};                // built-in designs (downloaded once)
let filled = null;                 // { blob, fileName } currently shown


// ---------- Libraries ----------
const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/pizzip@3.3.0/dist/pizzip.min.js',
    'https://cdn.jsdelivr.net/npm/docxtemplater@3.71.0/build/docxtemplater.min.js',
    'https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/dist/docx-preview.min.js',
];

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Could not load ${src.split('/').pop()}. Check your internet.`));
        document.head.append(script);
    });
}
let libsLoading;
const loadLibs = () => (libsLoading ??= LIBS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve()));


// ---------- File helpers ----------
function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = hf.create('a', { attrs: { href: url, download: fileName } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const currentKind = () => kindRadios.find((r) => r.checked).value;
const docText = (zip) => zip.file('word/document.xml').asText().replace(/<[^>]+>/g, '');

function templateError(error) {
    const list = error.properties?.errors;
    if (list?.length) {
        return 'The design has a placeholder problem: ' +
            list.slice(0, 3).map((e) => e.properties?.explanation || e.message).join(' · ');
    }
    return error.message;
}

// Designs without {#pages} get it added, so several orders print on separate pages
function ensurePagesLoop(zip) {
    if (docText(zip).includes('{#pages}')) return;
    const path = 'word/document.xml';
    let xml = zip.file(path).asText();
    const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    xml = xml.replace(/<w:body>/, `<w:body>${p('{#pages}')}${p('{@pageBreak}')}`);
    const end = xml.lastIndexOf('<w:sectPr');
    xml = xml.slice(0, end) + p('{/pages}') + xml.slice(end);
    zip.file(path, xml);
}


// ---------- Designs ----------
async function designBytes(kind) {
    if (custom[kind]) return base64ToBytes(custom[kind].data);
    if (!builtIn[kind]) {
        const response = await fetch(KINDS[kind].file);
        if (!response.ok) throw new Error(`Built-in design ${KINDS[kind].file} not found.`);
        builtIn[kind] = new Uint8Array(await response.arrayBuffer());
    }
    return builtIn[kind];
}

function renderTemplates() {
    templateList.replaceChildren();
    for (const [kind, info] of Object.entries(KINDS)) {
        const t = custom[kind];
        const row = hf.create('div', { className: 'template-row' });
        const text = hf.create('div', { className: 'template-info' });
        text.append(
            hf.create('strong', { text: info.label }),
            hf.create('span', {
                className: 'sub',
                text: t ? `Your file: ${t.name} · ${kb(t.size)}${t.updatedAt ? ` · ${hf.date(t.updatedAt)}` : ''}` : 'Built-in design (from your Word file)',
            }),
        );
        const fileInput = hf.create('input', { attrs: { type: 'file', accept: '.docx', hidden: '' } });
        hf.on(fileInput, 'change', () => uploadTemplate(kind, fileInput.files[0]));

        const buttons = hf.create('div', { className: 'template-actions' });
        buttons.append(
            hf.rowButton(t ? 'Replace' : 'Upload your own', 'ghost', () => fileInput.click()),
            hf.rowButton('Download', 'ghost', async () => {
                try {
                    downloadBlob(new Blob([await designBytes(kind)], { type: DOCX_TYPE }), t ? t.name : KINDS[kind].file.split('/').pop());
                } catch (error) { hf.message(message, error.message, 'error', 0); }
            }),
        );
        if (t) buttons.append(hf.rowButton('Use built-in', 'danger', () => removeTemplate(kind)));
        row.append(text, buttons, fileInput);
        templateList.append(row);
    }
}

async function uploadTemplate(kind, file) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) return hf.message(message, 'Please choose a Word .docx file (not .doc or .pdf).', 'error', 0);
    try {
        const buffer = await file.arrayBuffer();
        if (buffer.byteLength > MAX_TEMPLATE_BYTES) {
            throw new Error(`${file.name} is ${kb(buffer.byteLength)}. Designs must be under ${kb(MAX_TEMPLATE_BYTES)}: make pictures smaller in Word (Picture Format → Compress Pictures).`);
        }
        await loadLibs();
        try {
            const zip = new window.PizZip(new Uint8Array(buffer));
            ensurePagesLoop(zip);
            // eslint-disable-next-line no-new
            new window.docxtemplater(zip, { paragraphLoop: true, linebreaks: true });   // checks the placeholders
        } catch (error) {
            throw new Error(templateError(error));
        }
        const record = { name: file.name, size: buffer.byteLength, data: bytesToBase64(buffer) };
        await saveTemplate(kind, record);
        custom[kind] = { ...record, updatedAt: new Date() };
        hf.message(message, `${KINDS[kind].label}: your design saved ✓`);
        renderTemplates();
        if (currentKind() === kind) refreshPreview();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save design: ${error.message}`, 'error', 0);
    }
}

async function removeTemplate(kind) {
    if (!confirm(`Go back to the built-in ${KINDS[kind].label.toLowerCase()} design?`)) return;
    try {
        await deleteTemplate(kind);
        custom[kind] = null;
        renderTemplates();
        if (currentKind() === kind) refreshPreview();
    } catch (error) {
        hf.message(message, `Could not remove: ${error.message}`, 'error', 0);
    }
}


// ---------- Filling ----------
// Selected orders in the order they appear in the list (so sorting the list sorts the printout)
function selectedOrders() {
    const shown = hf.qa('#order-table-body tr[data-id]').map((r) => r.dataset.id);
    const ids = [...shown.filter((id) => selected.has(id)), ...[...selected].filter((id) => !shown.includes(id))];
    return ids.map((id) => sales.find((s) => s.id === id)).filter(Boolean);
}

async function fillDocument(kind, orders) {
    await loadLibs();
    const zip = new window.PizZip(await designBytes(kind));
    ensurePagesLoop(zip);
    const text = docText(zip);
    const data = orders.map((s) => orderData(s, settings));

    let pages;
    if (KINDS[kind].perPage === 2 && text.includes('{#inv1}')) {
        pages = [];
        for (let i = 0; i < data.length; i += 2) pages.push({ inv1: data[i], inv2: data[i + 1], pageBreak: i ? PAGE_BREAK : '' });
    } else {
        pages = data.map((d, i) => ({ ...d, pageBreak: i ? PAGE_BREAK : '' }));
    }
    try {
        const doc = new window.docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            nullGetter: () => '',          // unknown placeholder → blank, not "undefined"
        });
        doc.render({ ...data[0], pages });
        return { blob: doc.getZip().generate({ type: 'blob', mimeType: DOCX_TYPE }), pageCount: pages.length };
    } catch (error) {
        throw new Error(templateError(error));
    }
}

// Make every page fit exactly one sheet of paper.
// The browser draws text a little taller than Word does, so a full page can come out ~2% too tall
// and spill onto a second sheet. Pages that are too tall are shrunk just enough to fit.
const MM = 96 / 25.4;   // CSS pixels per millimetre
async function fitPages(container, kind) {
    if (document.fonts?.ready) await document.fonts.ready;
    const pageHeight = (KINDS[kind].landscape ? 210 : 297) * MM - 4;   // a few px spare for rounding
    for (const section of container.querySelectorAll('section.docx')) {
        let scale = 1;
        // Shrink, measure again (the footer can overflow its strip), repeat until nothing sticks out
        for (let attempt = 0; attempt < 5; attempt++) {
            section.style.zoom = scale < 1 ? String(scale) : '';
            section.style.minHeight = `${pageHeight / scale}px`;
            section.style.maxHeight = `${pageHeight / scale}px`;
            section.style.overflow = 'hidden';
            const overflow = section.scrollHeight - section.clientHeight;
            if (overflow <= 1) break;
            scale = Math.floor(scale * (section.clientHeight / section.scrollHeight) * 1000) / 1000;
        }
    }
}

let previewToken = 0;
async function showPreview() {
    const token = ++previewToken;
    const kind = currentKind();
    const orders = selectedOrders();
    filled = null;
    pageSizeStyle.textContent = `@media print { @page { size: A4 ${KINDS[kind].landscape ? 'landscape' : 'portrait'}; margin: 0; } }`;
    updateSummary(orders);

    if (!orders.length) {
        preview.replaceChildren(hf.create('p', { className: 'empty-note', text: 'Tick one or more orders to see them here.' }));
        return;
    }
    preview.replaceChildren(hf.create('p', { className: 'empty-note', text: 'Preparing preview...' }));
    try {
        const { blob } = await fillDocument(kind, orders);
        if (token !== previewToken) return;     // a newer preview started
        const first = orders[0];
        const name = orders.length === 1 ? (kind === 'order-confirmation' ? first.orderNo : first.invoiceNo) || first.invoiceNo || first.id : `${orders.length}-orders-${hf.today()}`;
        filled = { blob, fileName: `${KINDS[kind].label.replace(/[^\w]+/g, '-')}-${String(name).replace(/[^\w-]+/g, '_')}.docx` };
        const target = hf.create('div');
        await window.docx.renderAsync(blob, target, null, { inWrapper: true, ignoreLastRenderedPageBreak: true, experimental: true });
        if (token !== previewToken) return;
        preview.replaceChildren(target);
        // The previewer lines up tab stops ~0.5 s after drawing; fit the pages only after that
        await new Promise((resolve) => setTimeout(resolve, 650));
        if (token !== previewToken) return;
        await fitPages(target, kind);
        history.replaceState(null, '', `?sales=${encodeURIComponent(orders.map((o) => o.id).join(','))}&doc=${kind}`);
    } catch (error) {
        console.error(error);
        if (token === previewToken) preview.replaceChildren(hf.create('p', { className: 'empty-note negative', text: error.message }));
    }
}
const refreshPreview = hf.debounce(showPreview, 350);

function updateSummary(orders = selectedOrders()) {
    const kind = currentKind();
    const pages = Math.ceil(orders.length / (KINDS[kind].perPage === 2 ? 2 : 1));
    printSummary.textContent = orders.length
        ? `${orders.length} order${orders.length > 1 ? 's' : ''} → ${pages} page${pages > 1 ? 's' : ''}`
        : 'Tick the orders below.';
}


// ---------- Order list ----------
function createOrderRow(s) {
    const row = hf.create('tr', { className: selected.has(s.id) ? 'is-selected' : '' });
    row.dataset.id = s.id;

    const pickCell = hf.create('td', { className: 'select-col' });
    const pick = hf.create('input', { attrs: { type: 'checkbox', 'aria-label': 'Select order' } });
    pick.checked = selected.has(s.id);
    hf.on(pick, 'change', () => {
        if (pick.checked) selected.add(s.id); else selected.delete(s.id);
        row.classList.toggle('is-selected', pick.checked);
        syncSelectAll();
        refreshPreview();
    });
    pickCell.append(pick);

    const customer = hf.create('td', { className: 'wrap' });
    customer.append(hf.create('strong', { text: s.customerName || '—' }));
    if (s.customerPhone) customer.append(hf.create('span', { className: 'sub', text: s.customerPhone }));

    const statusCell = hf.create('td', { className: 'status-cell' });
    statusCell.append(statusBadge(s));

    row.append(
        pickCell,
        hf.create('td', { text: hf.date(s.date) }),
        hf.create('td', { className: 'code', text: s.invoiceNo || s.memoNo || '—' }),
        hf.create('td', { className: 'code', text: s.orderNo || '—' }),
        customer,
        statusCell,
        hf.create('td', { className: 'num', text: hf.money(totalDueOf(s)) }),
    );
    // Click anywhere on the row to tick it
    hf.on(row, 'click', (e) => { if (e.target !== pick) pick.click(); });
    return row;
}

function renderOrders() {
    const term = searchInput.value.trim().toLowerCase();
    const filter = statusFilter.value;
    const shown = sales.filter((s) => {
        if (filter === 'toShip' && !toShip(s)) return false;
        if (filter === 'active' && !isActive(s)) return false;
        if (filter && !['toShip', 'active'].includes(filter) && statusOf(s) !== filter) return false;
        if (!term) return true;
        return [s.invoiceNo, s.memoNo, s.orderNo, s.customerName, s.customerPhone].join(' ').toLowerCase().includes(term);
    });
    if (!shown.length) {
        hf.tableMessage(tableBody, sales.length ? 'No orders match.' : 'No orders in this period.', 7);
    } else {
        hf.clear(tableBody);
        shown.forEach((s) => tableBody.append(createOrderRow(s)));
    }
    syncSelectAll();
}

function syncSelectAll() {
    const ids = hf.qa('#order-table-body tr[data-id]').map((r) => r.dataset.id);
    selectAll.checked = ids.length > 0 && ids.every((id) => selected.has(id));
    selectAll.indeterminate = !selectAll.checked && ids.some((id) => selected.has(id));
}

async function loadOrders(extraIds = []) {
    hf.tableMessage(tableBody, 'Loading...', 7);
    try {
        sales = await getSales(range.from, range.to);
        // Orders opened from a link may be outside the period: add them anyway
        for (const id of extraIds) {
            if (!sales.some((s) => s.id === id)) {
                const extra = await getSale(id);
                if (extra) sales.push(extra);
            }
        }
        for (const id of [...selected]) if (!sales.some((s) => s.id === id)) selected.delete(id);
        renderOrders();
        refreshPreview();
    } catch (error) {
        console.error(error);
        hf.tableMessage(tableBody, `Could not load orders: ${error.message}`, 7);
    }
}


// ---------- Events ----------
kindRadios.forEach((r) => hf.on(r, 'change', () => { updateSummary(); refreshPreview(); }));
hf.on(searchInput, 'input', hf.debounce(renderOrders, 200));
hf.on(statusFilter, 'change', renderOrders);
hf.on(selectAll, 'change', () => {
    hf.qa('#order-table-body tr[data-id]').forEach((row) => {
        if (selectAll.checked) selected.add(row.dataset.id); else selected.delete(row.dataset.id);
        row.classList.toggle('is-selected', selectAll.checked);
        row.querySelector('.select-col input').checked = selectAll.checked;
    });
    refreshPreview();
});

async function ready() {
    if (!selectedOrders().length) {
        hf.message(message, 'Tick at least one order first.', 'error');
        return false;
    }
    if (!filled) await showPreview();
    return Boolean(filled);
}
hf.on(printBtn, 'click', async () => {
    if (!(await ready())) return;
    await fitPages(preview, currentKind());   // re-check, in case fonts finished loading after the preview
    window.print();
});
hf.on(downloadBtn, 'click', async () => { if (await ready()) downloadBlob(filled.blob, filled.fileName); });


// ---------- Start ----------
const params = new URLSearchParams(location.search);
const docParam = params.get('doc');
if (docParam && KINDS[docParam]) kindRadios.forEach((r) => { r.checked = r.value === docParam; });
const linkIds = (params.get('sales') || params.get('sale') || '').split(',').map((s) => s.trim()).filter(Boolean);
linkIds.forEach((id) => selected.add(id));

statusFilter.replaceChildren(
    new Option('All orders', ''),
    new Option('Active (not returned/cancelled)', 'active'),
    new Option('To ship (pending + packaged)', 'toShip'),
    ...STATUSES.map((s) => new Option(s.label, s.key)),
);
range = createRangeFilter(hf.q('#print-range'), () => loadOrders());
searchInput.closest('.card-head-tools').append(hf.sortSelect(hf.sortable(tableBody.closest('table'))));

startPage({
    title: 'Print',
    onReady: async () => {
        settings = await loadSettings();
        loadLibs().catch((error) => hf.message(message, error.message, 'error', 0));   // start downloading early
        try {
            const saved = await Promise.all(Object.keys(KINDS).map((k) => getTemplate(k)));
            Object.keys(KINDS).forEach((k, i) => { custom[k] = saved[i]; });
        } catch (error) {
            console.error(error);
            hf.message(message, `Could not load your designs: ${error.message}`, 'error', 0);
        }
        renderTemplates();
        await loadOrders(linkIds);
    },
});
