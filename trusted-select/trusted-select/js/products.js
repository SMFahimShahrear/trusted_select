// ==============================
// products.js
// ==============================

// ---------- Imports ----------
import settings from "../settings.json" with { type: "json" };
import { hf } from "./utils.js";
import { startPage } from "./layout.js";
import {
    addProduct, getProducts, updateProduct, deleteProduct, stockStatus, nextTrackNumber,
} from "./firebase.js";


// ---------- Elements ----------
const productForm = hf.q('#add-product-form');
const formTitle = hf.q('#product-form-title');
const submitBtn = hf.q('.product-submit-btn');
const cancelEditBtn = hf.q('.cancel-edit-btn');
const deleteBtn = hf.q('.delete-product-btn');
const message = hf.q('#form-message');
const categorySelect = hf.q('#category');
const unitSelect = hf.q('#unit');
const openingStockInput = hf.q('#opening-stock');
const openingStockHint = hf.q('.opening-stock-hint');
const lowStockInput = hf.q('#low-stock-alert');
const searchInput = hf.q('#product-search');
const statusFilter = hf.q('#status-filter');
const summary = hf.q('#product-summary');
const tableBody = hf.q('#product-table-body');

const COLUMNS = 10;
let products = [];        // all products from Firestore
let editingId = null;     // id of the product being edited, or null when adding


// ---------- Functions ----------
function readProductForm() {
    const data = hf.formData(productForm);
    return {
        itemCode: data.itemCode.trim(),
        name: data.name.trim(),
        category: data.category,
        unit: data.unit,
        costPrice: hf.num(data.costPrice),
        sellingPrice: hf.num(data.sellingPrice),
        openingStock: hf.num(data.openingStock),
        lowStockAlert: hf.num(data.lowStockAlert),
    };
}

// Create an item code like TS-260001 if the box was left empty
async function setItemCode(itemcode) {
    if (itemcode) return itemcode;

    const count = await nextTrackNumber('ProductCount', 1);
    const prefix = settings.products?.codePrefix || 'TS-';
    const code = prefix + (new Date().getFullYear() % 100).toString() + count.toString().padStart(4, '0');
    if (!code) throw new Error('Item code could not be created.');
    return code;
}

// Stop two products having the same code
function checkCodeIsFree(code) {
    const clash = products.find(
        (p) => p.id !== editingId && (p.itemCode || '').toLowerCase() === code.toLowerCase(),
    );
    if (clash) throw new Error(`Code ${code} is already used by "${clash.name}".`);
}

function fillDropdowns() {
    hf.fillSelect(categorySelect, settings.products?.categories || ['Other'], 'Choose category');
    hf.fillSelect(unitSelect, settings.products?.units || ['pcs']);
}

// Back to "Add product" mode with an empty form
function resetForm() {
    editingId = null;
    productForm.reset();
    fillDropdowns();
    unitSelect.value = settings.products?.defaultUnit || 'pcs';
    lowStockInput.value = settings.products?.defaultLowStockAlert ?? 5;
    openingStockInput.disabled = false;
    hf.hide(openingStockHint);
    hf.hide(cancelEditBtn);
    hf.hide(deleteBtn);
    formTitle.textContent = 'Add product';
    submitBtn.textContent = 'Add product';
}

// Fill the form with a product so it can be edited
function startEdit(product) {
    editingId = product.id;

    // Keep old values selectable even if they're no longer in settings.json
    for (const [select, value] of [[categorySelect, product.category], [unitSelect, product.unit]]) {
        if (value && ![...select.options].some((o) => o.value === value)) select.add(new Option(value, value));
    }

    hf.q('#item-code').value = product.itemCode || '';
    hf.q('#item-name').value = product.name || '';
    categorySelect.value = product.category || '';
    unitSelect.value = product.unit || '';
    hf.q('#cost-price').value = product.costPrice ?? '';
    hf.q('#selling-price').value = product.sellingPrice ?? '';
    openingStockInput.value = product.openingStock ?? 0;
    lowStockInput.value = product.lowStockAlert ?? 0;

    openingStockInput.disabled = true;   // stock only changes through purchases & sales
    hf.show(openingStockHint);
    hf.show(cancelEditBtn);
    hf.show(deleteBtn);
    formTitle.textContent = `Edit: ${product.name}`;
    submitBtn.textContent = 'Save changes';
    productForm.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    hf.q('#item-name').focus({ preventScroll: true });
}

async function removeProduct(product) {
    const ok = confirm(
        `Delete "${product.name}"?\n\nPast sales and purchases stay saved, but this product will disappear from lists.`,
    );
    if (!ok) return;
    try {
        await deleteProduct(product.id);
        if (editingId === product.id) resetForm();
        hf.message(message, `${product.name} deleted.`);
        await loadProducts();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not delete: ${error.message}`, 'error', 0);
    }
}

// Build one <tr> for one product
function createProductRow(product) {
    const status = stockStatus(product);
    const stockValue = Math.max(product.currentStock || 0, 0) * (product.costPrice || 0);
    const margin = product.sellingPrice ? (product.sellingPrice - product.costPrice) / product.sellingPrice : 0;
    const statusClass = 'status-' + status.toLowerCase().replaceAll(' ', '-');

    const nameCell = hf.create('td', { className: 'wrap' });
    nameCell.append(hf.create('strong', { text: product.name }));
    if (product.unit) nameCell.append(hf.create('span', { className: 'sub', text: `per ${product.unit}` }));

    const statusCell = hf.create('td');
    statusCell.append(hf.create('span', { className: `badge ${statusClass}`, text: status }));

    const actions = hf.create('td', { className: 'actions' });
    actions.append(hf.rowButton('Edit', 'ghost', () => startEdit(product)));

    const row = hf.create('tr');
    row.append(
        hf.create('td', { className: 'code', text: product.itemCode || '—' }),
        nameCell,
        hf.create('td', { text: product.category || '—' }),
        hf.create('td', { className: 'num', text: hf.money(product.costPrice) }),
        hf.create('td', { className: 'num', text: hf.money(product.sellingPrice) }),
        hf.create('td', { className: 'num', text: hf.percent(margin) }),
        hf.create('td', { className: 'num', text: String(product.currentStock ?? 0) }),
        hf.create('td', { className: 'num', text: hf.money(stockValue) }),
        statusCell,
        actions,
    );
    return row;
}

function renderSummary() {
    const stockValue = products.reduce(
        (sum, p) => sum + Math.max(p.currentStock || 0, 0) * (p.costPrice || 0), 0,
    );
    const low = products.filter((p) => stockStatus(p) === 'LOW STOCK').length;
    const out = products.filter((p) => stockStatus(p) === 'OUT OF STOCK').length;

    summary.replaceChildren();
    const item = (label, value) => {
        const span = hf.create('span', { text: `${label}: ` });
        span.append(hf.create('strong', { text: value }));
        return span;
    };
    summary.append(
        item('Products', String(products.length)),
        item('Stock value', hf.money(stockValue)),
        item('Low stock', String(low)),
        item('Out of stock', String(out)),
    );
}

// Draw the table using the search box and status filter
function renderTable() {
    const term = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;

    const shown = products.filter((p) => {
        const text = `${p.name} ${p.itemCode} ${p.category}`.toLowerCase();
        return (!term || text.includes(term)) && (!status || stockStatus(p) === status);
    });

    if (products.length === 0) {
        hf.tableMessage(tableBody, 'No products yet. Add your first one above.', COLUMNS);
        return;
    }
    if (shown.length === 0) {
        hf.tableMessage(tableBody, 'No products match your search.', COLUMNS);
        return;
    }
    hf.clear(tableBody);
    shown.forEach((p) => tableBody.append(createProductRow(p)));
}

async function loadProducts() {
    hf.tableMessage(tableBody, 'Loading...', COLUMNS);
    try {
        products = await getProducts();
        renderSummary();
        renderTable();
    } catch (error) {
        console.error(error);
        hf.tableMessage(tableBody, `Could not load products: ${error.message}`, COLUMNS);
    }
}


// ---------- Events ----------
hf.on(productForm, 'submit', async (event) => {
    event.preventDefault();
    const product = readProductForm();

    hf.busy(submitBtn, true);
    try {
        if (editingId) {
            if (!product.itemCode) throw new Error('Item code cannot be empty when editing.');
            checkCodeIsFree(product.itemCode);
            const { openingStock, ...changes } = product;   // opening stock isn't changed on edit
            await updateProduct(editingId, changes);
            hf.message(message, `${product.name} updated ✓`);
        } else {
            if (product.itemCode) checkCodeIsFree(product.itemCode);
            product.itemCode = await setItemCode(product.itemCode);   // wait for the code first
            if (!product.itemCode) throw new Error('No item code.');
            await addProduct(product);
            hf.message(message, `${product.name} added ✓ (${product.itemCode})`);
        }
        hf.busy(submitBtn, false);
        resetForm();
        await loadProducts();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save: ${error.message}`, 'error', 0);
        hf.busy(submitBtn, false);
    }
});

hf.on(cancelEditBtn, 'click', resetForm);
hf.on(deleteBtn, 'click', () => {
    const product = products.find((p) => p.id === editingId);
    if (product) removeProduct(product);
});
hf.on(searchInput, 'input', hf.debounce(renderTable, 200));
hf.on(statusFilter, 'change', renderTable);


// ---------- Start ----------
resetForm();
startPage({ title: 'Products', onReady: loadProducts });
