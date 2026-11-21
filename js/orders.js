// ==============================
// orders.js — order statuses and the money maths every page shares.
//
// Money on one order:
//   items total − discount            = netSale        (what the products sold for)
//   netSale + delivery charge         = customer pays
//   customer pays − advance paid      = courier collects (cash on delivery)
//   courier collects − courier fee    = courier pays you
//   netSale − product cost + delivery charge − courier fee = your profit
// Returned / cancelled orders count as 0 and their items go back into stock.
//
// Self-delivery (deliveryMethod: 'self'): you deliver and collect the cash yourselves.
// There is no courier: the "courierFee" field holds your own delivery expense (rider, fuel...),
// the courier never owes you anything, and the statuses read "Out for delivery" → "Delivered (cash received)".
// ==============================

import { hf } from "./utils.js";

export const STATUSES = [
    { key: 'pending', label: 'Pending' },
    { key: 'packed', label: 'Packaged' },
    { key: 'handed', label: 'Handed to courier' },
    { key: 'delivered', label: 'Courier collected' },
    { key: 'paid', label: 'Courier paid' },
    { key: 'returned', label: 'Returned', inactive: true },
    { key: 'cancelled', label: 'Cancelled', inactive: true },
];

const INACTIVE = STATUSES.filter((s) => s.inactive).map((s) => s.key);

// Status names for self-delivered orders
const SELF_LABELS = { handed: 'Out for delivery', delivered: 'Delivered (cash received)', paid: 'Completed' };

export const isSelf = (sale) => sale?.deliveryMethod === 'self';

// Sales saved before statuses existed count as finished ("Courier paid")
export const statusOf = (sale) => sale.status || 'paid';
// statusLabel('handed') → "Handed to courier";  statusLabel('handed', selfSale) → "Out for delivery"
export const statusLabel = (key, sale) =>
    (isSelf(sale) && SELF_LABELS[key]) || STATUSES.find((s) => s.key === key)?.label || key;
export const isActiveStatus = (key) => !INACTIVE.includes(key || 'paid');
export const isActive = (sale) => isActiveStatus(statusOf(sale));

const n = (v) => Number(v) || 0;

// Items total − discount (worked out from the items if the sale hasn't been saved yet)
export const netSaleOf = (s) => (s.netSale !== undefined
    ? n(s.netSale)
    : (s.items || []).reduce((sum, i) => sum + n(i.qty) * n(i.unitPrice), 0) - n(s.discount));

export const deliveryNetOf = (s) => n(s.deliveryCharge) - n(s.courierFee);
export const totalDueOf = (s) => netSaleOf(s) + n(s.deliveryCharge);
export const codOf = (s) => Math.max(totalDueOf(s) - n(s.advancePaid), 0);
export const payoutOf = (s) => codOf(s) - n(s.courierFee);

// Profit including delivery (0 for returned / cancelled)
export const profitOf = (s) => (isActive(s) ? n(s.netSale) - n(s.totalCost) + deliveryNetOf(s) : 0);

// Money the courier still has to pay you (handed over or collected, not yet paid out). Never for self-delivery.
export const courierOwesOf = (s) =>
    (!isSelf(s) && isActive(s) && ['handed', 'delivered'].includes(statusOf(s)) ? payoutOf(s) : 0);

// Self-delivery: cash you still have to collect from the customer (not delivered yet)
export const selfCashDueOf = (s) =>
    (isSelf(s) && isActive(s) && ['pending', 'packed', 'handed'].includes(statusOf(s)) ? codOf(s) : 0);

// Orders you still need to pack or hand over
export const toShip = (s) => ['pending', 'packed'].includes(statusOf(s));

// Coloured status label
export function statusBadge(sale) {
    const key = statusOf(sale);
    return hf.create('span', { className: `badge st-${key}`, text: statusLabel(key, sale) });
}

// <select> of statuses. onlyActive = hide Returned/Cancelled (used when adding a new sale)
// self = use the self-delivery names. Keeps the current choice when refilled.
export function fillStatusSelect(select, { onlyActive = false, self = false } = {}) {
    const keep = select.value;
    select.replaceChildren();
    for (const s of STATUSES) {
        if (onlyActive && s.inactive) continue;
        if (self && s.key === 'paid') continue;      // nothing to be paid out when you deliver yourselves
        select.add(new Option(statusLabel(s.key, self ? { deliveryMethod: 'self' } : null), s.key));
    }
    if ([...select.options].some((o) => o.value === keep)) select.value = keep;
}
