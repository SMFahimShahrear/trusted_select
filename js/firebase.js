// ==============================
// firebase.js — connects the app to Firebase and handles all data.
// Uses Firebase from Google's CDN, so no npm install is needed.
// ==============================

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
    getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
    query, where, orderBy, writeBatch, increment, serverTimestamp, Timestamp, runTransaction,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";


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
export const db = getFirestore(app);


// ---------- Login ----------
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);
// Runs callback(user) on page load and whenever login state changes (user is null if logged out).
export const watchUser = (callback) => onAuthStateChanged(auth, callback);


// ---------- Helpers ----------
const toList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const toTimestamp = (date) => Timestamp.fromDate(new Date(date)); // accepts "2026-11-02" or a Date
const millis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

// Get records between two dates (inclusive), newest first.
async function listByDate(name, from, to) {
    if (!from || !to) throw new Error(`listByDate("${name}") needs a from and to date.`);
    const q = query(
        collection(db, name),
        where("date", ">=", toTimestamp(from)),
        where("date", "<=", toTimestamp(to)),
        orderBy("date", "desc"),
    );
    // Same-day records: newest entry first
    return toList(await getDocs(q)).sort(
        (a, b) => (millis(b.date) - millis(a.date)) || (millis(b.createdAt) - millis(a.createdAt)),
    );
}

// Add qty back to (or take it from) a product, but only if the product still exists.
async function adjustStockIfExists(batch, productId, qty) {
    const ref = doc(db, "products", productId);
    if ((await getDoc(ref)).exists()) batch.update(ref, { currentStock: increment(qty) });
}


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


// ---------- Sales (stock goes DOWN) ----------
export async function addSale(s) {
    // s = { date, memoNo, customerName, customerPhone, customerAddress, payment, discount,
    //       items: [{ productId, itemCode, itemName, qty, unitPrice, unitCost }] }
    // unitCost is saved with the sale so past profit never changes if a cost price is edited later.
    const items = s.items.map((i) => ({
        ...i, qty: Number(i.qty), unitPrice: Number(i.unitPrice), unitCost: Number(i.unitCost),
    }));
    const gross = items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
    const cost = items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
    const discount = Number(s.discount) || 0;

    const batch = writeBatch(db);
    batch.set(doc(collection(db, "sales")), {
        ...s, items, discount,
        grossSale: gross,
        netSale: gross - discount,
        totalCost: cost,
        profit: gross - discount - cost,
        date: toTimestamp(s.date), createdAt: serverTimestamp(),
    });
    for (const i of items) {
        batch.update(doc(db, "products", i.productId), { currentStock: increment(-i.qty) });
    }
    await batch.commit();
}
export const getSales = (from, to) => listByDate("sales", from, to);

// Delete a sale and put its items back into stock.
export async function deleteSale(s) {
    const batch = writeBatch(db);
    batch.delete(doc(db, "sales", s.id));
    for (const i of s.items || []) {
        await adjustStockIfExists(batch, i.productId, Number(i.qty));
    }
    await batch.commit();
}


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
