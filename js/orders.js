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

// Sales saved before statuses existed count as finished ("Courier paid")
export const statusOf = (sale) => sale.status || 'paid';
export const statusLabel = (key) => STATUSES.find((s) => s.key === key)?.label || key;
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

// Money the courier still has to pay you (handed over or collected, not yet paid out)
export const courierOwesOf = (s) =>
    (isActive(s) && ['handed', 'delivered'].includes(statusOf(s)) ? payoutOf(s) : 0);

// Orders you still need to pack or hand over
export const toShip = (s) => ['pending', 'packed'].includes(statusOf(s));

// Coloured status label
export function statusBadge(sale) {
    const key = statusOf(sale);
    return hf.create('span', { className: `badge st-${key}`, text: statusLabel(key) });
}

// <select> of statuses. onlyActive = hide Returned/Cancelled (used when adding a new sale)
export function fillStatusSelect(select, { onlyActive = false } = {}) {
    select.replaceChildren();
    for (const s of STATUSES) {
        if (onlyActive && s.inactive) continue;
        select.add(new Option(s.label, s.key));
    }
}
