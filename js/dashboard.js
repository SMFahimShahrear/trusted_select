// ==============================
// dashboard.js — profit & loss, stock overview
// Everything is calculated from sales, expenses and products; nothing extra is stored.
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage, createRangeFilter } from "./layout.js";
import { getSales, getExpenses, getProducts, stockStatus } from "./firebase.js";
import { isActive, statusOf, profitOf, deliveryNetOf, courierOwesOf, toShip } from "./orders.js";


// ---------- Elements ----------
const periodLabel = hf.q('#period-label');
const plStats = hf.q('#pl-stats');
const stockStats = hf.q('#stock-stats');
const orderStats = hf.q('#order-stats');
const topProductsList = hf.q('#top-products');
const expenseCategoryList = hf.q('#expense-categories');
const monthlyBody = hf.q('#monthly-body');
const monthlyFoot = hf.q('#monthly-foot');
const lowStockBody = hf.q('#low-stock-body');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let range;


// ---------- Functions ----------
const sum = (list, fn) => list.reduce((s, x) => s + (fn(x) || 0), 0);

// One stat tile
function stat({ label, value, note = '', tone = '', highlight = false }) {
    const tile = hf.create('div', { className: `stat${highlight ? ' highlight' : ''}` });
    tile.append(
        hf.create('div', { className: 'stat-label', text: label }),
        hf.create('div', { className: `stat-value ${tone}`, text: value }),
    );
    if (note) tile.append(hf.create('div', { className: 'stat-note', text: note }));
    return tile;
}

const toneOf = (n) => (n < 0 ? 'negative' : n > 0 ? 'positive' : '');

// sales = active orders only (returned / cancelled are left out before this is called)
function renderProfitAndLoss(sales, expenses) {
    const totalSales = sum(sales, (s) => s.netSale);
    const costOfGoods = sum(sales, (s) => s.totalCost);
    const grossProfit = totalSales - costOfGoods;
    const deliveryNet = sum(sales, deliveryNetOf);
    const totalExpenses = sum(expenses, (e) => e.amount);
    const netProfit = grossProfit + deliveryNet - totalExpenses;
    const margin = totalSales ? grossProfit / totalSales : 0;
    const charged = sum(sales, (s) => s.deliveryCharge);
    const fees = sum(sales, (s) => s.courierFee);

    plStats.replaceChildren(
        stat({ label: 'Total sales', value: hf.money(totalSales), note: `${sales.length} orders` }),
        stat({ label: 'Cost of goods sold', value: hf.money(costOfGoods) }),
        stat({ label: 'Gross profit', value: hf.money(grossProfit), note: `${hf.percent(margin)} margin`, tone: toneOf(grossProfit) }),
        stat({ label: 'Delivery (after courier)', value: hf.money(deliveryNet), note: `${hf.money(charged)} charged − ${hf.money(fees)} fees`, tone: toneOf(deliveryNet) }),
        stat({ label: 'Expenses', value: hf.money(totalExpenses), note: `${expenses.length} entries` }),
        stat({ label: 'Net profit', value: hf.money(netProfit), tone: toneOf(netProfit), highlight: true }),
    );
}

// Order pipeline for the period (all orders, including returned / cancelled)
function renderOrders(allSales) {
    const active = allSales.filter(isActive);
    const count = (key) => allSales.filter((s) => statusOf(s) === key).length;
    const owes = sum(active, courierOwesOf);
    const withCourier = active.filter((s) => courierOwesOf(s) > 0).length;
    orderStats.replaceChildren(
        stat({ label: 'To ship', value: String(active.filter(toShip).length), note: `${count('pending')} pending · ${count('packed')} packaged` }),
        stat({ label: 'With courier', value: String(count('handed')), note: 'handed over, not collected yet' }),
        stat({ label: 'Courier owes you', value: hf.money(owes), note: `${withCourier} orders not paid out yet`, tone: owes ? 'positive' : '' }),
        stat({ label: 'Courier paid', value: String(count('paid')) }),
        stat({ label: 'Returned / cancelled', value: String(count('returned') + count('cancelled')), tone: count('returned') + count('cancelled') ? 'negative' : '' }),
    );
}

function renderStock(products) {
    const stockValue = sum(products, (p) => Math.max(p.currentStock || 0, 0) * (p.costPrice || 0));
    const retailValue = sum(products, (p) => Math.max(p.currentStock || 0, 0) * (p.sellingPrice || 0));
    const units = sum(products, (p) => Math.max(p.currentStock || 0, 0));
    const low = products.filter((p) => stockStatus(p) === 'LOW STOCK').length;
    const out = products.filter((p) => stockStatus(p) === 'OUT OF STOCK').length;

    stockStats.replaceChildren(
        stat({ label: 'Stock value (cost)', value: hf.money(stockValue), note: `${units} units in stock` }),
        stat({ label: 'Stock value (selling)', value: hf.money(retailValue) }),
        stat({ label: 'Products', value: String(products.length) }),
        stat({ label: 'Low stock', value: String(low), tone: low ? 'negative' : '' }),
        stat({ label: 'Out of stock', value: String(out), tone: out ? 'negative' : '' }),
    );

    // Needs reordering: out of stock first, then low stock
    const needs = products
        .filter((p) => stockStatus(p) !== 'In Stock')
        .sort((a, b) => (a.currentStock || 0) - (b.currentStock || 0));

    if (needs.length === 0) {
        hf.tableMessage(lowStockBody, 'Everything is well stocked 👍', 5);
        return;
    }
    hf.clear(lowStockBody);
    for (const p of needs) {
        const status = stockStatus(p);
        const badge = hf.create('td');
        badge.append(hf.create('span', {
            className: `badge status-${status.toLowerCase().replaceAll(' ', '-')}`, text: status,
        }));
        const row = hf.create('tr');
        row.append(
            hf.create('td', { className: 'code', text: p.itemCode || '—' }),
            hf.create('td', { className: 'wrap', text: p.name }),
            hf.create('td', { className: 'num', text: String(p.currentStock ?? 0) }),
            hf.create('td', { className: 'num', text: String(p.lowStockAlert ?? 0) }),
            badge,
        );
        lowStockBody.append(row);
    }
}

// Horizontal bar list: [{ label, value, text }]
function renderBars(listEl, rows, emptyText) {
    listEl.replaceChildren();
    if (rows.length === 0) {
        listEl.append(hf.create('li', { className: 'empty-note', text: emptyText }));
        return;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    for (const r of rows) {
        const li = hf.create('li');
        const head = hf.create('div', { className: 'bar-row' });
        head.append(hf.create('span', { text: r.label }), hf.create('span', { text: r.text }));
        const track = hf.create('div', { className: 'bar-track' });
        const fill = hf.create('div', { className: 'bar-fill' });
        fill.style.width = `${Math.max((r.value / max) * 100, 2)}%`;
        track.append(fill);
        li.append(head, track);
        listEl.append(li);
    }
}

function renderTopProducts(sales) {
    const byProduct = {};
    for (const s of sales) {
        for (const i of s.items || []) {
            const key = i.productId || i.itemName;
            byProduct[key] ??= { label: i.itemName, qty: 0, value: 0 };
            byProduct[key].qty += i.qty;
            byProduct[key].value += i.qty * i.unitPrice;
        }
    }
    const rows = Object.values(byProduct)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
        .map((r) => ({ ...r, text: `${r.qty} sold · ${hf.money(r.value)}` }));
    renderBars(topProductsList, rows, 'No sales in this period.');
}

function renderExpenseCategories(expenses) {
    const byCategory = {};
    for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
    const rows = Object.entries(byCategory)
        .map(([label, value]) => ({ label, value, text: hf.money(value) }))
        .sort((a, b) => b.value - a.value);
    renderBars(expenseCategoryList, rows, 'No expenses in this period.');
}

function renderMonthly(sales, expenses) {
    const months = {};
    const bucket = (ts) => {
        const d = hf.toDate(ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months[key] ??= { label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, orders: 0, sales: 0, gross: 0, expenses: 0 };
        return months[key];
    };
    for (const s of sales) {
        const m = bucket(s.date);
        m.orders += 1;
        m.sales += s.netSale || 0;
        m.gross += profitOf(s);
    }
    for (const e of expenses) bucket(e.date).expenses += e.amount || 0;

    const keys = Object.keys(months).sort();
    monthlyFoot.replaceChildren();
    if (keys.length === 0) {
        hf.tableMessage(monthlyBody, 'No sales or expenses in this period.', 6);
        return;
    }

    const makeRow = (label, m, tag = 'td') => {
        const net = m.gross - m.expenses;
        const row = hf.create('tr');
        row.append(
            hf.create(tag, { text: label }),
            hf.create(tag, { className: 'num', text: String(m.orders) }),
            hf.create(tag, { className: 'num', text: hf.money(m.sales) }),
            hf.create(tag, { className: 'num', text: hf.money(m.gross) }),
            hf.create(tag, { className: 'num', text: hf.money(m.expenses) }),
            hf.create(tag, { className: `num ${toneOf(net)}`, text: hf.money(net) }),
        );
        return row;
    };

    hf.clear(monthlyBody);
    keys.forEach((k) => {
        const row = makeRow(months[k].label, months[k]);
        row.cells[0].dataset.sort = k;          // "2026-11" so months sort by date, not alphabetically
        monthlyBody.append(row);
    });

    if (keys.length > 1) {
        const total = { orders: 0, sales: 0, gross: 0, expenses: 0 };
        for (const k of keys) for (const f of Object.keys(total)) total[f] += months[k][f];
        monthlyFoot.append(makeRow('Total', total));
    }
}

async function loadDashboard() {
    periodLabel.textContent = `Profit & loss · ${range.label}`;
    hf.tableMessage(monthlyBody, 'Loading...', 6);
    try {
        const [allSales, expenses, products] = await Promise.all([
            getSales(range.from, range.to),
            getExpenses(range.from, range.to),
            getProducts(),
        ]);
        const sales = allSales.filter(isActive);   // returned / cancelled don't count
        renderProfitAndLoss(sales, expenses);
        renderOrders(allSales);
        renderStock(products);
        renderTopProducts(sales);
        renderExpenseCategories(expenses);
        renderMonthly(sales, expenses);
    } catch (error) {
        console.error(error);
        hf.tableMessage(monthlyBody, `Could not load dashboard: ${error.message}`, 6);
    }
}


// ---------- Start ----------
hf.sortable(monthlyBody.closest('table'));
hf.sortable(lowStockBody.closest('table'));
range = createRangeFilter(hf.q('#dashboard-range'), loadDashboard);
startPage({ title: 'Dashboard', onReady: loadDashboard });
