// ==============================
// customers.js — customer list and order history (by phone number)
// Open one directly with: customers.html?phone=01711111111
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage } from "./layout.js";
import { getCustomers, getCustomerSales, rebuildCustomers, setBlacklist } from "./firebase.js";
import { isActive, profitOf, totalDueOf, statusBadge } from "./orders.js";


// ---------- Elements ----------
const searchInput = hf.q('#customer-search');
const filterSelect = hf.q('#customer-filter');
const blacklistBtn = hf.q('.blacklist-btn');
const detailBlacklist = hf.q('#detail-blacklist');
const blacklistForm = hf.q('#blacklist-form');
const blacklistPhone = hf.q('#blacklist-phone');
const blacklistReason = hf.q('#blacklist-reason');
const summary = hf.q('#customer-summary');
const tableBody = hf.q('#customer-table-body');
const rebuildBtn = hf.q('.rebuild-btn');
const message = hf.q('#form-message');

const detail = hf.q('.customer-detail');
const detailName = hf.q('#detail-name');
const detailContact = hf.q('#detail-contact');
const detailStats = hf.q('#detail-stats');
const detailBody = hf.q('#detail-body');
const detailNewSale = hf.q('#detail-new-sale');
const closeDetailBtn = hf.q('.close-detail-btn');

const COLUMNS = 7;
let customers = [];
let openPhone = null;   // phone of the customer shown in the history panel


// ---------- Functions ----------
const millis = (ts) => (ts ? hf.toDate(ts).getTime() : 0);

function stat(label, value, note = '') {
    const tile = hf.create('div', { className: 'stat' });
    tile.append(
        hf.create('div', { className: 'stat-label', text: label }),
        hf.create('div', { className: 'stat-value', text: value }),
    );
    if (note) tile.append(hf.create('div', { className: 'stat-note', text: note }));
    return tile;
}

function renderSummary() {
    const repeat = customers.filter((c) => (c.orderCount || 0) > 1).length;
    const total = customers.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const item = (label, value) => {
        const span = hf.create('span', { text: `${label}: ` });
        span.append(hf.create('strong', { text: value }));
        return span;
    };
    summary.replaceChildren(
        item('Customers', String(customers.length)),
        item('Repeat customers', String(repeat)),
        item('Blacklisted', String(customers.filter((c) => c.blacklisted).length)),
        item('Total spent', hf.money(total)),
    );
}

function createCustomerRow(c) {
    const nameCell = hf.create('td', { className: 'wrap' });
    nameCell.append(hf.create('strong', { text: c.name || '—' }));
    if (c.blacklisted) nameCell.append(hf.create('span', { className: 'badge badge-danger', text: 'Blacklisted' }));
    if (c.phoneVerified) nameCell.append(hf.create('span', { className: 'badge badge-ok', text: '✓ Verified' }));
    if (c.returnCount > 0) nameCell.append(hf.create('span', { className: 'badge badge-warn', text: `↩ ${c.returnCount} returned` }));
    if (c.blacklisted && c.blacklistReason) nameCell.append(hf.create('span', { className: 'sub negative', text: c.blacklistReason }));
    if (c.address) nameCell.append(hf.create('span', { className: 'sub', text: c.address }));

    const ordersCell = hf.create('td', { className: 'num' });
    ordersCell.append(hf.create('span', { text: String(c.orderCount || 0) }));
    if ((c.orderCount || 0) > 1) ordersCell.append(hf.create('span', { className: 'badge badge-brand', text: 'Repeat' }));

    const actions = hf.create('td', { className: 'actions' });
    actions.append(hf.rowButton('History', 'ghost', () => openCustomer(c.id)));

    const row = hf.create('tr', { className: c.blacklisted ? 'row-danger' : '' });
    row.append(
        nameCell,
        hf.create('td', { className: 'code', text: c.phone || c.id }),
        hf.create('td', { text: c.deliveryZone || '—' }),
        ordersCell,
        hf.create('td', { className: 'num', text: hf.money(c.totalSpent) }),
        hf.create('td', { text: hf.date(c.lastOrderDate) }),
        actions,
    );
    return row;
}

function renderTable() {
    const term = searchInput.value.trim().toLowerCase();
    const show = filterSelect.value;
    const shown = customers
        .filter((c) => show !== 'blacklisted' || c.blacklisted)
        .filter((c) => show !== 'repeat' || (c.orderCount || 0) > 1)
        .filter((c) => !term || `${c.name} ${c.phone} ${c.address} ${c.email} ${c.blacklistReason || ''}`.toLowerCase().includes(term))
        .sort((a, b) => millis(b.lastOrderDate) - millis(a.lastOrderDate));   // default: most recent first

    if (customers.length === 0) {
        hf.tableMessage(tableBody, 'No customers yet. They appear here after you save a sale.', COLUMNS);
        return;
    }
    if (shown.length === 0) {
        hf.tableMessage(tableBody, 'No customers match your search.', COLUMNS);
        return;
    }
    hf.clear(tableBody);
    shown.forEach((c) => tableBody.append(createCustomerRow(c)));
}

async function loadCustomers() {
    hf.tableMessage(tableBody, 'Loading...', COLUMNS);
    try {
        customers = await getCustomers();
        renderSummary();
        renderTable();
    } catch (error) {
        console.error(error);
        hf.tableMessage(tableBody, `Could not load customers: ${error.message}`, COLUMNS);
    }
}

// Show one customer's full order history
async function openCustomer(phone) {
    const c = customers.find((x) => x.id === phone) || { phone };
    openPhone = phone;
    showBlacklistState(c);
    history.replaceState(null, '', `?phone=${encodeURIComponent(phone)}`);

    detailName.textContent = c.name || phone;
    detailContact.textContent = [phone, c.email, c.address, c.deliveryZone].filter(Boolean).join(' · ');
    detailNewSale.href = 'sales.html';
    hf.clear(detailStats);
    hf.tableMessage(detailBody, 'Loading...', 7);
    hf.show(detail);
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        const sales = await getCustomerSales(phone);
        const active = sales.filter(isActive);
        const spent = active.reduce((s, x) => s + (x.netSale || 0), 0);
        const paid = active.reduce((s, x) => s + totalDueOf(x), 0);
        const profit = active.reduce((s, x) => s + profitOf(x), 0);
        const items = active.reduce((s, x) => s + (x.items || []).reduce((n, i) => n + i.qty, 0), 0);
        const lost = sales.length - active.length;

        detailStats.replaceChildren(
            stat('Orders', String(active.length), [
                active.length ? `since ${hf.date(active.at(-1).date)}` : '',
                lost ? `${lost} returned/cancelled` : '',
            ].filter(Boolean).join(' · ')),
            stat('Items bought', String(items)),
            stat('Total spent', hf.money(spent), active.length ? `avg ${hf.money(spent / active.length)} per order` : ''),
            stat('Customer paid (with delivery)', hf.money(paid)),
            stat('Your profit', hf.money(profit)),
        );

        if (sales.length === 0) {
            hf.tableMessage(detailBody, 'No sales found for this number.', 7);
            return;
        }
        hf.clear(detailBody);
        for (const s of sales) {
            const deliveryCell = hf.create('td');
            deliveryCell.append(hf.create('span', { text: hf.money(s.deliveryCharge || 0) }));
            if (s.deliveryZone) deliveryCell.append(hf.create('span', { className: 'sub', text: s.deliveryZone }));

            const statusCell = hf.create('td', { className: 'status-cell' });
            statusCell.append(statusBadge(s));
            if (s.payment) statusCell.append(hf.create('span', { className: 'sub', text: s.payment }));

            const row = hf.create('tr', { className: isActive(s) ? '' : 'row-muted' });
            row.append(
                hf.create('td', { text: hf.date(s.date) }),
                hf.create('td', { className: 'code', text: s.invoiceNo || s.memoNo || '—' }),
                hf.create('td', { className: 'wrap', text: (s.items || []).map((i) => `${i.itemName} × ${i.qty}`).join(', ') }),
                deliveryCell,
                statusCell,
                hf.create('td', { className: 'num', text: hf.money(s.netSale) }),
                hf.create('td', { className: 'num', text: hf.money(totalDueOf(s)) }),
            );
            detailBody.append(row);
        }
    } catch (error) {
        console.error(error);
        hf.tableMessage(detailBody, `Could not load history: ${error.message}`, 7);
    }
}

function showBlacklistState(c) {
    if (c.blacklisted) {
        detailBlacklist.textContent = `⚠ Blacklisted${c.blacklistedAt ? ` on ${hf.date(c.blacklistedAt)}` : ''}${c.blacklistReason ? ` · ${c.blacklistReason}` : ''}. You'll be warned when a sale is made to this number.`;
        hf.show(detailBlacklist);
        blacklistBtn.textContent = 'Remove from blacklist';
        blacklistBtn.className = 'btn btn-ghost btn-sm blacklist-btn';
    } else {
        hf.hide(detailBlacklist);
        blacklistBtn.textContent = 'Blacklist';
        blacklistBtn.className = 'btn btn-danger btn-sm blacklist-btn';
    }
}

async function toggleBlacklist(phone) {
    const c = customers.find((x) => x.id === phone) || { phone };
    try {
        if (c.blacklisted) {
            if (!confirm(`Remove ${c.name || phone} from the blacklist?`)) return;
            await setBlacklist(phone, false);
            hf.message(message, `${c.name || phone} removed from the blacklist.`);
        } else {
            const reason = prompt(`Why are you blacklisting ${c.name || phone}?\n(e.g. refused delivery, fake order)`, '');
            if (reason === null) return;     // pressed Cancel
            await setBlacklist(phone, true, reason.trim(), c.name || '');
            hf.message(message, `${c.name || phone} blacklisted.`);
        }
        await loadCustomers();
        const updated = customers.find((x) => x.id === phone);
        if (updated) showBlacklistState(updated);
        else closeCustomer();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not update blacklist: ${error.message}`, 'error', 0);
    }
}

function closeCustomer() {
    openPhone = null;
    hf.hide(detail);
    history.replaceState(null, '', location.pathname);
}


// ---------- Events ----------
hf.on(searchInput, 'input', hf.debounce(renderTable, 200));
hf.on(filterSelect, 'change', renderTable);
hf.on(blacklistBtn, 'click', () => { if (openPhone) toggleBlacklist(openPhone); });

hf.on(blacklistForm, 'submit', async (event) => {
    event.preventDefault();
    const phone = hf.phone(blacklistPhone.value);
    if (!hf.isPhone(phone)) {
        hf.message(message, 'Enter a valid 11-digit phone number (01XXXXXXXXX).', 'error');
        return;
    }
    try {
        const existing = customers.find((c) => c.id === phone);
        await setBlacklist(phone, true, blacklistReason.value.trim(), existing?.name || '');
        hf.message(message, `${phone} added to the blacklist.`);
        blacklistForm.reset();
        await loadCustomers();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not blacklist: ${error.message}`, 'error', 0);
    }
});
hf.on(closeDetailBtn, 'click', closeCustomer);

hf.on(rebuildBtn, 'click', async () => {
    if (!confirm('Rebuild the customer list from all saved sales?\n\nThis reads every sale once, so it uses some of your daily free reads.')) return;
    hf.busy(rebuildBtn, true, 'Rebuilding...');
    try {
        const count = await rebuildCustomers();
        hf.message(message, `Done: ${count} customers ✓`);
        await loadCustomers();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not rebuild: ${error.message}`, 'error', 0);
    } finally {
        hf.busy(rebuildBtn, false);
    }
});


// ---------- Start ----------
const customerTable = tableBody.closest('table');
hf.sortable(detailBody.closest('table'));
filterSelect.closest('.card-head-tools').append(hf.sortSelect(hf.sortable(customerTable)), hf.exportButton(customerTable, 'customers'));
startPage({
    title: 'Customers',
    onReady: async () => {
        await loadCustomers();
        const phone = new URLSearchParams(location.search).get('phone');
        if (phone) openCustomer(hf.phone(phone));
    },
});
