// ==============================
// app-settings.js — the settings every page uses.
// Starts from settings.json (the defaults) and applies whatever was saved on the Settings page.
// const settings = await loadSettings();   →   settings.sales.deliveryZones
// ==============================

import defaults from "../settings.json" with { type: "json" };
import { getAppSettings } from "./firebase.js";

const d = defaults;

// The Bangla message sent to customers (editable on the Settings page).
// A line disappears when its {discount}, {advance}, {deliveryTime}, {notes} or {contact} is empty.
export const DEFAULT_SUMMARY = `প্রিয় {name},
{business}-এ অর্ডার করার জন্য ধন্যবাদ! অনুগ্রহ করে আপনার অর্ডারের তথ্যগুলো মিলিয়ে নিন:

অর্ডার নম্বর: {orderNo}
নাম: {name}
ফোন: {phone}
ঠিকানা: {address}

পণ্য:
{items}

পণ্যের মূল্য: {subtotal}
ছাড়: {discount}
ডেলিভারি চার্জ ({area}): {delivery}
সর্বমোট: {total}
অগ্রিম পরিশোধ: {advance}
ডেলিভারির সময় পরিশোধ করতে হবে: {due}
আনুমানিক ডেলিভারি সময়: {deliveryTime}
নোট: {notes}

কোনো তথ্য ভুল থাকলে দয়া করে এখনই আমাদের জানান। পণ্য হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে নিয়ে মূল্য পরিশোধ করবেন।
ধন্যবাদ — {business}
যোগাযোগ: {contact}`;

export const DEFAULT_SETTINGS = {
    products: {
        codePrefix: d.products?.codePrefix ?? 'TS-',
        defaultUnit: d.products?.defaultUnit ?? 'pcs',
        defaultLowStockAlert: d.products?.defaultLowStockAlert ?? 2,
        categories: d.products?.categories ?? ['Other'],
        units: d.products?.units ?? ['pcs'],
    },
    sales: {
        invoicePrefix: d.sales?.invoicePrefix ?? '',   // invoice = prefix + yy + 00001 (restarts every year)
        defaultPayment: d.sales?.defaultPayment ?? 'Cash',
        paymentMethods: d.sales?.paymentMethods ?? ['Cash'],
        deliveryZones: d.sales?.deliveryZones ?? [
            { name: 'Inside Mirpur', charge: 50, courierFee: 50, orderPrefix: 'ID', deliveryTime: '1-2 days' },
            { name: 'Inside Dhaka', charge: 70, courierFee: 60, orderPrefix: 'ID', deliveryTime: '1-2 days' },
            { name: 'Outside Dhaka', charge: 130, courierFee: 110, orderPrefix: 'OD', deliveryTime: '3-5 days' },
        ],
        defaultZone: d.sales?.defaultZone ?? 'Inside Dhaka',
        freeDeliveryOver: d.sales?.freeDeliveryOver ?? 0,
        codChargePercent: d.sales?.codChargePercent ?? 0,   // courier's cash-on-delivery charge, % of what they collect
        contactPhone: d.sales?.contactPhone ?? '',          // shown in the Bangla order message
        summaryTemplate: '',                                // '' = use DEFAULT_SUMMARY
    },
    expenses: {
        categories: d.expenses?.categories ?? ['Other'],
        paidBy: d.expenses?.paidBy ?? ['Cash'],
    },
};

// Saved values win; anything not saved falls back to the default.
export async function loadSettings() {
    let saved = {};
    try {
        saved = await getAppSettings();
    } catch (error) {
        console.error('Could not load saved settings, using defaults.', error);
    }
    const sales = { ...DEFAULT_SETTINGS.sales, ...saved.sales };
    // Zones saved before these fields existed: fee 0, prefix OD for "outside", otherwise ID
    sales.deliveryZones = sales.deliveryZones.map((z) => ({
        name: z.name,
        charge: Number(z.charge) || 0,
        courierFee: Number(z.courierFee) || 0,
        orderPrefix: z.orderPrefix ?? (/outside/i.test(z.name) ? 'OD' : 'ID'),
        deliveryTime: z.deliveryTime ?? (/outside/i.test(z.name) ? '3-5 days' : '1-2 days'),
    }));
    return {
        products: { ...DEFAULT_SETTINGS.products, ...saved.products },
        sales,
        expenses: { ...DEFAULT_SETTINGS.expenses, ...saved.expenses },
    };
}
