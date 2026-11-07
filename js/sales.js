// ==============================
// sales.js — add, edit and track orders
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage, createRangeFilter } from "./layout.js";
import { loadSettings, DEFAULT_SETTINGS } from "./app-settings.js";
import {
    STATUSES, statusOf, statusLabel, isActive, isActiveStatus, fillStatusSelect,
    profitOf, totalDueOf, courierOwesOf, deliveryNetOf, toShip,
} from "./orders.js";
import {
    addSale, updateSale, getSales, deleteSale, getProducts, getCustomer, nextTrackNumber,
    getAllSales, hasValidDate, repairSaleDates,
} from "./firebase.js";
import { openSummary, openOtp } from "./documents.js";


// ---------- Elements ----------
const saleCard = hf.q('.sale-card');
const formTitle = hf.q('#sale-form-title');
const cancelEditBtn = hf.q('.cancel-edit-btn');
const deleteSaleBtn = hf.q('.delete-sale-btn');
const saleForm = hf.q('#add-sale-form');
const submitBtn = hf.q('.add-sale-btn');
const message = hf.q('#form-message');
const dateInput = hf.q('#sale-date');
const invoiceInput = hf.q('#invoice-no');
const orderInput = hf.q('#order-no');
const statusSelect = hf.q('#sale-status');

const phoneInput = hf.q('#customer-phone');
const nameInput = hf.q('#customer-name');
const emailInput = hf.q('#customer-email');
const addressInput = hf.q('#customer-address');
const customerFound = hf.q('.customer-found');

const itemsBody = hf.q('#sale-items-body');
const addItemBtn = hf.q('.add-item-btn');

const zoneSelect = hf.q('#delivery-zone');
const deliveryInput = hf.q('#delivery-charge');
const deliveryHint = hf.q('.delivery-hint');
const feeInput = hf.q('#courier-fee');
const feeHint = hf.q('.courier-hint');
const discountInput = hf.q('#discount');
const paymentSelect = hf.q('#payment');
const advanceInput = hf.q('#advance-paid');
const trxInput = hf.q('#trx-id');
const notesInput = hf.q('#sale-notes');
const afterSave = hf.q('.after-save');
const selectAll = hf.q('#select-all');
const selectionBar = hf.q('#selection-bar');
const selectionCount = hf.q('#selection-count');

const bill = {
    subtotal: hf.q('#bill-subtotal'), discount: hf.q('#bill-discount'), delivery: hf.q('#bill-delivery'),
    total: hf.q('#sale-total'), advance: hf.q('#bill-advance'), cod: hf.q('#bill-cod'),
    fee: hf.q('#bill-fee'), payout: hf.q('#bill-payout'), profit: hf.q('#bill-profit'),
};

const statusFilter = hf.q('#status-filter');
const searchInput = hf.q('#sales-search');
const summary = hf.q('#sales-summary');
const notice = hf.q('#sales-notice');
const tableBody = hf.q('#sales-table-body');

const COLUMNS = 9;
let settings = DEFAULT_SETTINGS;   // replaced with saved settings when the page loads
let products = [];                 // from Firestore
let sales = [];                    // sales in the chosen period
let range;
let editing = null;                // the sale being edited, or null when adding a new one
let deliveryByHand = false;        // true once someone types their own delivery charge
let feeByHand = false;             // true once someone types their own courier fee
let checkedForBrokenSales = false;
let customerWarning = '';          // set when the phone number is blacklisted
const selected = new Set();        // ids of orders ticked in the list


// ---------- Products & stock ----------
// Products for the dropdowns. When editing, products that were deleted since still appear.
function productList() {
    const list = [...products];
    for (const i of editing?.items || []) {
        if (!list.some((p) => p.id === i.productId)) {
            list.push({
                id: i.productId, name: `${i.itemName} (deleted)`, itemCode: i.itemCode,
                costPrice: i.unitCost, sellingPrice: i.unitPrice, currentStock: 0, deleted: true,
            });
        }
    }
    return list;
}
const findProduct = (id) => productList().find((p) => p.id === id);

// How many can be sold. When editing, this sale's own items count as available.
function available(productId) {
    const p = findProduct(productId);
    let qty = p ? (p.currentStock || 0) : 0;
    if (editing && isActive(editing)) {
        for (const i of editing.items || []) if (i.productId === productId) qty += Number(i.qty);
    }
    return qty;
}

const findZone = (name) => settings.sales.deliveryZones.find((z) => z.name === name);


// ---------- Item rows ----------
function createItemRow(item = null) {
    const row = hf.create('tr', { className: 'item-row' });

    const select = hf.create('select', {
        className: 'item-product', attrs: { required: '', 'aria-label': 'Product' },
    });
    const first = new Option(products.length ? 'Choose product' : 'Add a product first', '', true, true);
    first.disabled = true;
    select.add(first);
    for (const p of productList()) {
        const option = new Option(`${p.name} (${p.itemCode || 'no code'}) · stock ${available(p.id)}`, p.id);
        if (available(p.id) <= 0 && p.id !== item?.productId) option.disabled = true;
        select.add(option);
    }

    const qty = hf.create('input', {
        className: 'item-qty',
        attrs: { type: 'number', min: '1', step: '1', value: '1', required: '', 'aria-label': 'Quantity' },
    });
    const price = hf.create('input', {
        className: 'item-price',
        attrs: { type: 'number', min: '0', step: '0.01', required: '', placeholder: 'Price', 'aria-label': 'Unit price' },
    });
    if (item) {
        select.value = item.productId;
        qty.value = item.qty;
        price.value = item.unitPrice;
    }

    const lineTotal = hf.create('span', { className: 'item-line-total', text: hf.money(0) });
    const removeBtn = hf.create('button', {
        className: 'btn btn-ghost btn-sm btn-icon', text: '✕',
        attrs: { type: 'button', title: 'Remove item', 'aria-label': 'Remove item' },
    });

    hf.on(select, 'change', () => {
        const product = findProduct(select.value);
        if (product) price.value = product.sellingPrice;
        updateTotals();
    });
    hf.on(qty, 'input', updateTotals);
    hf.on(price, 'input', updateTotals);
    hf.on(removeBtn, 'click', () => {
        if (hf.qa('.item-row', itemsBody).length > 1) {
            row.remove();
            updateTotals();
        }
    });

    row.append(...[select, qty, price, lineTotal, removeBtn].map((el) => {
        const td = hf.create('td');
        td.append(el);
        return td;
    }));
    itemsBody.append(row);
}


// ---------- Bill ----------
function readItems() {
    return hf.qa('.item-row', itemsBody).map((row) => ({
        row,
        productId: hf.q('.item-product', row).value,
        qty: hf.num(hf.q('.item-qty', row).value),
        unitPrice: hf.num(hf.q('.item-price', row).value),
    }));
}

function updateTotals() {
    const items = readItems();
    let gross = 0;
    let cost = 0;
    for (const i of items) {
        const line = i.qty * i.unitPrice;
        hf.q('.item-line-total', i.row).textContent = hf.money(line);
        gross += line;
        cost += i.qty * hf.num(findProduct(i.productId)?.costPrice);
    }
    const discount = hf.num(discountInput.value);
    const netSale = gross - discount;
    const advance = hf.num(advanceInput.value);
    const zone = findZone(zoneSelect.value);

    // Delivery charge (customer pays)
    if (!deliveryByHand) {
        const freeOver = hf.num(settings.sales.freeDeliveryOver);
        if (freeOver > 0 && netSale >= freeOver) {
            deliveryInput.value = 0;
            deliveryHint.textContent = `Free delivery (sale is ${hf.money(freeOver)} or more)`;
        } else {
            deliveryInput.value = zone ? zone.charge : 0;
            deliveryHint.textContent = zone ? `${zone.name} rate` : 'Customer pays';
        }
    } else {
        deliveryHint.textContent = 'Typed by hand · pick the area again to reset';
    }
    const delivery = hf.num(deliveryInput.value);
    const totalDue = netSale + delivery;
    const cod = Math.max(totalDue - advance, 0);

    // Courier fee (courier keeps)
    if (!feeByHand) {
        const pct = hf.num(settings.sales.codChargePercent);
        const codCharge = Math.round((cod * pct) / 100);
        feeInput.value = (zone ? zone.courierFee : 0) + codCharge;
        feeHint.textContent = pct ? `${zone?.name || ''} fee + ${pct}% COD (${hf.money(codCharge)})` : `${zone?.name || 'Courier'} fee`;
    } else {
        feeHint.textContent = 'Typed by hand · pick the area again to reset';
    }
    const fee = hf.num(feeInput.value);
    const profit = isActiveStatus(statusSelect.value) ? netSale - cost + delivery - fee : 0;

    bill.subtotal.textContent = hf.money(gross);
    bill.discount.textContent = discount ? `− ${hf.money(discount)}` : hf.money(0);
    bill.delivery.textContent = hf.money(delivery);
    bill.total.textContent = hf.money(totalDue);
    bill.advance.textContent = advance ? `− ${hf.money(advance)}` : hf.money(0);
    bill.cod.textContent = hf.money(cod);
    bill.fee.textContent = fee ? `− ${hf.money(fee)}` : hf.money(0);
    bill.payout.textContent = hf.money(cod - fee);
    bill.profit.textContent = hf.money(profit);
    bill.profit.className = profit < 0 ? 'negative' : '';
}


// ---------- Reading the form ----------
function readSaleForm() {
    const data = hf.formData(saleForm);
    const phone = hf.phone(data.customerPhone);
    if (!hf.isPhone(phone)) throw new Error('Enter a valid 11-digit phone number (01XXXXXXXXX).');

    const status = data.status || 'pending';
    const qtyByProduct = {};
    const items = readItems().map((i) => {
        const product = findProduct(i.productId);
        if (!product) throw new Error('Choose a product for every item row.');
        if (i.qty <= 0) throw new Error(`Quantity for "${product.name}" must be at least 1.`);
        qtyByProduct[product.id] = (qtyByProduct[product.id] || 0) + i.qty;

        // Keep the original cost when editing, so old profit stays the same
        const oldItem = editing?.items?.find((x) => x.productId === product.id);
        return {
            productId: product.id,
            itemCode: product.itemCode || '',
            itemName: oldItem && product.deleted ? oldItem.itemName : (product.name || ''),
            qty: i.qty,
            unitPrice: i.unitPrice,
            unitCost: oldItem ? hf.num(oldItem.unitCost) : hf.num(product.costPrice),
        };
    });

    if (isActiveStatus(status)) {
        for (const [id, qty] of Object.entries(qtyByProduct)) {
            if (qty > available(id)) {
                throw new Error(`Only ${available(id)} of "${findProduct(id).name}" in stock.`);
            }
        }
    }

    const gross = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const discount = hf.num(data.discount);
    if (discount > gross) throw new Error('Discount is more than the items total.');

    return {
        date: data.date,
        status,
        invoiceNo: (data.invoiceNo || '').trim(),
        orderNo: (data.orderNo || '').trim(),
        customerName: (data.customerName || '').trim(),
        customerPhone: phone,
        customerEmail: (data.customerEmail || '').trim(),
        customerAddress: (data.customerAddress || '').trim(),
        deliveryZone: data.deliveryZone || '',
        deliveryCharge: hf.num(data.deliveryCharge),
        courierFee: hf.num(data.courierFee),
        advancePaid: hf.num(data.advancePaid),
        trxId: (data.trxId || '').trim(),
        notes: (data.notes || '').trim(),
        payment: data.payment || '',
        discount,
        items,
    };
}

// ----- Automatic numbers -----
// The sale date "2026-10-18" → yy "26", yymmdd "261018"
const yyOf = (dateStr) => dateStr.slice(2, 4);
const yymmddOf = (dateStr) => dateStr.slice(2, 4) + dateStr.slice(5, 7) + dateStr.slice(8, 10);
const orderPrefixOf = (zoneName) => findZone(zoneName)?.orderPrefix ?? '';

// Invoice: prefix + yy + 00001 (counter restarts each year), e.g. 2600001
async function setInvoiceNo(invoiceNo, dateStr) {
    if (invoiceNo) return invoiceNo;
    if (editing && (editing.invoiceNo || editing.memoNo)) return editing.invoiceNo || editing.memoNo;
    const yy = yyOf(dateStr);
    const n = await nextTrackNumber(`InvoiceCount_${yy}`, 1);
    return `${settings.sales.invoicePrefix || ''}${yy}${String(n).padStart(5, '0')}`;
}

// Order: area prefix + yymmdd + 00001 (counter restarts each day), e.g. OD26101800001
async function setOrderNo(orderNo, dateStr, zoneName) {
    if (orderNo) return orderNo;
    if (editing?.orderNo) return editing.orderNo;
    const ymd = yymmddOf(dateStr);
    const n = await nextTrackNumber(`OrderCount_${ymd}`, 1);
    return `${orderPrefixOf(zoneName)}${ymd}${String(n).padStart(5, '0')}`;
}

// Show what the numbers will look like in the empty boxes
function updateNumberHints() {
    const dateStr = dateInput.value || hf.today();
    if (!editing) {
        invoiceInput.placeholder = `Auto: ${settings.sales.invoicePrefix || ''}${yyOf(dateStr)}#####`;
        orderInput.placeholder = `Auto: ${orderPrefixOf(zoneSelect.value)}${yymmddOf(dateStr)}#####`;
    } else {
        invoiceInput.placeholder = 'Blank = keep / create';
        orderInput.placeholder = 'Blank = keep / create';
    }
}


// ---------- Returning customer lookup ----------
let lookupToken = 0;
async function lookUpCustomer() {
    const phone = hf.phone(phoneInput.value);
    const token = ++lookupToken;
    customerWarning = '';
    if (!hf.isPhone(phone)) {
        hf.hide(customerFound);
        return;
    }
    try {
        const customer = await getCustomer(phone);
        if (token !== lookupToken) return;
        if (customer?.blacklisted) {
            customerWarning = customer.blacklistReason ? `Reason: ${customer.blacklistReason}` : 'No reason given.';
            customerFound.className = 'form-field full customer-found is-blacklisted';
            customerFound.replaceChildren(
                hf.create('strong', { text: `⚠ Blacklisted customer${customer.name ? `: ${customer.name}` : ''}` }),
                hf.create('span', { text: ` · ${customerWarning} · ${customer.orderCount || 0} past orders · ` }),
                hf.create('a', { text: 'View history →', attrs: { href: `customers.html?phone=${phone}`, target: '_blank' } }),
            );
            hf.show(customerFound);
            if (!nameInput.value.trim()) nameInput.value = customer.name || '';
            if (!addressInput.value.trim()) addressInput.value = customer.address || '';
            return;
        }
        if (!customer) {
            customerFound.className = 'form-field full customer-found is-new';
            customerFound.textContent = 'New customer';
            hf.show(customerFound);
            return;
        }
        if (!nameInput.value.trim()) nameInput.value = customer.name || '';
        if (!addressInput.value.trim()) addressInput.value = customer.address || '';
        if (!emailInput.value.trim()) emailInput.value = customer.email || '';
        if (!editing && customer.deliveryZone && findZone(customer.deliveryZone)) {
            zoneSelect.value = customer.deliveryZone;
            deliveryByHand = false;
            feeByHand = false;
            updateTotals();
        }
        customerFound.className = 'form-field full customer-found';
        customerFound.replaceChildren(
            hf.create('strong', { text: `Returning customer: ${customer.name || phone}` }),
            hf.create('span', {
                text: ` · ${customer.orderCount || 0} orders · ${hf.money(customer.totalSpent)} spent · last order ${hf.date(customer.lastOrderDate)} · `,
            }),
            hf.create('a', { text: 'View history →', attrs: { href: `customers.html?phone=${phone}`, target: '_blank' } }),
        );
        hf.show(customerFound);
    } catch (error) {
        console.error(error);
    }
}


// ---------- Form modes ----------
function fillZones(extra) {
    const names = settings.sales.deliveryZones.map((z) => z.name);
    if (extra && !names.includes(extra)) names.push(extra);   // old area no longer in settings
    hf.fillSelect(zoneSelect, names);
}

function fillPayments(extra) {
    const list = [...settings.sales.paymentMethods];
    if (extra && !list.includes(extra)) list.push(extra);
    hf.fillSelect(paymentSelect, list);
}

// Back to "New sale"
function resetSaleForm() {
    editing = null;
    saleForm.reset();
    dateInput.value = hf.today();
    fillStatusSelect(statusSelect, { onlyActive: true });
    fillPayments();
    if (settings.sales.paymentMethods.includes(settings.sales.defaultPayment)) {
        paymentSelect.value = settings.sales.defaultPayment;
    }
    fillZones();
    if (findZone(settings.sales.defaultZone)) zoneSelect.value = settings.sales.defaultZone;
    deliveryByHand = false;
    feeByHand = false;
    hf.hide(customerFound);
    hf.hide(cancelEditBtn);
    hf.hide(deleteSaleBtn);
    formTitle.textContent = 'New sale';
    submitBtn.textContent = 'Save sale';
    customerWarning = '';
    updateNumberHints();
    hf.clear(itemsBody);
    createItemRow();
    updateTotals();
}

// Load a sale into the form to edit it
function startEdit(sale) {
    resetSaleForm();
    editing = sale;

    dateInput.value = hf.toInputDate(hf.toDate(sale.date));
    invoiceInput.value = sale.invoiceNo || sale.memoNo || '';
    orderInput.value = sale.orderNo || '';
    fillStatusSelect(statusSelect);
    statusSelect.value = statusOf(sale);
    phoneInput.value = sale.customerPhone || '';
    nameInput.value = sale.customerName || '';
    emailInput.value = sale.customerEmail || '';
    addressInput.value = sale.customerAddress || '';

    fillZones(sale.deliveryZone);
    if (sale.deliveryZone) zoneSelect.value = sale.deliveryZone;
    deliveryInput.value = sale.deliveryCharge || 0;
    feeInput.value = sale.courierFee || 0;
    deliveryByHand = true;      // keep the saved amounts until the area is changed
    feeByHand = true;
    discountInput.value = sale.discount || 0;
    fillPayments(sale.payment);
    paymentSelect.value = sale.payment || paymentSelect.value;
    advanceInput.value = sale.advancePaid || 0;
    trxInput.value = sale.trxId || '';
    notesInput.value = sale.notes || '';

    hf.clear(itemsBody);
    for (const item of sale.items || []) createItemRow(item);
    if (!(sale.items || []).length) createItemRow();

    formTitle.textContent = `Edit invoice ${sale.invoiceNo || sale.memoNo || ''}`;
    submitBtn.textContent = 'Save changes';
    hf.show(cancelEditBtn);
    hf.show(deleteSaleBtn);
    updateNumberHints();
    updateTotals();
    saleCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ---------- Changing status from the list ----------
async function changeStatus(sale, newStatus, select) {
    const oldStatus = statusOf(sale);
    if (newStatus === oldStatus) return;
    const goingInactive = isActiveStatus(oldStatus) && !isActiveStatus(newStatus);
    const comingBack = !isActiveStatus(oldStatus) && isActiveStatus(newStatus);

    if (goingInactive && !confirm(`Mark invoice ${sale.invoiceNo || sale.memoNo || ''} as ${statusLabel(newStatus)}?\n\nIts items go back into stock and it stops counting as a sale.`)) {
        select.value = oldStatus;
        return;
    }
    if (comingBack) {
        for (const i of sale.items || []) {
            const p = products.find((x) => x.id === i.productId);
            if (p && i.qty > (p.currentStock || 0)) {
                hf.message(message, `Can't reopen: only ${p.currentStock} of "${p.name}" in stock.`, 'error', 0);
                select.value = oldStatus;
                return;
            }
        }
    }

    select.disabled = true;
    try {
        await updateSale(sale, { ...sale, status: newStatus });
        hf.message(message, `Invoice ${sale.invoiceNo || sale.memoNo || ''}: ${statusLabel(newStatus)} ✓`);
        products = await getProducts();
        if (!editing) resetSaleForm();
        await loadSales();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not change status: ${error.message}`, 'error', 0);
        select.value = oldStatus;
        select.disabled = false;
    }
}

async function removeSale(sale) {
    const ok = confirm(
        `Delete invoice ${sale.invoiceNo || sale.memoNo || ''} for ${sale.customerName}?\n\n` +
        (isActive(sale) ? 'Its items will be put back into stock.' : 'This removes it completely.'),
    );
    if (!ok) return;
    try {
        await deleteSale(sale);
        hf.message(message, 'Sale deleted.');
        products = await getProducts();
        if (editing?.id === sale.id) resetSaleForm();
        await loadSales();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not delete: ${error.message}`, 'error', 0);
    }
}


// Buttons shown for a few seconds after a new sale is saved
function showAfterSave(sale) {
    afterSave.replaceChildren(hf.rowButton('বাংলা সামারি', 'ghost', () => openSummary(sale, settings)));
    hf.show(afterSave);
    clearTimeout(afterSave._timer);
    afterSave._timer = setTimeout(() => hf.hide(afterSave), 12000);
}

// ---------- Selecting orders to print ----------
function updateSelection() {
    const shownIds = hf.qa('#sales-table-body tr[data-id]').map((r) => r.dataset.id);
    for (const id of [...selected]) if (!sales.some((s) => s.id === id)) selected.delete(id);
    selectionCount.textContent = `${selected.size} selected`;
    selectionBar.hidden = selected.size === 0;
    const ids = encodeURIComponent([...selected].join(','));
    hf.q('#print-sel-2up').href = `print.html?sales=${ids}&doc=invoice-2up`;
    hf.q('#print-sel-1up').href = `print.html?sales=${ids}&doc=invoice-1up`;
    hf.q('#print-sel-conf').href = `print.html?sales=${ids}&doc=order-confirmation`;
    selectAll.checked = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
    selectAll.indeterminate = !selectAll.checked && shownIds.some((id) => selected.has(id));
}

// ---------- Orders list ----------
function createSaleRow(sale) {
    const key = statusOf(sale);

    const invoiceCell = hf.create('td', { className: 'code', text: sale.invoiceNo || sale.memoNo || '—' });
    if (sale.orderNo) invoiceCell.append(hf.create('span', { className: 'sub', text: `Order ${sale.orderNo}` }));

    const customerCell = hf.create('td', { className: 'wrap' });
    if (sale.customerPhone) {
        customerCell.append(hf.create('a', {
            className: 'link', text: sale.customerName || sale.customerPhone,
            attrs: { href: `customers.html?phone=${encodeURIComponent(sale.customerPhone)}` },
        }));
    } else {
        customerCell.append(hf.create('strong', { text: sale.customerName || '—' }));
    }
    if (sale.phoneVerified) customerCell.append(hf.create('span', { className: 'badge badge-ok', text: '✓ Verified' }));
    const contact = [sale.customerPhone, sale.customerAddress].filter(Boolean).join(' · ');
    if (contact) customerCell.append(hf.create('span', { className: 'sub', text: contact }));

    const itemsText = (sale.items || []).map((i) => `${i.itemName} × ${i.qty}`).join(', ');

    const pickCell = hf.create('td', { className: 'select-col' });
    const pick = hf.create('input', { attrs: { type: 'checkbox', 'aria-label': 'Select order' } });
    pick.checked = selected.has(sale.id);
    hf.on(pick, 'change', () => {
        if (pick.checked) selected.add(sale.id); else selected.delete(sale.id);
        pick.closest('tr').classList.toggle('is-selected', pick.checked);
        updateSelection();
    });
    pickCell.append(pick);

    // Status: change it right here
    const statusCell = hf.create('td', { className: 'status-cell' });
    const select = hf.create('select', { className: `status-select st-${key}`, attrs: { 'aria-label': 'Order status' } });
    fillStatusSelect(select);
    select.value = key;
    hf.on(select, 'change', () => changeStatus(sale, select.value, select));
    statusCell.append(select);
    const owes = courierOwesOf(sale);
    if (owes) statusCell.append(hf.create('span', { className: 'sub', text: `Courier owes ${hf.money(owes)}` }));

    const totalCell = hf.create('td', { className: 'num' });
    totalCell.append(hf.create('span', { text: hf.money(totalDueOf(sale)) }));
    const payInfo = [sale.deliveryZone, sale.payment].filter(Boolean).join(' · ');
    if (payInfo) totalCell.append(hf.create('span', { className: 'sub', text: payInfo }));

    const profit = profitOf(sale);
    const profitCell = hf.create('td', {
        className: `num ${profit < 0 ? 'negative' : ''}`, text: isActive(sale) ? hf.money(profit) : '—',
    });

    const actions = hf.create('td', { className: 'actions' });
    const id = encodeURIComponent(sale.id);
    actions.append(
        hf.rowButton('Edit', 'ghost', () => startEdit(sale)),
        hf.menuButton([
            { label: 'Print invoice', href: `print.html?sales=${id}&doc=invoice-1up` },
            { label: 'Print order confirmation', href: `print.html?sales=${id}&doc=order-confirmation` },
            { label: 'বাংলা সামারি (copy & send)', onClick: () => openSummary(sale, settings) },
            { label: sale.phoneVerified ? 'Phone verified ✓' : 'Verify phone (OTP)', onClick: () => openOtp(sale, () => loadSales()) },
            { label: 'Delete order', danger: true, onClick: () => removeSale(sale) },
        ]),
    );

    const row = hf.create('tr', { className: [isActive(sale) ? '' : 'row-muted', selected.has(sale.id) ? 'is-selected' : ''].join(' ').trim() });
    row.dataset.id = sale.id;
    row.append(
        pickCell,
        hf.create('td', { text: hasValidDate(sale) ? hf.date(sale.date) : '?' }),
        invoiceCell, customerCell,
        hf.create('td', { className: 'wrap', text: itemsText }),
        statusCell, totalCell, profitCell, actions,
    );
    return row;
}

function renderSummary(list) {
    const active = list.filter(isActive);
    const strong = (label, value) => {
        const span = hf.create('span', { text: `${label}: ` });
        span.append(hf.create('strong', { text: value }));
        return span;
    };
    const sum = (fn) => active.reduce((s, x) => s + fn(x), 0);
    summary.replaceChildren(
        hf.create('span', { text: range.label }),
        hf.create('span', { text: `${active.length} orders` }),
        strong('Sales', hf.money(sum((x) => x.netSale || 0))),
        strong('Delivery (after courier)', hf.money(sum(deliveryNetOf))),
        strong('Profit', hf.money(sum(profitOf))),
        strong('Courier owes you', hf.money(sum(courierOwesOf))),
        strong('To ship', String(active.filter(toShip).length)),
    );
}

function renderTable() {
    const term = searchInput.value.trim().toLowerCase();
    const filter = statusFilter.value;
    const shown = sales.filter((s) => {
        if (filter === 'toShip' && !toShip(s)) return false;
        if (filter === 'owes' && !courierOwesOf(s)) return false;
        if (filter && !['toShip', 'owes'].includes(filter) && statusOf(s) !== filter) return false;
        if (!term) return true;
        const text = [
            s.customerName, s.customerPhone, s.invoiceNo, s.memoNo, s.orderNo, s.trxId, s.notes,
            ...(s.items || []).map((i) => i.itemName),
        ].join(' ');
        return text.toLowerCase().includes(term);
    });

    renderSummary(shown);
    if (shown.length === 0) {
        hf.tableMessage(tableBody, sales.length ? 'No orders match your filters.' : 'No sales in this period.', COLUMNS);
        return;
    }
    hf.clear(tableBody);
    shown.forEach((sale) => tableBody.append(createSaleRow(sale)));
    updateSelection();
}

// When nothing shows, look for sales whose date can't be read and offer to fix them
async function checkForBrokenSales() {
    if (checkedForBrokenSales) return;
    checkedForBrokenSales = true;
    try {
        const all = await getAllSales();
        const broken = all.filter((s) => !hasValidDate(s));
        console.log(`Sales check: ${all.length} sales in total, ${broken.length} with an unreadable date.`,
            broken.map((s) => ({ id: s.id, date: s.date, type: typeof s.date })));

        if (broken.length) {
            notice.replaceChildren(
                hf.create('span', {
                    text: `Found ${broken.length} sale${broken.length > 1 ? 's' : ''} that can't show in the list because ${broken.length > 1 ? 'their' : 'its'} date isn't saved properly. `,
                }),
            );
            const fixBtn = hf.rowButton(`Fix ${broken.length} sale${broken.length > 1 ? 's' : ''}`, 'primary', async () => {
                hf.busy(fixBtn, true, 'Fixing...');
                try {
                    const fixed = await repairSaleDates(broken);
                    notice.replaceChildren(hf.create('span', { text: `Fixed ${fixed} sale${fixed > 1 ? 's' : ''} ✓` }));
                    notice.className = 'notice ok';
                    await loadSales();
                } catch (error) {
                    console.error(error);
                    hf.busy(fixBtn, false);
                    hf.message(message, `Could not fix: ${error.message}`, 'error', 0);
                }
            });
            notice.append(fixBtn);
            notice.className = 'notice';
            hf.show(notice);
            // Show them in the table too
            hf.clear(tableBody);
            broken.forEach((s) => tableBody.append(createSaleRow(s)));
        } else if (all.length) {
            notice.textContent = `No sales in this period. Your latest sale is dated ${hf.date(all[0].date)}. Change the period above to see it.`;
            notice.className = 'notice';
            hf.show(notice);
        }
    } catch (error) {
        console.error('Sales check failed', error);
    }
}

async function loadSales() {
    hf.tableMessage(tableBody, 'Loading...', COLUMNS);
    hf.hide(notice);
    try {
        sales = await getSales(range.from, range.to);
        renderTable();
        if (sales.length === 0) await checkForBrokenSales();
    } catch (error) {
        console.error(error);
        hf.tableMessage(tableBody, `Could not load sales: ${error.message}`, COLUMNS);
    }
}


// ---------- Events ----------
hf.on(addItemBtn, 'click', () => createItemRow());
hf.on(discountInput, 'input', updateTotals);
hf.on(advanceInput, 'input', updateTotals);
hf.on(statusSelect, 'change', updateTotals);
hf.on(searchInput, 'input', hf.debounce(renderTable, 200));
hf.on(statusFilter, 'change', renderTable);
hf.on(cancelEditBtn, 'click', resetSaleForm);
hf.on(selectAll, 'change', () => {
    hf.qa('#sales-table-body tr[data-id]').forEach((row) => {
        if (selectAll.checked) selected.add(row.dataset.id); else selected.delete(row.dataset.id);
        row.classList.toggle('is-selected', selectAll.checked);
        const box = row.querySelector('.select-col input');
        if (box) box.checked = selectAll.checked;
    });
    updateSelection();
});
hf.on(hf.q('#clear-selection'), 'click', () => {
    selected.clear();
    hf.qa('#sales-table-body tr[data-id]').forEach((row) => {
        row.classList.remove('is-selected');
        const box = row.querySelector('.select-col input');
        if (box) box.checked = false;
    });
    updateSelection();
});
hf.on(deleteSaleBtn, 'click', () => {
    if (editing) removeSale(editing);
});

hf.on(zoneSelect, 'change', () => {
    deliveryByHand = false;   // picking an area resets both amounts
    feeByHand = false;
    updateTotals();
    updateNumberHints();
});
hf.on(dateInput, 'change', updateNumberHints);
hf.on(deliveryInput, 'input', () => { deliveryByHand = true; updateTotals(); });
hf.on(feeInput, 'input', () => { feeByHand = true; updateTotals(); });

hf.on(phoneInput, 'input', hf.debounce(lookUpCustomer, 400));
hf.on(phoneInput, 'blur', () => {
    const clean = hf.phone(phoneInput.value);
    if (clean) phoneInput.value = clean;
});

hf.on(saleForm, 'submit', async (event) => {
    event.preventDefault();

    hf.busy(submitBtn, true);
    try {
        const sale = readSaleForm();                  // throws if something's wrong
        if (customerWarning && !editing && !confirm(
            `⚠ ${sale.customerPhone} is BLACKLISTED.\n${customerWarning}\n\nSave this sale anyway?`)) {
            hf.busy(submitBtn, false);
            return;
        }
        sale.invoiceNo = await setInvoiceNo(sale.invoiceNo, sale.date);
        sale.orderNo = await setOrderNo(sale.orderNo, sale.date, sale.deliveryZone);
        if (editing) {
            for (const key of ['phoneVerified', 'verifiedAt', 'verifiedBy', 'otpCode', 'otpCreatedAt']) {
                if (editing[key] !== undefined && sale.customerPhone === editing.customerPhone) sale[key] = editing[key];
            }
            await updateSale(editing, sale);
            hf.message(message, `Invoice ${sale.invoiceNo} updated ✓`);
        } else {
            await addSale(sale);
            hf.message(message, `Invoice ${sale.invoiceNo} · Order ${sale.orderNo} for ${sale.customerName} saved ✓`, 'success', 12);
            showAfterSave(sale);
        }
        hf.busy(submitBtn, false);
        products = await getProducts();
        resetSaleForm();
        await loadSales();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save: ${error.message}`, 'error', 0);
        hf.busy(submitBtn, false);
    }
});


// ---------- Start ----------
dateInput.value = hf.today();
statusFilter.replaceChildren(
    new Option('All statuses', ''),
    new Option('To ship (pending + packaged)', 'toShip'),
    new Option('Courier owes me', 'owes'),
    ...STATUSES.map((s) => new Option(s.label, s.key)),
);
range = createRangeFilter(hf.q('#sales-range'), loadSales);
const salesTable = tableBody.closest('table');
searchInput.closest('.card-head-tools').append(hf.sortSelect(hf.sortable(salesTable)), hf.exportButton(salesTable, 'sales'));

startPage({
    title: 'Sales',
    onReady: async () => {
        settings = await loadSettings();
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
