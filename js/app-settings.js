// ==============================
// app-settings.js — the settings every page uses.
// Starts from settings.json (the defaults) and applies whatever was saved on the Settings page.
// const settings = await loadSettings();   →   settings.sales.deliveryZones
// ==============================

import defaults from "../settings.json" with { type: "json" };
import { getAppSettings } from "./firebase.js";

const d = defaults;

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
            { name: 'Inside Mirpur', charge: 50, courierFee: 50, orderPrefix: 'ID' },
            { name: 'Inside Dhaka', charge: 70, courierFee: 60, orderPrefix: 'ID' },
            { name: 'Outside Dhaka', charge: 130, courierFee: 110, orderPrefix: 'OD' },
        ],
        defaultZone: d.sales?.defaultZone ?? 'Inside Dhaka',
        freeDeliveryOver: d.sales?.freeDeliveryOver ?? 0,
        codChargePercent: d.sales?.codChargePercent ?? 0,   // courier's cash-on-delivery charge, % of what they collect
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
    }));
    return {
        products: { ...DEFAULT_SETTINGS.products, ...saved.products },
        sales,
        expenses: { ...DEFAULT_SETTINGS.expenses, ...saved.expenses },
    };
}
