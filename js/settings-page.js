// ==============================
// settings-page.js — edit the app's defaults (saved in Firestore: settings/app)
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage } from "./layout.js";
import { loadSettings, DEFAULT_SETTINGS, DEFAULT_SUMMARY } from "./app-settings.js";
import { banglaSummary } from "./documents.js";
import { saveAppSettings, getBackup } from "./firebase.js";


// ---------- Elements ----------
const form = hf.q('#settings-form');
const saveBtn = hf.q('.save-settings-btn');
const resetBtn = hf.q('.reset-settings-btn');
const message = hf.q('#form-message');

const zoneList = hf.q('#zone-list');
const addZoneBtn = hf.q('.add-zone-btn');
const defaultZoneSelect = hf.q('#default-zone');
const freeDeliveryInput = hf.q('#free-delivery-over');
const codChargeInput = hf.q('#cod-charge');
const contactPhoneInput = hf.q('#contact-phone');
const backupBtn = hf.q('.backup-btn');
const summaryInput = hf.q('#summary-template');
const summaryPreview = hf.q('#summary-preview');
const resetSummaryBtn = hf.q('.reset-summary-btn');

const invoicePrefixInput = hf.q('#invoice-prefix');
const invoiceExample = hf.q('.invoice-example');
const defaultPaymentSelect = hf.q('#default-payment');
const paymentMethodsInput = hf.q('#payment-methods');

const lowStockInput = hf.q('#default-low-stock');
const codePrefixInput = hf.q('#code-prefix');
const defaultUnitSelect = hf.q('#default-unit');
const categoriesInput = hf.q('#product-categories');
const unitsInput = hf.q('#product-units');

const expenseCategoriesInput = hf.q('#expense-categories');
const paidByInput = hf.q('#expense-paid-by');


// ---------- Functions ----------
// Textarea (one per line) ↔ list
const toLines = (list = []) => list.join('\n');
const fromLines = (text) => [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))];

// Fill a "default" dropdown from a list, keeping the current choice if it still exists
function fillDefaultSelect(select, items, wanted) {
    const keep = wanted ?? select.value;
    hf.fillSelect(select, items);
    if (items.includes(keep)) select.value = keep;
}

// One delivery zone row: [name] [customer pays] [courier fee] [order prefix] [✕]
function addZoneRow(zone = { name: '', charge: 0, courierFee: 0, orderPrefix: '', deliveryTime: '' }) {
    const row = hf.create('div', { className: 'zone-row' });
    const name = hf.create('input', {
        className: 'zone-name', attrs: { type: 'text', placeholder: 'e.g. Inside Dhaka', required: '', 'aria-label': 'Zone name' },
    });
    name.value = zone.name;
    const charge = hf.create('input', {
        className: 'zone-charge', attrs: { type: 'number', min: '0', step: '1', required: '', placeholder: 'Customer pays', 'aria-label': 'Customer pays' },
    });
    charge.value = zone.charge;
    const fee = hf.create('input', {
        className: 'zone-fee', attrs: { type: 'number', min: '0', step: '1', required: '', placeholder: 'Courier fee', 'aria-label': 'Courier fee' },
    });
    fee.value = zone.courierFee ?? 0;
    const prefix = hf.create('input', {
        className: 'zone-prefix', attrs: { type: 'text', maxlength: '4', placeholder: 'ID', 'aria-label': 'Order prefix' },
    });
    prefix.value = zone.orderPrefix ?? '';
    hf.on(prefix, 'input', () => { prefix.value = prefix.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    const time = hf.create('input', {
        className: 'zone-time', attrs: { type: 'text', maxlength: '20', placeholder: 'e.g. 1-2 days', 'aria-label': 'Delivery time' },
    });
    time.value = zone.deliveryTime ?? '';
    const remove = hf.create('button', {
        className: 'btn btn-ghost btn-sm btn-icon', text: '✕', attrs: { type: 'button', 'aria-label': 'Remove zone' },
    });
    hf.on(remove, 'click', () => {
        if (hf.qa('.zone-row', zoneList).length <= 1) {
            hf.message(message, 'Keep at least one delivery zone.', 'error');
            return;
        }
        row.remove();
        refreshZoneSelect();
    });
    hf.on(name, 'input', refreshZoneSelect);

    row.append(name, charge, fee, prefix, time, remove);
    zoneList.append(row);
}

function readZones() {
    return hf.qa('.zone-row', zoneList)
        .map((row) => ({
            name: hf.q('.zone-name', row).value.trim(),
            charge: hf.num(hf.q('.zone-charge', row).value),
            courierFee: hf.num(hf.q('.zone-fee', row).value),
            orderPrefix: hf.q('.zone-prefix', row).value.trim(),
            deliveryTime: hf.q('.zone-time', row).value.trim(),
        }))
        .filter((z) => z.name);
}

const refreshZoneSelect = () => fillDefaultSelect(defaultZoneSelect, readZones().map((z) => z.name));

// Put a settings object into the form
function fillForm(s) {
    hf.clear(zoneList);
    s.sales.deliveryZones.forEach((z) => addZoneRow(z));
    fillDefaultSelect(defaultZoneSelect, s.sales.deliveryZones.map((z) => z.name), s.sales.defaultZone);
    freeDeliveryInput.value = s.sales.freeDeliveryOver ?? 0;
    codChargeInput.value = s.sales.codChargePercent ?? 0;
    contactPhoneInput.value = s.sales.contactPhone || '';
    summaryInput.value = s.sales.summaryTemplate?.trim() ? s.sales.summaryTemplate : DEFAULT_SUMMARY;
    showSummaryPreview();

    invoicePrefixInput.value = s.sales.invoicePrefix || '';
    showInvoiceExample();
    paymentMethodsInput.value = toLines(s.sales.paymentMethods);
    fillDefaultSelect(defaultPaymentSelect, s.sales.paymentMethods, s.sales.defaultPayment);

    lowStockInput.value = s.products.defaultLowStockAlert;
    codePrefixInput.value = s.products.codePrefix;
    categoriesInput.value = toLines(s.products.categories);
    unitsInput.value = toLines(s.products.units);
    fillDefaultSelect(defaultUnitSelect, s.products.units, s.products.defaultUnit);

    expenseCategoriesInput.value = toLines(s.expenses.categories);
    paidByInput.value = toLines(s.expenses.paidBy);
}

// Read the form into a settings object (throws if something's missing)
function readForm() {
    const zones = readZones();
    const names = zones.map((z) => z.name.toLowerCase());
    if (zones.length === 0) throw new Error('Add at least one delivery zone.');
    if (new Set(names).size !== names.length) throw new Error('Two delivery zones have the same name.');

    const lists = {
        'Payment methods': fromLines(paymentMethodsInput.value),
        'Categories': fromLines(categoriesInput.value),
        'Units': fromLines(unitsInput.value),
        'Expense categories': fromLines(expenseCategoriesInput.value),
        'Paid by options': fromLines(paidByInput.value),
    };
    for (const [label, list] of Object.entries(lists)) {
        if (list.length === 0) throw new Error(`${label} can't be empty.`);
    }

    return {
        products: {
            codePrefix: codePrefixInput.value.trim() || 'TS-',
            defaultUnit: defaultUnitSelect.value || lists['Units'][0],
            defaultLowStockAlert: hf.num(lowStockInput.value),
            categories: lists['Categories'],
            units: lists['Units'],
        },
        sales: {
            invoicePrefix: invoicePrefixInput.value.trim(),
            defaultPayment: defaultPaymentSelect.value || lists['Payment methods'][0],
            paymentMethods: lists['Payment methods'],
            deliveryZones: zones,
            defaultZone: defaultZoneSelect.value || zones[0].name,
            freeDeliveryOver: hf.num(freeDeliveryInput.value),
            codChargePercent: hf.num(codChargeInput.value),
            contactPhone: hf.phone(contactPhoneInput.value),
            summaryTemplate: summaryInput.value.trim() === DEFAULT_SUMMARY.trim() ? '' : summaryInput.value,
        },
        expenses: {
            categories: lists['Expense categories'],
            paidBy: lists['Paid by options'],
        },
    };
}


// Show the message for a made-up order, so you can see your changes
const SAMPLE_SALE = {
    customerName: 'আরশি হাবিব', customerPhone: '01873682563', customerAddress: 'মহেশপুর, মেহেরপুর',
    orderNo: 'OD26110700001', invoiceNo: '2600001', date: new Date(), deliveryZone: 'Outside Dhaka',
    items: [{ itemName: 'Wooden money-saving box', qty: 1, unitPrice: 260 }, { itemName: 'Marker Pen', qty: 2, unitPrice: 30 }],
    discount: 0, deliveryCharge: 130, advancePaid: 100, payment: 'bKash', notes: '',
};
function showSummaryPreview() {
    const preview = {
        sales: { ...DEFAULT_SETTINGS.sales, deliveryZones: readZones(), contactPhone: contactPhoneInput.value, summaryTemplate: summaryInput.value },
    };
    summaryPreview.textContent = banglaSummary(SAMPLE_SALE, preview);
}

function showInvoiceExample() {
    const yy = String(new Date().getFullYear() % 100).padStart(2, '0');
    invoiceExample.textContent = `${invoicePrefixInput.value.trim()}${yy}00001`;
}


// ---------- Events ----------
hf.on(invoicePrefixInput, 'input', showInvoiceExample);
hf.on(summaryInput, 'input', hf.debounce(showSummaryPreview, 200));
hf.on(contactPhoneInput, 'input', hf.debounce(showSummaryPreview, 200));
hf.on(resetSummaryBtn, 'click', () => {
    if (!confirm('Put back the original Bangla message? (Saved when you press "Save settings")')) return;
    summaryInput.value = DEFAULT_SUMMARY;
    showSummaryPreview();
});

hf.on(backupBtn, 'click', async () => {
    hf.busy(backupBtn, true, 'Preparing...');
    try {
        const backup = await getBackup();
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = hf.create('a', { attrs: { href: url, download: `trusted-select-backup-${hf.today()}.json` } });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        const counts = ['products', 'sales', 'customers', 'expenses'].map((k) => `${backup[k].length} ${k}`).join(', ');
        hf.message(message, `Backup downloaded ✓ (${counts})`);
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not make backup: ${error.message}`, 'error', 0);
    } finally {
        hf.busy(backupBtn, false);
    }
});
hf.on(addZoneBtn, 'click', () => {
    addZoneRow();
    hf.q('.zone-row:last-child .zone-name', zoneList).focus();
});

// Keep the "default" dropdowns in step with their lists
hf.on(paymentMethodsInput, 'input', () => fillDefaultSelect(defaultPaymentSelect, fromLines(paymentMethodsInput.value)));
hf.on(unitsInput, 'input', () => fillDefaultSelect(defaultUnitSelect, fromLines(unitsInput.value)));

hf.on(form, 'submit', async (event) => {
    event.preventDefault();
    hf.busy(saveBtn, true);
    try {
        const settings = readForm();
        await saveAppSettings(settings);
        fillForm(settings);   // tidy up (removes blank lines, duplicates)
        hf.message(message, 'Settings saved ✓ They apply next time a page is opened.');
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save: ${error.message}`, 'error', 0);
    } finally {
        hf.busy(saveBtn, false);
    }
});

hf.on(resetBtn, 'click', () => {
    if (!confirm('Put back the default settings? Nothing is saved until you press "Save settings".')) return;
    fillForm(structuredClone(DEFAULT_SETTINGS));
    hf.message(message, 'Defaults filled in. Press "Save settings" to keep them.');
});


// ---------- Start ----------
startPage({
    title: 'Settings',
    onReady: async () => {
        fillForm(await loadSettings());
    },
});
