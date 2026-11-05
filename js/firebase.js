// ==============================
// firebase.js — connects the app to Firebase and handles all data.
// Uses Firebase from Google's CDN, so no npm install is needed.
// ==============================

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
    initializeFirestore, collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
    query, where, orderBy, writeBatch, increment, serverTimestamp, Timestamp, runTransaction,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { isActive, isActiveStatus } from "./orders.js";


// Your project config (safe to publish; the Security Rules protect the data).
const firebaseConfig = {
    apiKey: "AIzaSyDGv4kEVuiwHL6dUQD7CWeJvnV8vFYHsXU",
    authDomain: "trusted-select-db.firebaseapp.com",
    projectId: "trusted-select-db",
    storageBucket: "trusted-select-db.firebasestorage.app",
    messagingSenderId: "638058416404",
    appId: "1:638058416404:web:b767de0e599eb6569e9a01",
    measurementId: "G-ZF9GMCLQ31"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// ignoreUndefinedProperties: a missing value is skipped instead of failing the whole save
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });


// ---------- Login ----------
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);
// Runs callback(user) on page load and whenever login state changes (user is null if logged out).
export const watchUser = (callback) => onAuthStateChanged(auth, callback);


// ---------- Helpers ----------
const toList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const toTimestamp = (date) => Timestamp.fromDate(new Date(date)); // accepts "2026-11-02" or a Date
const millis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const newestFirst = (a, b) => (millis(b.date) - millis(a.date)) || (millis(b.createdAt) - millis(a.createdAt));

// Get records between two dates (inclusive), newest first.
async function listByDate(name, from, to) {
    if (!from || !to) throw new Error(`listByDate("${name}") needs a from and to date.`);
    const q = query(
        collection(db, name),
        where("date", ">=", toTimestamp(from)),
        where("date", "<=", toTimestamp(to)),
        orderBy("date", "desc"),
    );
    return toList(await getDocs(q)).sort(newestFirst);
}

// Add qty back to (or take it from) a product, but only if the product still exists.
async function adjustStockIfExists(batch, productId, qty) {
    if (!productId) return;
    const ref = doc(db, "products", productId);
    if ((await getDoc(ref)).exists()) batch.update(ref, { currentStock: increment(qty) });
}


// ---------- App settings (the Settings page) ----------
// Stored in one document: settings/app
const settingsRef = doc(db, "settings", "app");

export async function getAppSettings() {
    const snap = await getDoc(settingsRef);
    return snap.exists() ? snap.data() : {};
}

export const saveAppSettings = (data) => setDoc(settingsRef, { ...data, updatedAt: serverTimestamp() });


// ---------- Track Data (counters) ----------
export async function getTrackData() {
    return toList(await getDocs(query(collection(db, "Track Data"))));
}

export function addtrackData() {
    return addDoc(collection(db, "Track Data"), { ProductCount: 0 });
}

export function updateTrackData(id, changes) {
    return updateDoc(doc(db, "Track Data", id), changes);
}

// Add 1 to a counter in Track Data and return the new number.
// nextTrackNumber("ProductCount")       → 1, 2, 3...
// nextTrackNumber("SaleCount", 1001)    → 1001, 1002...
export async function nextTrackNumber(field, startAt = 1) {
    let list = await getTrackData();
    if (list.length === 0) {
        await addtrackData();
        list = await getTrackData();
    }
    const ref = doc(db, "Track Data", list[0].id);

    // A transaction hands out numbers one at a time, so two people never get the same one.
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data()[field];
        const next = typeof current === 'number' ? Math.max(current + 1, startAt) : startAt;
        tx.update(ref, { [field]: next });
        return next;
    });
}


// ---------- Products ----------
export async function getProducts() {
    return toList(await getDocs(query(collection(db, "products"), orderBy("name"))));
}

export function addProduct(p) {
    // p = { itemCode, name, category, unit, costPrice, sellingPrice, openingStock, lowStockAlert }
    return addDoc(collection(db, "products"), {
        ...p,
        currentStock: Number(p.openingStock) || 0,
        createdAt: serverTimestamp(),
    });
}

export const updateProduct = (id, changes) => updateDoc(doc(db, "products", id), changes);
export const deleteProduct = (id) => deleteDoc(doc(db, "products", id));


// ---------- Purchases (stock goes UP) ----------
export async function addPurchase(p) {
    // p = { date, productId, itemCode, itemName, qty, unitCost, supplier, note }
    const batch = writeBatch(db); // both writes succeed together or not at all
    batch.set(doc(collection(db, "purchases")), {
        ...p, qty: Number(p.qty), unitCost: Number(p.unitCost),
        date: toTimestamp(p.date), createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "products", p.productId), { currentStock: increment(Number(p.qty)) });
    await batch.commit();
}
export const getPurchases = (from, to) => listByDate("purchases", from, to);

// Delete a purchase and take its qty back out of stock.
export async function deletePurchase(p) {
    const batch = writeBatch(db);
    batch.delete(doc(db, "purchases", p.id));
    await adjustStockIfExists(batch, p.productId, -Number(p.qty));
    await batch.commit();
}


// ---------- Customers (one document per phone number) ----------
export async function getCustomers() {
    return toList(await getDocs(collection(db, "customers")));
}

export async function getCustomer(phone) {
    if (!phone) return null;
    const snap = await getDoc(doc(db, "customers", phone));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// All sales for one phone number, newest first
export async function getCustomerSales(phone) {
    const q = query(collection(db, "sales"), where("customerPhone", "==", phone));
    return toList(await getDocs(q)).sort(newestFirst);
}

// Change a customer's totals inside a batch.
// ordersDelta / spentDelta can be negative. info = the sale (for name, address...), or null.
async function applyCustomer(batch, phone, ordersDelta, spentDelta, info, saleDate) {
    if (!phone) return;
    const ref = doc(db, "customers", phone);
    const prev = (await getDoc(ref)).data();
    const newCount = (prev?.orderCount || 0) + ordersDelta;

    if (newCount <= 0 && !prev?.blacklisted) {   // no active orders left
        if (prev) batch.delete(ref);
        return;
    }

    const data = {
        phone,
        orderCount: increment(ordersDelta),
        totalSpent: increment(spentDelta),
        updatedAt: serverTimestamp(),
    };
    if (info) {
        data.name = info.customerName || prev?.name || '';
        data.address = info.customerAddress || prev?.address || '';
        data.email = info.customerEmail || prev?.email || '';
        data.deliveryZone = info.deliveryZone || prev?.deliveryZone || '';
    }
    if (saleDate) {
        const t = millis(saleDate);
        data.firstOrderDate = prev?.firstOrderDate && millis(prev.firstOrderDate) <= t ? prev.firstOrderDate : saleDate;
        data.lastOrderDate = prev?.lastOrderDate && millis(prev.lastOrderDate) >= t ? prev.lastOrderDate : saleDate;
    }
    batch.set(ref, data, { merge: true });
}

// Rebuild every customer from the sales history (use once for old sales, or to fix totals).
export async function rebuildCustomers() {
    const [sales, customers] = await Promise.all([
        getDocs(collection(db, "sales")).then(toList),
        getCustomers(),
    ]);

    const byPhone = {};
    for (const s of sales.sort((a, b) => millis(a.date) - millis(b.date))) {   // oldest → newest
        if (!s.customerPhone || !isActive(s)) continue;
        const c = byPhone[s.customerPhone] ??= {
            phone: s.customerPhone, orderCount: 0, totalSpent: 0,
            firstOrderDate: s.date, lastOrderDate: s.date,
        };
        c.name = s.customerName || c.name || '';
        c.address = s.customerAddress || c.address || '';
        c.email = s.customerEmail || c.email || '';
        c.deliveryZone = s.deliveryZone || c.deliveryZone || '';
        c.orderCount += 1;
        c.totalSpent += Number(s.netSale) || 0;
        c.lastOrderDate = s.date;
    }

    // Keep blacklist information
    const keepBlacklist = (c) => (c.blacklisted
        ? { blacklisted: true, blacklistReason: c.blacklistReason || '', blacklistedAt: c.blacklistedAt || null }
        : {});
    for (const c of customers) {
        if (byPhone[c.id]) Object.assign(byPhone[c.id], keepBlacklist(c));
    }

    // Firestore batches hold max 500 writes, so write in chunks
    const writes = [
        ...Object.values(byPhone).map((c) => ['set', doc(db, "customers", c.phone), c]),
        ...customers.filter((c) => !byPhone[c.id]).map((c) => (c.blacklisted
            ? ['set', doc(db, "customers", c.id), { ...c, orderCount: 0, totalSpent: 0 }]
            : ['delete', doc(db, "customers", c.id)])),
    ];
    for (let i = 0; i < writes.length; i += 450) {
        const batch = writeBatch(db);
        for (const [type, ref, data] of writes.slice(i, i + 450)) {
            if (type === 'set') {
                const { id: _id, ...clean } = data;
                batch.set(ref, { ...clean, updatedAt: serverTimestamp() });
            } else {
                batch.delete(ref);
            }
        }
        await batch.commit();
    }
    return Object.keys(byPhone).length;
}


// Add / remove a phone number from the blacklist (works for numbers that never ordered too)
export async function setBlacklist(phone, blacklisted, reason = '', name = '') {
    const ref = doc(db, "customers", phone);
    const prev = (await getDoc(ref)).data();
    if (!blacklisted && prev && !(prev.orderCount > 0)) {
        await deleteDoc(ref);                 // was only on the list because of the blacklist
        return;
    }
    await setDoc(ref, {
        phone,
        ...(prev ? {} : { name, orderCount: 0, totalSpent: 0 }),
        blacklisted,
        blacklistReason: blacklisted ? reason : '',
        blacklistedAt: blacklisted ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}


// ---------- Sales (stock goes DOWN) ----------
// A sale = { date, status, invoiceNo, orderNo, customerName, customerPhone, customerAddress, customerEmail,
//            payment, discount, advancePaid, deliveryZone, deliveryCharge, courierFee,
//            items: [{ productId, itemCode, itemName, qty, unitPrice, unitCost }] }
// unitCost is saved with the sale so past profit never changes if a cost price is edited later.
// Returned / cancelled sales don't hold stock and don't count for the customer.

// Work out all the totals stored on a sale
function saleTotals(s, status) {
    const items = (s.items || []).map((i) => ({
        ...i, qty: Number(i.qty), unitPrice: Number(i.unitPrice), unitCost: Number(i.unitCost) || 0,
    }));
    const gross = items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
    const cost = items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
    const discount = Number(s.discount) || 0;
    const deliveryCharge = Number(s.deliveryCharge) || 0;
    const courierFee = Number(s.courierFee) || 0;
    const advancePaid = Number(s.advancePaid) || 0;
    const netSale = gross - discount;
    return {
        items, discount, deliveryCharge, courierFee, advancePaid,
        grossSale: gross,
        netSale,
        totalDue: netSale + deliveryCharge,
        totalCost: cost,
        profit: isActiveStatus(status) ? netSale - cost + deliveryCharge - courierFee : 0,
    };
}

const toTs = (d) => (d && typeof d.toDate === 'function' ? d : toTimestamp(d));

export async function addSale(s) {
    const status = s.status || 'pending';
    const t = saleTotals(s, status);
    const saleDate = toTs(s.date);

    const batch = writeBatch(db);
    batch.set(doc(collection(db, "sales")), {
        ...s, ...t, status, date: saleDate,
        statusUpdatedAt: serverTimestamp(), createdAt: serverTimestamp(),
    });
    if (isActiveStatus(status)) {
        for (const i of t.items) {
            batch.update(doc(db, "products", i.productId), { currentStock: increment(-i.qty) });
        }
        await applyCustomer(batch, s.customerPhone, 1, t.netSale, s, saleDate);
    }
    await batch.commit();
}

// Save changes to an existing sale. Works out stock and customer differences automatically.
// Also used for status-only changes: updateSale(sale, { ...sale, status: 'handed' })
export async function updateSale(old, changes) {
    const { id: _id, ...s } = changes;
    const oldStatus = old.status || 'paid';
    const status = s.status || oldStatus;
    const t = saleTotals(s, status);
    const saleDate = toTs(s.date);
    const oldActive = isActiveStatus(oldStatus);
    const newActive = isActiveStatus(status);

    // Stock: give back what the old version took, take what the new version needs
    const stock = {};
    if (oldActive) for (const i of old.items || []) stock[i.productId] = (stock[i.productId] || 0) + Number(i.qty);
    if (newActive) for (const i of t.items) stock[i.productId] = (stock[i.productId] || 0) - i.qty;

    const batch = writeBatch(db);
    batch.set(doc(db, "sales", old.id), {
        ...s, ...t, status, date: saleDate,
        createdAt: old.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        statusUpdatedAt: status !== oldStatus ? serverTimestamp() : (old.statusUpdatedAt || serverTimestamp()),
    });
    for (const [productId, qty] of Object.entries(stock)) {
        if (qty !== 0) await adjustStockIfExists(batch, productId, qty);
    }

    // Customer totals
    const oldOrders = oldActive ? 1 : 0;
    const oldSpent = oldActive ? Number(old.netSale) || 0 : 0;
    const newOrders = newActive ? 1 : 0;
    const newSpent = newActive ? t.netSale : 0;
    if (old.customerPhone && old.customerPhone === s.customerPhone) {
        await applyCustomer(batch, s.customerPhone, newOrders - oldOrders, newSpent - oldSpent, s, newActive ? saleDate : null);
    } else {
        await applyCustomer(batch, old.customerPhone, -oldOrders, -oldSpent, null, null);
        await applyCustomer(batch, s.customerPhone, newOrders, newSpent, s, newActive ? saleDate : null);
    }

    await batch.commit();
}

export const getSales = (from, to) => listByDate("sales", from, to);

export async function getSale(id) {
    const snap = await getDoc(doc(db, "sales", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Delete a sale, put its items back into stock, and update the customer.
export async function deleteSale(s) {
    const batch = writeBatch(db);
    batch.delete(doc(db, "sales", s.id));
    if (isActive(s)) {
        for (const i of s.items || []) {
            await adjustStockIfExists(batch, i.productId, Number(i.qty));
        }
        await applyCustomer(batch, s.customerPhone, -1, -(Number(s.netSale) || 0), null, null);
    }
    await batch.commit();
}

// ----- Finding sales that don't show up -----
// Every sale (used only when the list is empty, to look for problems)
export async function getAllSales() {
    return toList(await getDocs(collection(db, "sales"))).sort(newestFirst);
}

// true if the sale's date is a real Firestore date (needed for the date filter)
export const hasValidDate = (s) => Boolean(s.date && typeof s.date.toMillis === 'function');

// Turn whatever is in "date" into a proper date so the sale shows in the list again
export async function repairSaleDates(sales) {
    const read = (v) => {
        if (v && typeof v === 'object' && 'seconds' in v) return new Date(v.seconds * 1000);
        if (typeof v === 'string' || typeof v === 'number') {
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? null : d;
        }
        return null;
    };
    const broken = sales.filter((s) => !hasValidDate(s));
    for (let i = 0; i < broken.length; i += 450) {
        const batch = writeBatch(db);
        for (const s of broken.slice(i, i + 450)) {
            const date = read(s.date) || (s.createdAt?.toDate ? s.createdAt.toDate() : new Date());
            batch.update(doc(db, "sales", s.id), { date: Timestamp.fromDate(date) });
        }
        await batch.commit();
    }
    return broken.length;
}


// ---------- Print templates (Word .docx files, stored as text) ----------
// A Firestore document holds at most 1 MB, so templates must be under about 700 KB.
export async function getTemplate(kind) {
    const snap = await getDoc(doc(db, "templates", kind));
    return snap.exists() ? snap.data() : null;
}

export const saveTemplate = (kind, { name, size, data }) =>
    setDoc(doc(db, "templates", kind), { name, size, data, updatedAt: serverTimestamp() });

export const deleteTemplate = (kind) => deleteDoc(doc(db, "templates", kind));


// ---------- Expenses ----------
export function addExpense(e) {
    // e = { date, category, details, amount, paidBy }
    return addDoc(collection(db, "expenses"), {
        ...e, amount: Number(e.amount), date: toTimestamp(e.date), createdAt: serverTimestamp(),
    });
}
export const getExpenses = (from, to) => listByDate("expenses", from, to);
export const deleteExpense = (id) => deleteDoc(doc(db, "expenses", id));


// ---------- Stock status ----------
export function stockStatus(p) {
    if (p.currentStock <= 0) return "OUT OF STOCK";
    if (p.currentStock <= (p.lowStockAlert || 0)) return "LOW STOCK";
    return "In Stock";
}
