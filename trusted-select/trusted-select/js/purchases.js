// ==============================
// purchases.js — stock coming in
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage, createRangeFilter } from "./layout.js";
import {
    addPurchase, getPurchases, deletePurchase, getProducts, updateProduct,
} from "./firebase.js";


// ---------- Elements ----------
const purchaseForm = hf.q('#add-purchase-form');
const submitBtn = hf.q('.purchase-submit-btn');
const message = hf.q('#form-message');
const dateInput = hf.q('#purchase-date');
const productSelect = hf.q('#purchase-product');
const qtyInput = hf.q('#purchase-qty');
const costInput = hf.q('#purchase-cost');
const updateCostBox = hf.q('#update-cost');
const totalText = hf.q('.purchase-total');
const summary = hf.q('#purchase-summary');
const tableBody = hf.q('#purchase-table-body');

const COLUMNS = 8;
let products = [];
let range;   // date-range filter, set up on start


// ---------- Functions ----------
const findProduct = (id) => products.find((p) => p.id === id);

function fillProductSelect() {
    productSelect.replaceChildren();
    const first = new Option(products.length ? 'Choose product' : 'Add a product first', '', true, true);
    first.disabled = true;
    productSelect.add(first);
    products.forEach((p) => {
        productSelect.add(new Option(`${p.name} (${p.itemCode}) · stock ${p.currentStock}`, p.id));
    });
}

function updateTotal() {
    const total = hf.num(qtyInput.value) * hf.num(costInput.value);
    totalText.textContent = total ? `Total: ${hf.money(total)}` : '';
}

function readPurchaseForm() {
    const data = hf.formData(purchaseForm);
    const product = findProduct(data.productId);
    if (!product) throw new Error('Choose a product.');

    return {
        date: data.date,
        productId: product.id,
        itemCode: product.itemCode,
        itemName: product.name,
        qty: hf.num(data.qty),
        unitCost: hf.num(data.unitCost),
        supplier: data.supplier.trim(),
        note: data.note.trim(),
    };
}

function resetForm() {
    purchaseForm.reset();
    dateInput.value = hf.today();
    fillProductSelect();
    updateTotal();
}

async function removePurchase(purchase) {
    const ok = confirm(
        `Delete this purchase of ${purchase.qty} × ${purchase.itemName}?\n\nIts quantity will be taken back out of stock.`,
    );
    if (!ok) return;
    try {
        await deletePurchase(purchase);
        hf.message(message, 'Purchase deleted and stock updated.');
        products = await getProducts();
        fillProductSelect();
        await loadPurchases();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not delete: ${error.message}`, 'error', 0);
    }
}

function createPurchaseRow(p) {
    const productCell = hf.create('td', { className: 'wrap' });
    productCell.append(hf.create('strong', { text: p.itemName }));
    if (p.itemCode) productCell.append(hf.create('span', { className: 'sub code', text: p.itemCode }));

    const actions = hf.create('td', { className: 'actions' });
    actions.append(hf.rowButton('Delete', 'danger', () => removePurchase(p)));

    const row = hf.create('tr');
    row.append(
        hf.create('td', { text: hf.date(p.date) }),
        productCell,
        hf.create('td', { className: 'num', text: String(p.qty) }),
        hf.create('td', { className: 'num', text: hf.money(p.unitCost) }),
        hf.create('td', { className: 'num', text: hf.money(p.qty * p.unitCost) }),
        hf.create('td', { text: p.supplier || '—' }),
        hf.create('td', { className: 'wrap', text: p.note || '' }),
        actions,
    );
    return row;
}

async function loadPurchases() {
    hf.tableMessage(tableBody, 'Loading...', COLUMNS);
    summary.replaceChildren();
    try {
        const purchases = await getPurchases(range.from, range.to);

        const totalQty = purchases.reduce((s, p) => s + p.qty, 0);
        const totalCost = purchases.reduce((s, p) => s + p.qty * p.unitCost, 0);
        summary.append(
            hf.create('span', { text: range.label }),
            hf.create('span', { text: `${purchases.length} purchases` }),
            hf.create('span', { text: `${totalQty} units` }),
        );
        const spent = hf.create('span', { text: 'Total: ' });
        spent.append(hf.create('strong', { text: hf.money(totalCost) }));
        summary.append(spent);

        if (purchases.length === 0) {
            hf.tableMessage(tableBody, 'No purchases in this period.', COLUMNS);
            return;
        }
        hf.clear(tableBody);
        purchases.forEach((p) => tableBody.append(createPurchaseRow(p)));
    } catch (error) {
        console.error(error);
        hf.tableMessage(tableBody, `Could not load purchases: ${error.message}`, COLUMNS);
    }
}


// ---------- Events ----------
hf.on(productSelect, 'change', () => {
    const product = findProduct(productSelect.value);
    if (product) costInput.value = product.costPrice ?? '';
    updateTotal();
});
hf.on(qtyInput, 'input', updateTotal);
hf.on(costInput, 'input', updateTotal);

hf.on(purchaseForm, 'submit', async (event) => {
    event.preventDefault();

    hf.busy(submitBtn, true);
    try {
        const purchase = readPurchaseForm();
        await addPurchase(purchase);                     // saves + raises stock
        if (updateCostBox.checked) {
            await updateProduct(purchase.productId, { costPrice: purchase.unitCost });
        }
        hf.message(message, `${purchase.qty} × ${purchase.itemName} added to stock ✓`);

        products = await getProducts();                  // refresh stock numbers
        resetForm();
        await loadPurchases();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save: ${error.message}`, 'error', 0);
    } finally {
        hf.busy(submitBtn, false);
    }
});


// ---------- Start ----------
dateInput.value = hf.today();
range = createRangeFilter(hf.q('#purchase-range'), loadPurchases);

startPage({
    title: 'Purchases',
    onReady: async () => {
        try {
            products = await getProducts();
        } catch (error) {
            console.error(error);
            hf.message(message, `Could not load products: ${error.message}`, 'error', 0);
        }
        resetForm();
        loadPurchases();
    },
});
