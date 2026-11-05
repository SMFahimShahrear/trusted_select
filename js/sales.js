// ==============================
// sales.js
// ==============================

// ---------- Imports ----------
import settings from "../settings.json" with { type: "json" };
import { hf } from "./utils.js";
import { startPage, createRangeFilter } from "./layout.js";
import { addSale, getSales, deleteSale, getProducts, nextTrackNumber } from "./firebase.js";


// ---------- Elements ----------
const saleForm = hf.q('#add-sale-form');
const submitBtn = hf.q('.add-sale-btn');
const message = hf.q('#form-message');
const dateInput = hf.q('#sale-date');
const discountInput = hf.q('#discount');
const paymentSelect = hf.q('#payment');
const itemsBody = hf.q('#sale-items-body');
const addItemBtn = hf.q('.add-item-btn');
const subtotalText = hf.q('.items-subtotal');
const totalEl = hf.q('#sale-total');
const searchInput = hf.q('#sales-search');
const summary = hf.q('#sales-summary');
const tableBody = hf.q('#sales-table-body');

const COLUMNS = 8;
let products = [];   // filled from Firestore when the page loads
let sales = [];      // sales in the chosen period
let range;


// ---------- Functions ----------
const findProduct = (id) => products.find((p) => p.id === id);

// One row in the "Items" table: product dropdown, qty, price, line total, remove button
function createItemRow() {
    const row = hf.create('tr', { className: 'item-row' });

    const select = hf.create('select', {
        className: 'item-product', attrs: { required: '', 'aria-label': 'Product' },
    });
    const first = new Option(products.length ? 'Choose product' : 'Add a product first', '', true, true);
    first.disabled = true;
    select.add(first);
    products.forEach((p) => {
        const option = new Option(`${p.name} (${p.itemCode}) · stock ${p.currentStock}`, p.id);
        if ((p.currentStock || 0) <= 0) option.disabled = true;   // can't sell what you don't have
        select.add(option);
    });

    const qty = hf.create('input', {
        className: 'item-qty',
        attrs: { type: 'number', min: '1', step: '1', value: '1', required: '', 'aria-label': 'Quantity' },
    });
    const price = hf.create('input', {
        className: 'item-price',
        attrs: { type: 'number', min: '0', step: '0.01', required: '', 'aria-label': 'Unit price' },
    });
    const lineTotal = hf.create('span', { className: 'item-line-total', text: hf.money(0) });
    const removeBtn = hf.create('button', {
        className: 'btn btn-ghost btn-sm btn-icon', text: '✕',
        attrs: { type: 'button', title: 'Remove item', 'aria-label': 'Remove item' },
    });

    // Picking a product fills in its selling price (you can still change it)
    hf.on(select, 'change', () => {
        const product = findProduct(select.value);
        if (product) price.value = product.sellingPrice;
        updateTotals();
    });
    hf.on(qty, 'input', updateTotals);
    hf.on(price, 'input', updateTotals);
    hf.on(removeBtn, 'click', () => {
        if (hf.qa('.item-row', itemsBody).length > 1) {   // always keep at least one row
            row.remove();
            updateTotals();
        }
    });

    const cells = [select, qty, price, lineTotal, removeBtn].map((el) => {
        const td = hf.create('td');
        td.append(el);
        return td;
    });
    row.append(...cells);
    itemsBody.append(row);
}

// Recalculate each line total and the grand total
function updateTotals() {
    let gross = 0;
    hf.qa('.item-row', itemsBody).forEach((row) => {
        const line = hf.num(hf.q('.item-qty', row).value) * hf.num(hf.q('.item-price', row).value);
        hf.q('.item-line-total', row).textContent = hf.money(line);
        gross += line;
    });
    const discount = hf.num(discountInput.value);
    subtotalText.textContent = discount ? `Subtotal ${hf.money(gross)} − discount ${hf.money(discount)}` : '';
    totalEl.textContent = hf.money(gross - discount);
}

// Collect everything from the form into one sale object (throws if something's wrong)
function readSaleForm() {
    const data = hf.formData(saleForm);
    const qtyByProduct = {};

    const items = hf.qa('.item-row', itemsBody).map((row) => {
        const product = findProduct(hf.q('.item-product', row).value);
        if (!product) throw new Error('Choose a product for every item row.');

        const qty = hf.num(hf.q('.item-qty', row).value);
        if (qty <= 0) throw new Error(`Quantity for "${product.name}" must be at least 1.`);
        qtyByProduct[product.id] = (qtyByProduct[product.id] || 0) + qty;

        return {
            productId: product.id,
            itemCode: product.itemCode,
            itemName: product.name,
            qty,
            unitPrice: hf.num(hf.q('.item-price', row).value),
            unitCost: product.costPrice || 0,     // saved so old profit stays correct
        };
    });

    // Same product in two rows? Check the combined qty against stock.
    for (const [id, qty] of Object.entries(qtyByProduct)) {
        const product = findProduct(id);
        if (qty > (product.currentStock || 0)) {
            throw new Error(`Only ${product.currentStock} of "${product.name}" in stock.`);
        }
    }

    const gross = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const discount = hf.num(data.discount);
    if (discount > gross) throw new Error('Discount is more than the sale total.');

    return {
        date: data.date,
        memoNo: data.memoNo.trim(),
        customerName: data.customerName.trim(),
        customerPhone: data.customerPhone.trim(),
        customerAddress: data.customerAddress.trim(),
        payment: data.payment,
        discount,
        items,
    };
}

// Next memo number if the box was left blank
async function setMemoNo(memoNo) {
    if (memoNo) return memoNo;
    const n = await nextTrackNumber('SaleCount', settings.sales?.memoStartNumber ?? 1001);
    return String(n);
}

function resetSaleForm() {
    saleForm.reset();
    dateInput.value = hf.today();
    hf.clear(itemsBody);
    createItemRow();
    updateTotals();
}

async function removeSale(sale) {
    const ok = confirm(
        `Delete memo ${sale.memoNo || ''} for ${sale.customerName}?\n\nIts items will be put back into stock.`,
    );
    if (!ok) return;
    try {
        await deleteSale(sale);
        hf.message(message, 'Sale deleted and stock restored.');
        products = await getProducts();
        resetSaleForm();
        await loadSales();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not delete: ${error.message}`, 'error', 0);
    }
}

// Build one <tr> for one sale
function createSaleRow(sale) {
    const customerCell = hf.create('td', { className: 'wrap' });
    customerCell.append(hf.create('strong', { text: sale.customerName || '—' }));
    const contact = [sale.customerPhone, sale.customerAddress].filter(Boolean).join(' · ');
    if (contact) customerCell.append(hf.create('span', { className: 'sub', text: contact }));

    const itemsText = (sale.items || []).map((i) => `${i.itemName} × ${i.qty}`).join(', ');

    const profitCell = hf.create('td', {
        className: `num ${sale.profit < 0 ? 'negative' : ''}`, text: hf.money(sale.profit),
    });

    const paymentCell = hf.create('td');
    if (sale.payment) paymentCell.append(hf.create('span', { className: 'badge badge-neutral', text: sale.payment }));

    const actions = hf.create('td', { className: 'actions' });
    actions.append(hf.rowButton('Delete', 'danger', () => removeSale(sale)));

    const row = hf.create('tr');
    row.append(
        hf.create('td', { text: hf.date(sale.date) }),
        hf.create('td', { className: 'code', text: sale.memoNo || '—' }),
        customerCell,
        hf.create('td', { className: 'wrap', text: itemsText }),
        paymentCell,
        hf.create('td', { className: 'num', text: hf.money(sale.netSale) }),
        profitCell,
        actions,
    );
    return row;
}

function renderSummary(list) {
    const total = list.reduce((s, x) => s + (x.netSale || 0), 0);
    const profit = list.reduce((s, x) => s + (x.profit || 0), 0);
    summary.replaceChildren();
    summary.append(
        hf.create('span', { text: range.label }),
        hf.create('span', { text: `${list.length} sales` }),
    );
    const t = hf.create('span', { text: 'Sales: ' });
    t.append(hf.create('strong', { text: hf.money(total) }));
    const p = hf.create('span', { text: 'Profit: ' });
    p.append(hf.create('strong', { text: hf.money(profit) }));
    summary.append(t, p);
}

function renderTable() {
    const term = searchInput.value.trim().toLowerCase();
    const shown = sales.filter((s) => {
        if (!term) return true;
        const text = `${s.customerName} ${s.customerPhone} ${s.memoNo} ${(s.items || []).map((i) => i.itemName).join(' ')}`;
        return text.toLowerCase().includes(term);
    });

    renderSummary(shown);
    if (shown.length === 0) {
        hf.tableMessage(tableBody, sales.length ? 'No sales match your search.' : 'No sales in this period.', COLUMNS);
        return;
    }
    hf.clear(tableBody);
    shown.forEach((sale) => tableBody.append(createSaleRow(sale)));
}

async function loadSales() {
    hf.tableMessage(tableBody, 'Loading...', COLUMNS);
    try {
        sales = await getSales(range.from, range.to);
        renderTable();
    } catch (error) {
        console.error(error);
        hf.tableMessage(tableBody, `Could not load sales: ${error.message}`, COLUMNS);
    }
}


// ---------- Events ----------
hf.on(addItemBtn, 'click', () => createItemRow());
hf.on(discountInput, 'input', updateTotals);
hf.on(searchInput, 'input', hf.debounce(renderTable, 200));

hf.on(saleForm, 'submit', async (event) => {
    event.preventDefault();

    hf.busy(submitBtn, true);
    try {
        const sale = readSaleForm();                  // throws if something's wrong
        sale.memoNo = await setMemoNo(sale.memoNo);
        await addSale(sale);                          // saves + lowers stock
        hf.message(message, `Memo ${sale.memoNo} for ${sale.customerName} saved ✓`);

        products = await getProducts();               // refresh stock numbers
        resetSaleForm();
        await loadSales();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save: ${error.message}`, 'error', 0);
    } finally {
        hf.busy(submitBtn, false);
    }
});


// ---------- Start ----------
hf.fillSelect(paymentSelect, settings.sales?.paymentMethods ?? ['Cash', 'bKash', 'Nagad', 'Bank']);
dateInput.value = hf.today();
range = createRangeFilter(hf.q('#sales-range'), loadSales);

startPage({
    title: 'Sales',
    onReady: async () => {
        try {
            products = await getProducts();
        } catch (error) {
            console.error(error);
            hf.message(message, `Could not load products: ${error.message}`, 'error', 0);
        }
        resetSaleForm();
        loadSales();
    },
});
