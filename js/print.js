// ==============================
// print.js — fill your Word templates with an order and print / download them
// Open directly with: print.html?sale=<id>&doc=invoice   (or doc=confirmation)
//
// Uses three libraries, loaded only on this page:
//   docxtemplater + PizZip  → replace {placeholders} inside the .docx
//   docx-preview (+ JSZip)  → show the filled .docx on screen so it can be printed
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage, createRangeFilter } from "./layout.js";
import { loadSettings, DEFAULT_SETTINGS } from "./app-settings.js";
import { statusLabel, statusOf, codOf, totalDueOf } from "./orders.js";
import { getSales, getSale, getTemplate, saveTemplate, deleteTemplate } from "./firebase.js";
import businessDefaults from "../settings.json" with { type: "json" };


// ---------- Elements ----------
const kindRadios = hf.qa('input[name="doc-kind"]');
const searchInput = hf.q('#order-search');
const orderSelect = hf.q('#order-select');
const printBtn = hf.q('.print-btn');
const downloadBtn = hf.q('.download-btn');
const message = hf.q('#form-message');
const preview = hf.q('#preview');
const templateList = hf.q('#template-list');

const KINDS = {
    invoice: { label: 'Invoice', sample: 'templates/invoice-sample.docx' },
    confirmation: { label: 'Order confirmation', sample: 'templates/confirmation-sample.docx' },
};
const MAX_TEMPLATE_BYTES = 700 * 1024;   // a Firestore document holds at most 1 MB
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let settings = DEFAULT_SETTINGS;
let range;
let sales = [];
let templates = { invoice: null, confirmation: null };
let filled = null;   // { blob, fileName } of the document currently shown


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
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
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
const safeName = (text) => String(text || '').replace(/[^\w-]+/g, '_');

// Turn docxtemplater's errors into something readable
function templateError(error) {
    const list = error.properties?.errors;
    if (list?.length) {
        return 'The template has a placeholder problem: ' +
            list.slice(0, 3).map((e) => e.properties?.explanation || e.message).join(' · ');
    }
    return error.message;
}

// Check a template opens and its placeholders are written correctly
function checkTemplate(bytes) {
    const zip = new window.PizZip(bytes);
    // eslint-disable-next-line no-new
    new window.docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
}


// ---------- The data that goes into the placeholders ----------
function templateData(sale) {
    const money = (n) => hf.money(n);
    const plain = (n) => hf.money(n).replace(/^[^\d−-]*\s/, '');   // "Tk 1,830" → "1,830"
    const items = (sale.items || []).map((i, index) => ({
        no: index + 1,
        name: i.itemName || '',
        code: i.itemCode || '',
        qty: i.qty,
        price: money(i.unitPrice),
        priceAmount: plain(i.unitPrice),
        lineTotal: money(i.qty * i.unitPrice),
        lineTotalAmount: plain(i.qty * i.unitPrice),
    }));
    const amounts = {
        subtotal: sale.grossSale ?? (sale.items || []).reduce((s, i) => s + i.qty * i.unitPrice, 0),
        discount: sale.discount || 0,
        deliveryCharge: sale.deliveryCharge || 0,
        total: totalDueOf(sale),
        advancePaid: sale.advancePaid || 0,
        due: codOf(sale),
    };

    const data = {
        businessName: businessDefaults.business?.name || 'Trusted Select',
        invoiceNo: sale.invoiceNo || sale.memoNo || '',
        orderNo: sale.orderNo || '',
        date: hf.date(sale.date),
        printedOn: hf.date(new Date()),
        status: statusLabel(statusOf(sale)),
        payment: sale.payment || '',
        customerName: sale.customerName || '',
        customerPhone: sale.customerPhone || '',
        customerAddress: sale.customerAddress || '',
        customerEmail: sale.customerEmail || '',
        deliveryZone: sale.deliveryZone || '',
        items,
        itemCount: items.reduce((s, i) => s + Number(i.qty), 0),
    };
    for (const [key, value] of Object.entries(amounts)) {
        data[key] = money(value);
        data[`${key}Amount`] = plain(value);
    }
    return data;
}


// ---------- Filling & showing ----------
async function fillTemplate(kind, sale) {
    const template = templates[kind];
    if (!template) throw new Error(`No ${KINDS[kind].label.toLowerCase()} template yet. Upload one below (or use the sample).`);
    await loadLibs();
    try {
        const zip = new window.PizZip(base64ToBytes(template.data));
        const doc = new window.docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            nullGetter: () => '',          // unknown placeholder → blank instead of "undefined"
        });
        doc.render(templateData(sale));
        return doc.getZip().generate({ type: 'blob', mimeType: DOCX_TYPE });
    } catch (error) {
        throw new Error(templateError(error));
    }
}

const selectedSale = () => sales.find((s) => s.id === orderSelect.value);

async function showPreview() {
    const sale = selectedSale();
    filled = null;
    if (!sale) {
        preview.replaceChildren(hf.create('p', { className: 'empty-note', text: 'Choose an order to see it here.' }));
        return;
    }
    const kind = currentKind();
    preview.replaceChildren(hf.create('p', { className: 'empty-note', text: 'Preparing preview...' }));
    try {
        const blob = await fillTemplate(kind, sale);
        const number = kind === 'invoice' ? (sale.invoiceNo || sale.memoNo) : (sale.orderNo || sale.invoiceNo);
        filled = { blob, fileName: `${KINDS[kind].label.replace(/\s+/g, '-')}-${safeName(number || sale.id)}.docx` };
        preview.replaceChildren();
        await window.docx.renderAsync(blob, preview, null, {
            inWrapper: true,
            ignoreLastRenderedPageBreak: true,
            experimental: true,
        });
        history.replaceState(null, '', `?sale=${encodeURIComponent(sale.id)}&doc=${kind}`);
    } catch (error) {
        console.error(error);
        preview.replaceChildren(hf.create('p', { className: 'empty-note negative', text: error.message }));
    }
}


// ---------- Order picker ----------
function orderLabel(s) {
    return [
        hf.date(s.date),
        s.invoiceNo || s.memoNo ? `Inv ${s.invoiceNo || s.memoNo}` : '',
        s.orderNo ? `Order ${s.orderNo}` : '',
        s.customerName,
        s.customerPhone,
        hf.money(totalDueOf(s)),
    ].filter(Boolean).join(' · ');
}

function fillOrderSelect(keepId) {
    const term = searchInput.value.trim().toLowerCase();
    const shown = sales.filter((s) => !term ||
        [s.invoiceNo, s.memoNo, s.orderNo, s.customerName, s.customerPhone].join(' ').toLowerCase().includes(term));

    orderSelect.replaceChildren();
    const first = new Option(shown.length ? `Choose an order (${shown.length})` : 'No orders found', '');
    first.disabled = true;
    orderSelect.add(first);
    shown.forEach((s) => orderSelect.add(new Option(orderLabel(s), s.id)));

    if (keepId && shown.some((s) => s.id === keepId)) orderSelect.value = keepId;
    else if (shown.length === 1) orderSelect.value = shown[0].id;
    else orderSelect.value = '';
}

async function loadOrders(keepId = orderSelect.value) {
    try {
        sales = await getSales(range.from, range.to);
        // An order opened from a link might be outside the period: add it anyway
        if (keepId && !sales.some((s) => s.id === keepId)) {
            const extra = await getSale(keepId);
            if (extra) sales.unshift(extra);
        }
        fillOrderSelect(keepId);
        await showPreview();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not load orders: ${error.message}`, 'error', 0);
    }
}


// ---------- Templates ----------
function renderTemplates() {
    templateList.replaceChildren();
    for (const [kind, info] of Object.entries(KINDS)) {
        const t = templates[kind];
        const row = hf.create('div', { className: 'template-row' });

        const text = hf.create('div', { className: 'template-info' });
        text.append(hf.create('strong', { text: info.label }));
        text.append(hf.create('span', {
            className: 'sub',
            text: t ? `${t.name} · ${kb(t.size)}${t.updatedAt ? ` · updated ${hf.date(t.updatedAt)}` : ''}` : 'No template yet',
        }));

        const fileInput = hf.create('input', {
            attrs: { type: 'file', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', hidden: '' },
        });
        hf.on(fileInput, 'change', () => uploadTemplate(kind, fileInput.files[0]));

        const buttons = hf.create('div', { className: 'template-actions' });
        buttons.append(
            hf.rowButton(t ? 'Replace' : 'Upload .docx', t ? 'ghost' : 'primary', () => fileInput.click()),
            hf.rowButton('Use sample', 'ghost', () => useSample(kind)),
        );
        if (t) {
            buttons.append(
                hf.rowButton('Download', 'ghost', () => downloadBlob(new Blob([base64ToBytes(t.data)], { type: DOCX_TYPE }), t.name)),
                hf.rowButton('Remove', 'danger', () => removeTemplate(kind)),
            );
        }
        row.append(text, buttons, fileInput);
        templateList.append(row);
    }
}

async function storeTemplate(kind, name, buffer) {
    if (buffer.byteLength > MAX_TEMPLATE_BYTES) {
        throw new Error(`${name} is ${kb(buffer.byteLength)}. Templates must be under ${kb(MAX_TEMPLATE_BYTES)} — make pictures smaller in Word (Picture Format → Compress Pictures).`);
    }
    await loadLibs();
    try {
        checkTemplate(new Uint8Array(buffer));
    } catch (error) {
        throw new Error(templateError(error));
    }
    const record = { name, size: buffer.byteLength, data: bytesToBase64(buffer) };
    await saveTemplate(kind, record);
    templates[kind] = { ...record, updatedAt: new Date() };
}

async function uploadTemplate(kind, file) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
        hf.message(message, 'Please choose a Word .docx file (not .doc or .pdf).', 'error', 0);
        return;
    }
    try {
        await storeTemplate(kind, file.name, await file.arrayBuffer());
        hf.message(message, `${KINDS[kind].label} template saved ✓`);
        renderTemplates();
        if (currentKind() === kind) await showPreview();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save template: ${error.message}`, 'error', 0);
    }
}

async function useSample(kind) {
    if (templates[kind] && !confirm(`Replace your ${KINDS[kind].label.toLowerCase()} template with the sample?`)) return;
    try {
        const response = await fetch(KINDS[kind].sample);
        if (!response.ok) throw new Error('Sample file not found.');
        await storeTemplate(kind, KINDS[kind].sample.split('/').pop(), await response.arrayBuffer());
        hf.message(message, `Sample ${KINDS[kind].label.toLowerCase()} template saved ✓ Download it to see how the placeholders are used.`);
        renderTemplates();
        if (currentKind() === kind) await showPreview();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not use sample: ${error.message}`, 'error', 0);
    }
}

async function removeTemplate(kind) {
    if (!confirm(`Remove the ${KINDS[kind].label.toLowerCase()} template?`)) return;
    try {
        await deleteTemplate(kind);
        templates[kind] = null;
        renderTemplates();
        if (currentKind() === kind) await showPreview();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not remove: ${error.message}`, 'error', 0);
    }
}


// ---------- Events ----------
kindRadios.forEach((r) => hf.on(r, 'change', showPreview));
hf.on(orderSelect, 'change', showPreview);
hf.on(searchInput, 'input', hf.debounce(() => {
    const before = orderSelect.value;
    fillOrderSelect(before);
    if (orderSelect.value !== before) showPreview();
}, 250));

hf.on(printBtn, 'click', async () => {
    if (!selectedSale()) {
        hf.message(message, 'Choose an order first.', 'error');
        return;
    }
    if (!filled) await showPreview();
    if (filled) window.print();
});

hf.on(downloadBtn, 'click', async () => {
    if (!selectedSale()) {
        hf.message(message, 'Choose an order first.', 'error');
        return;
    }
    if (!filled) await showPreview();
    if (filled) downloadBlob(filled.blob, filled.fileName);
});


// ---------- Start ----------
const params = new URLSearchParams(location.search);
if (params.get('doc') && KINDS[params.get('doc')]) {
    kindRadios.forEach((r) => { r.checked = r.value === params.get('doc'); });
}
range = createRangeFilter(hf.q('#print-range'), () => loadOrders());

startPage({
    title: 'Print',
    onReady: async () => {
        settings = await loadSettings();
        loadLibs().catch((error) => hf.message(message, error.message, 'error', 0));   // start downloading early
        try {
            const [invoice, confirmation] = await Promise.all([getTemplate('invoice'), getTemplate('confirmation')]);
            templates = { invoice, confirmation };
        } catch (error) {
            console.error(error);
            hf.message(message, `Could not load templates: ${error.message}`, 'error', 0);
        }
        renderTemplates();
        await loadOrders(params.get('sale') || '');
    },
});
