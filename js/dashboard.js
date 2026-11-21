// ==============================
// dashboard.js — profit & loss, cash collections, trends and stock overview
// Everything is calculated from sales, expenses and products; nothing extra is stored.
//
// How the numbers fit together (returned / cancelled orders are left out):
//   Sales            = items total − discounts
//   Gross profit     = Sales − product cost
//   Profit from orders = Gross profit + delivery charged − courier fees − self-delivery expenses
//   Net profit       = Profit from orders − expenses (incl. returned-order delivery losses)
//   You receive      = what customers pay − courier fees − self-delivery expenses
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { startPage, createRangeFilter } from "./layout.js";
import { getSales, getExpenses, getProducts, stockStatus } from "./firebase.js";
import {
    isActive, statusOf, profitOf, courierOwesOf, toShip, isSelf, selfCashDueOf,
    netSaleOf, totalDueOf, codOf, payoutOf,
} from "./orders.js";


// ---------- Elements ----------
const periodLabel = hf.q('#period-label');
const compareLabel = hf.q('#compare-label');
const kpiStats = hf.q('#kpi-stats');
const checksCard = hf.q('#checks');
const statementList = hf.q('#statement');
const cashList = hf.q('#cash');
const cashBar = hf.q('#cash-bar');
const moneyBar = hf.q('#money-bar');
const moneyLegend = hf.q('#money-legend');
const moneyTotal = hf.q('#money-total');
const trendBox = hf.q('#trend');
const trendTitle = hf.q('#trend-title');
const stockStats = hf.q('#stock-stats');
const orderStats = hf.q('#order-stats');
const topProductsList = hf.q('#top-products');
const areaList = hf.q('#delivery-areas');
const expenseCategoryList = hf.q('#expense-categories');
const customerList = hf.q('#top-customers');
const monthlyBody = hf.q('#monthly-body');
const monthlyFoot = hf.q('#monthly-foot');
const lowStockBody = hf.q('#low-stock-body');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Chart colours (colour-blind checked), always used in this order
const COLORS = { blue: '#2a78d6', orange: '#ea6c0a', aqua: '#1baf7a', yellow: '#eda100', violet: '#6250d6' };
let range;
let lastTrend = null;     // kept so the chart can be redrawn when the window is resized


// ---------- Small helpers ----------
const n = (v) => Number(v) || 0;
const sum = (list, fn) => list.reduce((s, x) => s + n(fn(x)), 0);
const toneOf = (v) => (v < 0 ? 'negative' : v > 0 ? 'positive' : '');
const isReturnLoss = (e) => /returned order/i.test(e.details || '');

// Product cost of an order (saved total, or worked out from the items)
const costOf = (s) => (s.totalCost !== undefined ? n(s.totalCost)
    : (s.items || []).reduce((t, i) => t + n(i.qty) * n(i.unitCost), 0));
const grossOf = (s) => (s.grossSale !== undefined ? n(s.grossSale)
    : (s.items || []).reduce((t, i) => t + n(i.qty) * n(i.unitPrice), 0));
const courierFeeOf = (s) => (isSelf(s) ? 0 : n(s.courierFee));
const selfCostOf = (s) => (isSelf(s) ? n(s.courierFee) : 0);
const deliveryCostOf = (s) => n(s.courierFee);

// All the period's totals in one place
function totalsOf(allSales, expenses) {
    const sales = allSales.filter(isActive);
    const t = {
        orders: sales.length,
        allOrders: allSales.length,
        gross: sum(sales, grossOf),
        discounts: sum(sales, (s) => s.discount),
        sales: sum(sales, netSaleOf),
        cost: sum(sales, costOf),
        charged: sum(sales, (s) => s.deliveryCharge),
        courierFees: sum(sales, courierFeeOf),
        selfCosts: sum(sales, selfCostOf),
        customersPay: sum(sales, totalDueOf),
        expenses: sum(expenses.filter((e) => !isReturnLoss(e)), (e) => e.amount),
        returnLosses: sum(expenses.filter(isReturnLoss), (e) => e.amount),
        returned: allSales.filter((s) => statusOf(s) === 'returned').length,
        cancelled: allSales.filter((s) => statusOf(s) === 'cancelled').length,
        units: sum(sales, (s) => (s.items || []).reduce((u, i) => u + n(i.qty), 0)),
    };
    t.grossProfit = t.sales - t.cost;
    t.deliveryCost = t.courierFees + t.selfCosts;
    t.deliveryNet = t.charged - t.deliveryCost;
    t.orderProfit = t.grossProfit + t.deliveryNet;
    t.allExpenses = t.expenses + t.returnLosses;
    t.netProfit = t.orderProfit - t.allExpenses;
    t.receive = t.customersPay - t.deliveryCost;
    t.avgOrder = t.orders ? t.sales / t.orders : 0;
    t.returnRate = t.allOrders ? (t.returned + t.cancelled) / t.allOrders : 0;
    return t;
}

// The period just before the chosen one: whole months → the same number of months before,
// otherwise the same number of days before.
function previousRange(from, to) {
    const f = new Date(`${from}T00:00:00`);
    const t = new Date(`${to}T00:00:00`);
    const endOfMonth = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() === t.getDate();
    if (f.getDate() === 1 && endOfMonth) {
        const months = (t.getFullYear() - f.getFullYear()) * 12 + t.getMonth() - f.getMonth() + 1;
        const pf = new Date(f.getFullYear(), f.getMonth() - months, 1);
        const pt = new Date(f.getFullYear(), f.getMonth(), 0);
        const label = months === 1 ? `${MONTHS[pf.getMonth()]} ${pf.getFullYear()}` : `the ${months} months before`;
        return { from: hf.toInputDate(pf), to: hf.toInputDate(pt), label };
    }
    const days = Math.round((t - f) / 86400000) + 1;
    const pt = new Date(f); pt.setDate(pt.getDate() - 1);
    const pf = new Date(pt); pf.setDate(pf.getDate() - days + 1);
    return { from: hf.toInputDate(pf), to: hf.toInputDate(pt), label: `the ${days} days before` };
}


// ---------- Headline tiles ----------
// One stat tile. change = { now, before, goodWhenUp }
function stat({ label, value, note = '', tone = '', highlight = false, change = null }) {
    const tile = hf.create('div', { className: `stat${highlight ? ' highlight' : ''}` });
    tile.append(
        hf.create('div', { className: 'stat-label', text: label }),
        hf.create('div', { className: `stat-value ${tone}`, text: value }),
    );
    if (change) tile.append(changeChip(change));
    if (note) tile.append(hf.create('div', { className: 'stat-note', text: note }));
    return tile;
}

function changeChip({ now, before, goodWhenUp = true, points = false }) {
    if (before === null || before === undefined) return hf.create('span');
    let text;
    let diff;
    if (points) {                                   // for rates: show percentage points
        diff = (now - before) * 100;
        text = `${Math.abs(diff).toFixed(1)} pts`;
    } else if (before === 0) {
        if (now === 0) return hf.create('div', { className: 'chip chip-flat', text: 'same as before' });
        return hf.create('div', { className: 'chip chip-flat', text: 'new — nothing before' });
    } else {
        diff = (now - before) / Math.abs(before);
        text = `${Math.abs(diff * 100).toFixed(0)}%`;
    }
    if (Math.abs(diff) < 0.005) return hf.create('div', { className: 'chip chip-flat', text: 'no change' });
    const up = diff > 0;
    const good = up === goodWhenUp;
    return hf.create('div', {
        className: `chip ${good ? 'chip-good' : 'chip-bad'}`,
        text: `${up ? '▲' : '▼'} ${text}`,
        attrs: { title: `Before: ${points ? hf.percent(before) : hf.money(before)}` },
    });
}

function renderKpis(t, p) {
    const before = (key) => (p ? p[key] : null);
    const margin = t.sales ? t.netProfit / t.sales : 0;
    kpiStats.replaceChildren(
        stat({
            label: 'Net profit', value: hf.money(t.netProfit), tone: toneOf(t.netProfit), highlight: true,
            note: `${hf.percent(margin)} of sales · after all costs`, change: { now: t.netProfit, before: before('netProfit') },
        }),
        stat({
            label: 'Sales', value: hf.money(t.sales), note: `${t.orders} orders · ${t.units} items`,
            change: { now: t.sales, before: before('sales') },
        }),
        stat({
            label: 'You receive', value: hf.money(t.receive),
            note: `customers pay ${hf.money(t.customersPay)} − delivery cost ${hf.money(t.deliveryCost)}`,
            change: { now: t.receive, before: before('receive') },
        }),
        stat({
            label: 'Total delivery cost', value: hf.money(t.deliveryCost),
            note: `charged ${hf.money(t.charged)} → ${t.deliveryNet >= 0 ? 'earned' : 'lost'} ${hf.money(Math.abs(t.deliveryNet))}`,
            change: { now: t.deliveryCost, before: before('deliveryCost'), goodWhenUp: false },
        }),
        stat({
            label: 'Expenses', value: hf.money(t.allExpenses),
            note: t.returnLosses ? `incl. ${hf.money(t.returnLosses)} lost on returns` : 'rent, ads, packaging…',
            change: { now: t.allExpenses, before: before('allExpenses'), goodWhenUp: false },
        }),
        stat({
            label: 'Average order', value: hf.money(t.avgOrder),
            note: `profit per order ${hf.money(t.orders ? t.orderProfit / t.orders : 0)}`,
            change: { now: t.avgOrder, before: before('avgOrder') },
        }),
        stat({
            label: 'Return rate', value: hf.percent(t.returnRate), tone: t.returnRate > 0.1 ? 'negative' : '',
            note: `${t.returned} returned · ${t.cancelled} cancelled`,
            change: { now: t.returnRate, before: before('returnRate'), goodWhenUp: false, points: true },
        }),
    );
}


// ---------- Profit statement & cash ----------
// rows: [label, amount, { kind: 'minus' | 'plus' | 'total' | 'grand' | 'sub', note, key }]
function renderStatement(listEl, rows) {
    listEl.replaceChildren();
    for (const [label, amount, opt = {}] of rows) {
        const row = hf.create('div', { className: `st-row st-${opt.kind || 'line'}` });
        const dt = hf.create('dt');
        if (opt.key) dt.append(hf.create('i', { className: 'key', attrs: { style: `background:${opt.key}` } }));
        dt.append(document.createTextNode(label));
        if (opt.note) dt.append(hf.create('small', { text: opt.note }));
        const sign = opt.kind === 'minus' ? '− ' : opt.kind === 'plus' ? '+ ' : '';
        const dd = hf.create('dd', {
            className: ['total', 'grand'].includes(opt.kind) ? toneOf(amount) : '',
            text: `${sign}${hf.money(amount)}`,
        });
        row.append(dt, dd);
        listEl.append(row);
    }
}

function renderProfitStatement(t, sales) {
    const margin = t.sales ? t.grossProfit / t.sales : 0;
    const notDelivered = sales.filter((s) => ['pending', 'packed', 'handed'].includes(statusOf(s)));
    const atRisk = sum(notDelivered, profitOf);
    const rows = [
        ['Products sold', t.gross, { note: `${t.units} items, before discount` }],
        ['Discounts', t.discounts, { kind: 'minus' }],
        ['Sales', t.sales, { kind: 'total' }],
        ['Product cost', t.cost, { kind: 'minus', note: 'what you paid for the items sold' }],
        ['Gross profit', t.grossProfit, { kind: 'total', note: `${hf.percent(margin)} margin` }],
        ['Delivery charged to customers', t.charged, { kind: 'plus' }],
        ['Courier fees (incl. COD charge)', t.courierFees, { kind: 'minus' }],
    ];
    if (t.selfCosts) rows.push(['Self-delivery expenses', t.selfCosts, { kind: 'minus' }]);
    rows.push(
        ['Profit from orders', t.orderProfit, { kind: 'total' }],
        ['Expenses', t.expenses, { kind: 'minus', note: 'from the Expenses page' }],
    );
    if (t.returnLosses) rows.push(['Delivery lost on returns', t.returnLosses, { kind: 'minus' }]);
    rows.push(['Net profit', t.netProfit, { kind: 'grand' }]);
    renderStatement(statementList, rows);

    if (atRisk > 0) {
        statementList.append(hf.create('p', {
            className: 'hint st-hint',
            text: `${hf.money(atRisk)} of this profit is from ${notDelivered.length} orders not delivered yet — it drops if they are returned.`,
        }));
    }
}

function renderCash(t, sales) {
    let received = 0; let owes = 0; let toCollect = 0; let notShipped = 0;
    for (const s of sales) {
        const st = statusOf(s);
        const advance = Math.min(n(s.advancePaid), totalDueOf(s));
        if (isSelf(s)) {
            received += advance - n(s.courierFee);          // your delivery expense is paid out of your cash
            if (['delivered', 'paid'].includes(st)) received += codOf(s); else toCollect += codOf(s);
        } else {
            received += advance;
            if (st === 'paid') received += payoutOf(s);
            else if (['handed', 'delivered'].includes(st)) owes += payoutOf(s);
            else notShipped += payoutOf(s);
        }
    }
    const parts = [
        { label: 'Already received', value: received, color: COLORS.aqua, note: 'advances, courier payouts and cash you collected' },
        { label: 'Courier owes you', value: owes, color: COLORS.blue, note: 'handed over / collected, not paid out yet' },
        { label: 'Cash to collect (self-delivery)', value: toCollect, color: COLORS.violet },
        { label: 'Not shipped yet', value: notShipped, color: COLORS.yellow, note: 'pending / packaged orders' },
    ].filter((x) => x.value || x.label !== 'Cash to collect (self-delivery)');

    const rows = [
        ['Customers pay', t.customersPay, { note: 'products + delivery charge' }],
        ['Courier fees (incl. COD charge)', t.courierFees, { kind: 'minus' }],
    ];
    if (t.selfCosts) rows.push(['Self-delivery expenses', t.selfCosts, { kind: 'minus' }]);
    rows.push(['You receive', t.receive, { kind: 'grand' }]);
    for (const x of parts) rows.push([x.label, x.value, { kind: 'sub', key: x.color, note: x.note }]);
    renderStatement(cashList, rows);
    renderSplit(cashBar, null, parts, t.receive);   // the rows above already name each colour
}

// A thin 100% bar split into parts, plus a legend with amounts and shares
function renderSplit(barEl, legendEl, parts, total) {
    barEl.replaceChildren();
    legendEl?.replaceChildren();
    const positive = parts.filter((x) => x.value > 0);
    const whole = positive.reduce((s, x) => s + x.value, 0);
    if (!whole) { barEl.hidden = true; return; }
    barEl.hidden = false;
    barEl.setAttribute('aria-label', positive.map((x) => `${x.label} ${hf.money(x.value)}`).join(', '));
    for (const x of positive) {
        const seg = hf.create('span', { attrs: { title: `${x.label}: ${hf.money(x.value)} (${hf.percent(x.value / whole, 0)})` } });
        seg.style.flexGrow = String(x.value);
        seg.style.background = x.color;
        barEl.append(seg);
    }
    for (const x of legendEl ? parts : []) {
        const li = hf.create('li');
        li.append(
            hf.create('i', { className: 'key', attrs: { style: `background:${x.color}` } }),
            hf.create('span', { text: x.label }),
            hf.create('strong', { text: `${hf.money(x.value)}${total > 0 && x.value > 0 ? ` · ${hf.percent(x.value / total, 0)}` : ''}` }),
        );
        legendEl.append(li);
    }
}

// Every taka customers paid: product cost + delivery cost + expenses + what's left (net profit)
function renderMoneyFlow(t) {
    const parts = [
        { label: 'Product cost', value: t.cost, color: COLORS.blue },
        { label: 'Delivery cost', value: t.deliveryCost, color: COLORS.yellow },
        { label: 'Expenses', value: t.allExpenses, color: COLORS.violet },
        { label: t.netProfit >= 0 ? 'Net profit (yours)' : 'Loss', value: Math.max(t.netProfit, 0), color: COLORS.aqua },
    ];
    moneyTotal.textContent = `Out of ${hf.money(t.customersPay)} customers paid`;
    renderSplit(moneyBar, moneyLegend, parts, t.customersPay);
    if (t.netProfit < 0) {
        moneyLegend.append(hf.create('li', { className: 'negative', text: `Costs are ${hf.money(-t.netProfit)} more than what customers paid.` }));
    }
}


// ---------- Trend chart (SVG, no libraries) ----------
function buildTrend(sales) {
    const from = new Date(`${range.from}T00:00:00`);
    const todayD = new Date(`${hf.today()}T00:00:00`);
    let to = new Date(`${range.to}T00:00:00`);
    if (to > todayD && from <= todayD) to = todayD;            // don't draw empty future days
    const days = Math.round((to - from) / 86400000) + 1;
    const byMonth = days > 62;
    const buckets = new Map();
    const keyOf = (d) => (byMonth ? `${d.getFullYear()}-${d.getMonth()}` : hf.toInputDate(d));
    for (let d = new Date(from); d <= to; byMonth ? d.setMonth(d.getMonth() + 1, 1) : d.setDate(d.getDate() + 1)) {
        buckets.set(keyOf(d), {
            label: byMonth ? `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${d.getDate()} ${MONTHS[d.getMonth()]}`,
            sales: 0, profit: 0, orders: 0,
        });
    }
    for (const s of sales) {
        const b = buckets.get(keyOf(hf.toDate(s.date)));
        if (!b) continue;
        b.sales += netSaleOf(s);
        b.profit += profitOf(s);
        b.orders += 1;
    }
    return { byMonth, points: [...buckets.values()] };
}

function niceMax(v) {
    if (v <= 0) return 0;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function drawTrend(trend) {
    lastTrend = trend;
    trendTitle.textContent = `Sales & profit by ${trend.byMonth ? 'month' : 'day'}`;
    const pts = trend.points;
    trendBox.replaceChildren();
    if (!pts.length || pts.every((p) => !p.sales && !p.profit)) {
        trendBox.append(hf.create('p', { className: 'empty-note', text: 'No sales in this period yet.' }));
        return;
    }
    const W = Math.max(trendBox.clientWidth || 800, 320);
    const H = 260;
    const m = { l: 64, r: 12, t: 14, b: 30 };
    const top = niceMax(Math.max(...pts.map((p) => Math.max(p.sales, p.profit)), 1));
    const bottom = Math.min(0, ...pts.map((p) => p.profit));
    const low = bottom < 0 ? -niceMax(-bottom) : 0;
    const y = (v) => m.t + (H - m.t - m.b) * (1 - (v - low) / (top - low || 1));
    const band = (W - m.l - m.r) / pts.length;
    const x = (i) => m.l + band * i + band / 2;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => {
        const e = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
    };
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'trend-svg', role: 'img', 'aria-label': 'Sales and profit chart' });

    // Grid + y labels
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
        const v = low + ((top - low) * i) / steps;
        svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis-zero' : 'grid' }));
        const label = el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
        label.textContent = Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v));
        svg.append(label);
    }
    if (low < 0) svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: 'axis-zero' }));

    // Sales bars (rounded top, flat on the baseline)
    const bw = Math.max(Math.min(band * 0.62, 36), 2);
    pts.forEach((p, i) => {
        if (!p.sales) return;
        const x0 = x(i) - bw / 2; const y0 = y(p.sales); const yb = y(0);
        const r = Math.min(4, bw / 2, (yb - y0));
        svg.append(el('path', {
            d: `M${x0},${yb}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${yb}Z`,
            fill: COLORS.orange, class: 'bar',
        }));
    });

    // Profit line
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.profit).toFixed(1)}`).join('');
    svg.append(el('path', { d: line, fill: 'none', stroke: COLORS.blue, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // X labels (only as many as fit)
    const every = Math.max(1, Math.ceil(pts.length / Math.floor((W - m.l - m.r) / 56)));
    pts.forEach((p, i) => {
        if (i % every) return;
        const t = el('text', { x: x(i), y: H - 10, 'text-anchor': 'middle', class: 'tick' });
        t.textContent = p.label;
        svg.append(t);
    });

    // Hover: crosshair, dot and tooltip
    const cross = el('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' });
    const dot = el('circle', { r: 5, fill: COLORS.blue, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' });
    svg.append(cross, dot);
    const tip = hf.create('div', { className: 'chart-tip' });
    tip.hidden = true;
    const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
    const show = (evt) => {
        const box = svg.getBoundingClientRect();
        const i = Math.min(pts.length - 1, Math.max(0, Math.floor((evt.clientX - box.left - m.l) / band)));
        const p = pts[i];
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.profit)); dot.setAttribute('visibility', 'visible');
        tip.replaceChildren(
            hf.create('strong', { text: p.label }),
            hf.create('span', { text: `Sales ${hf.money(p.sales)}` }),
            hf.create('span', { text: `Profit ${hf.money(p.profit)}` }),
            hf.create('span', { className: 'muted', text: `${p.orders} orders` }),
        );
        tip.hidden = false;
        const left = Math.min(x(i) + 12, W - 150);
        tip.style.left = `${left}px`;
        tip.style.top = `${m.t}px`;
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => {
        tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
    });
    svg.append(hit);
    trendBox.append(svg, tip);
}


// ---------- Orders ----------
function renderOrders(allSales) {
    const active = allSales.filter(isActive);
    const count = (key) => allSales.filter((s) => statusOf(s) === key).length;
    const courierCount = (key) => allSales.filter((s) => !isSelf(s) && statusOf(s) === key).length;
    const owes = sum(active, courierOwesOf);
    const withCourier = active.filter((s) => courierOwesOf(s) > 0).length;
    const selfActive = active.filter(isSelf);
    const toCollect = sum(selfActive, selfCashDueOf);
    const shipValue = sum(active.filter(toShip), totalDueOf);
    orderStats.replaceChildren(
        stat({ label: 'To ship', value: String(active.filter(toShip).length), note: `${count('pending')} pending · ${count('packed')} packaged · ${hf.money(shipValue)}` }),
        stat({ label: 'With courier', value: String(courierCount('handed')), note: 'handed over, not collected yet' }),
        stat({ label: 'Courier owes you', value: hf.money(owes), note: `${withCourier} orders not paid out yet`, tone: owes ? 'positive' : '' }),
        stat({ label: 'Courier paid', value: String(courierCount('paid')) }),
        ...(selfActive.length ? [stat({ label: 'Self-delivery', value: String(selfActive.length), note: toCollect ? `${hf.money(toCollect)} cash still to collect` : 'all cash collected', tone: toCollect ? 'positive' : '' })] : []),
        stat({ label: 'Returned / cancelled', value: String(count('returned') + count('cancelled')), tone: count('returned') + count('cancelled') ? 'negative' : '' }),
    );
}


// ---------- Lists ----------
// Horizontal bar list: [{ label, value, text, sub }]
function renderBars(listEl, rows, emptyText) {
    listEl.replaceChildren();
    if (rows.length === 0) {
        listEl.append(hf.create('li', { className: 'empty-note', text: emptyText }));
        return;
    }
    const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
    for (const r of rows) {
        const li = hf.create('li');
        const head = hf.create('div', { className: 'bar-row' });
        head.append(hf.create('span', { text: r.label }), hf.create('span', { className: r.value < 0 ? 'negative' : '', text: r.text }));
        const track = hf.create('div', { className: 'bar-track' });
        const fill = hf.create('div', { className: `bar-fill${r.value < 0 ? ' bar-neg' : ''}` });
        fill.style.width = `${Math.max((Math.abs(r.value) / max) * 100, 2)}%`;
        track.append(fill);
        li.append(head, track);
        if (r.sub) li.append(hf.create('div', { className: 'bar-sub', text: r.sub }));
        listEl.append(li);
    }
}

function renderTopProducts(sales) {
    const byProduct = {};
    for (const s of sales) {
        for (const i of s.items || []) {
            const key = i.productId || i.itemName;
            byProduct[key] ??= { label: i.itemName, qty: 0, sales: 0, value: 0 };
            byProduct[key].qty += n(i.qty);
            byProduct[key].sales += n(i.qty) * n(i.unitPrice);
            byProduct[key].value += n(i.qty) * (n(i.unitPrice) - n(i.unitCost));
        }
    }
    const rows = Object.values(byProduct)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
        .map((r) => ({
            ...r, text: hf.money(r.value),
            sub: `${r.qty} sold · sales ${hf.money(r.sales)} · ${r.sales ? hf.percent(r.value / r.sales, 0) : '0%'} margin`,
        }));
    renderBars(topProductsList, rows, 'No sales in this period.');
}

function renderAreas(sales) {
    const byArea = {};
    for (const s of sales) {
        const key = isSelf(s) ? 'Self-delivery' : (s.deliveryZone || 'No area');
        byArea[key] ??= { label: key, orders: 0, charged: 0, cost: 0 };
        byArea[key].orders += 1;
        byArea[key].charged += n(s.deliveryCharge);
        byArea[key].cost += deliveryCostOf(s);
    }
    const rows = Object.values(byArea)
        .sort((a, b) => b.orders - a.orders)
        .map((r) => ({
            label: r.label, value: r.charged - r.cost, text: hf.money(r.charged - r.cost),
            sub: `${r.orders} orders · charged ${hf.money(r.charged)} − cost ${hf.money(r.cost)}`,
        }));
    renderBars(areaList, rows, 'No deliveries in this period.');
}

function renderExpenseCategories(expenses) {
    const byCategory = {};
    for (const e of expenses) {
        const key = isReturnLoss(e) ? 'Delivery lost on returns' : (e.category || 'Other');
        byCategory[key] ??= { total: 0, count: 0 };
        byCategory[key].total += n(e.amount);
        byCategory[key].count += 1;
    }
    const all = Object.values(byCategory).reduce((s, c) => s + c.total, 0);
    const rows = Object.entries(byCategory)
        .map(([label, c]) => ({
            label, value: c.total, text: hf.money(c.total),
            sub: `${c.count} entr${c.count === 1 ? 'y' : 'ies'} · ${all ? hf.percent(c.total / all, 0) : '0%'} of expenses`,
        }))
        .sort((a, b) => b.value - a.value);
    renderBars(expenseCategoryList, rows, 'No expenses in this period.');
}

function renderCustomers(sales) {
    const byPhone = {};
    for (const s of sales) {
        const key = s.customerPhone || s.customerName;
        byPhone[key] ??= { label: s.customerName || key, phone: s.customerPhone || '', orders: 0, value: 0 };
        byPhone[key].orders += 1;
        byPhone[key].value += netSaleOf(s);
    }
    const rows = Object.values(byPhone)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
        .map((r) => ({ ...r, text: hf.money(r.value), sub: `${r.phone} · ${r.orders} order${r.orders === 1 ? '' : 's'}` }));
    renderBars(customerList, rows, 'No customers in this period.');
}


// ---------- Accuracy checks ----------
function renderChecks(sales, products) {
    const productById = Object.fromEntries(products.map((p) => [p.id, p]));
    const invoice = (s) => s.invoiceNo || s.memoNo || '?';
    const issues = [];

    const noCost = sales.filter((s) => (s.items || []).some((i) => !n(i.unitCost)));
    if (noCost.length) {
        const missing = sum(noCost, (s) => (s.items || []).filter((i) => !n(i.unitCost))
            .reduce((t, i) => t + n(i.qty) * n(productById[i.productId]?.costPrice), 0));
        issues.push({
            title: `${noCost.length} order${noCost.length === 1 ? '' : 's'} sold items with no cost price saved`,
            text: `Their profit looks${missing ? ` about ${hf.money(missing)}` : ''} too high. Make sure the product has a cost price, then open the order on the Sales page and press "Save changes" — today's cost price is filled in.`,
            list: noCost.map(invoice),
        });
    }
    const noFee = sales.filter((s) => !isSelf(s) && !n(s.courierFee) && statusOf(s) !== 'pending');
    if (noFee.length) {
        issues.push({
            title: `${noFee.length} courier order${noFee.length === 1 ? ' has' : 's have'} no courier fee`,
            text: 'If the courier charged you, profit is too high. Edit the order and enter the fee (or choose Self-delivery).',
            list: noFee.map(invoice),
        });
    }

    checksCard.hidden = issues.length === 0;
    checksCard.replaceChildren(hf.create('h2', { text: '⚠ Check these to keep profit accurate' }));
    for (const i of issues) {
        const box = hf.create('div', { className: 'check-item' });
        box.append(hf.create('strong', { text: i.title }), hf.create('p', { text: i.text }));
        const shown = i.list.slice(0, 12).join(', ');
        box.append(hf.create('p', { className: 'hint', text: `Invoices: ${shown}${i.list.length > 12 ? ` and ${i.list.length - 12} more` : ''}` }));
        checksCard.append(box);
    }
}


// ---------- Month by month ----------
function renderMonthly(sales, expenses) {
    const months = {};
    const bucket = (ts) => {
        const d = hf.toDate(ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months[key] ??= { label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, orders: 0, sales: 0, gross: 0, delivery: 0, expenses: 0 };
        return months[key];
    };
    for (const s of sales) {
        const m = bucket(s.date);
        m.orders += 1;
        m.sales += netSaleOf(s);
        m.gross += netSaleOf(s) - costOf(s);
        m.delivery += n(s.deliveryCharge) - deliveryCostOf(s);
    }
    for (const e of expenses) bucket(e.date).expenses += n(e.amount);

    const keys = Object.keys(months).sort();
    monthlyFoot.replaceChildren();
    if (keys.length === 0) {
        hf.tableMessage(monthlyBody, 'No sales or expenses in this period.', 8);
        return;
    }

    const makeRow = (label, m, tag = 'td') => {
        const net = m.gross + m.delivery - m.expenses;
        const row = hf.create('tr');
        row.append(
            hf.create(tag, { text: label }),
            hf.create(tag, { className: 'num', text: String(m.orders) }),
            hf.create(tag, { className: 'num', text: hf.money(m.sales) }),
            hf.create(tag, { className: 'num', text: hf.money(m.gross) }),
            hf.create(tag, { className: `num ${m.delivery < 0 ? 'negative' : ''}`, text: hf.money(m.delivery) }),
            hf.create(tag, { className: 'num', text: hf.money(m.expenses) }),
            hf.create(tag, { className: `num ${toneOf(net)}`, text: hf.money(net) }),
            hf.create(tag, { className: 'num', text: m.sales ? hf.percent(net / m.sales) : '—' }),
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
        const total = { orders: 0, sales: 0, gross: 0, delivery: 0, expenses: 0 };
        for (const k of keys) for (const f of Object.keys(total)) total[f] += months[k][f];
        monthlyFoot.append(makeRow('Total', total));
    }
}


// ---------- Inventory ----------
function renderStock(products) {
    const stockValue = sum(products, (p) => Math.max(p.currentStock || 0, 0) * (p.costPrice || 0));
    const retailValue = sum(products, (p) => Math.max(p.currentStock || 0, 0) * (p.sellingPrice || 0));
    const units = sum(products, (p) => Math.max(p.currentStock || 0, 0));
    const low = products.filter((p) => stockStatus(p) === 'LOW STOCK').length;
    const out = products.filter((p) => stockStatus(p) === 'OUT OF STOCK').length;

    stockStats.replaceChildren(
        stat({ label: 'Stock value (cost)', value: hf.money(stockValue), note: `${units} units in stock` }),
        stat({ label: 'Stock value (selling)', value: hf.money(retailValue), note: `${hf.money(retailValue - stockValue)} profit if all sold` }),
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


// ---------- Load ----------
async function loadDashboard() {
    periodLabel.textContent = `Profit & loss · ${range.label}`;
    hf.tableMessage(monthlyBody, 'Loading...', 8);
    const prev = previousRange(range.from, range.to);
    try {
        const [allSales, expenses, products, prevSales, prevExpenses] = await Promise.all([
            getSales(range.from, range.to),
            getExpenses(range.from, range.to),
            getProducts(),
            getSales(prev.from, prev.to).catch(() => null),      // comparison is a bonus; never block the page
            getExpenses(prev.from, prev.to).catch(() => null),
        ]);
        const sales = allSales.filter(isActive);   // returned / cancelled don't count
        const t = totalsOf(allSales, expenses);
        const hasPrev = prevSales && prevExpenses && (prevSales.length || prevExpenses.length);
        const p = hasPrev ? totalsOf(prevSales, prevExpenses) : null;
        compareLabel.textContent = hasPrev ? `▲▼ compared with ${prev.label} (${hf.date(prev.from)} – ${hf.date(prev.to)})` : '';

        renderKpis(t, p);
        renderChecks(sales, products);
        renderProfitStatement(t, sales);
        renderCash(t, sales);
        renderMoneyFlow(t);
        drawTrend(buildTrend(sales));
        renderOrders(allSales);
        renderTopProducts(sales);
        renderAreas(sales);
        renderExpenseCategories(expenses);
        renderCustomers(sales);
        renderMonthly(sales, expenses);
        renderStock(products);
    } catch (error) {
        console.error(error);
        hf.tableMessage(monthlyBody, `Could not load dashboard: ${error.message}`, 8);
    }
}


// ---------- Start ----------
hf.sortable(monthlyBody.closest('table'));
hf.sortable(lowStockBody.closest('table'));
window.addEventListener('resize', hf.debounce(() => { if (lastTrend) drawTrend(lastTrend); }, 200));
range = createRangeFilter(hf.q('#dashboard-range'), loadDashboard);
startPage({ title: 'Dashboard', onReady: loadDashboard });
