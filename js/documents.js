// ==============================
// documents.js — everything that turns an order into something to send or print:
//   orderData()        the values that fill the {placeholders} in the Word templates
//   banglaSummary()    a short Bangla message with the order details, to copy and send
//   openSummary()      pop-up with that message + Copy / SMS / WhatsApp buttons
//   openOtp()          pop-up to send a code to the customer and confirm their phone number
// ==============================

import { hf } from "./utils.js";
import { statusLabel, statusOf, codOf, totalDueOf } from "./orders.js";
import { patchSale, patchCustomer } from "./firebase.js";
import { DEFAULT_SUMMARY } from "./app-settings.js";
import businessDefaults from "../settings.json" with { type: "json" };

const BUSINESS = businessDefaults.business?.name || 'Trusted Select';
const MFS = ['bkash', 'nagad', 'rocket', 'upay', 'mfs', 'tap'];
const BANK = ['bank', 'card'];
const CONFIRMATION_ROWS = 6;      // the order confirmation table always shows at least this many rows

const fixed = (n) => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0');
const plain = (n) => hf.money(n).replace(/^[^\d−-]*\s/, '');     // "Tk 1,830" → "1,830"
const box = (checked) => (checked ? '☒' : '☐');
const pad = (n) => String(n).padStart(2, '0');

function dateDots(value) {
    if (!value) return '';
    const d = hf.toDate(value);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// ---------- Template data ----------
export function orderData(sale, settings) {
    const items = (sale.items || []).map((i, index) => ({
        no: index + 1,
        name: i.itemName || '',
        code: i.itemCode || '',
        qty: i.qty,
        qty2: pad(i.qty),
        price: hf.money(i.unitPrice),
        priceAmount: plain(i.unitPrice),
        priceFixed: fixed(i.unitPrice),
        lineTotal: hf.money(i.qty * i.unitPrice),
        lineTotalAmount: plain(i.qty * i.unitPrice),
        lineTotalFixed: fixed(i.qty * i.unitPrice),
    }));
    // Confirmation table: the items, then empty numbered rows so the table keeps its size
    const rows = [...items];
    for (let n = items.length + 1; n <= CONFIRMATION_ROWS; n++) {
        rows.push({ no: n, name: '', code: '', qty: '', qty2: '', price: '', priceFixed: '', lineTotal: '', lineTotalFixed: '' });
    }

    const amounts = {
        subtotal: sale.grossSale ?? (sale.items || []).reduce((s, i) => s + i.qty * i.unitPrice, 0),
        discount: sale.discount || 0,
        deliveryCharge: sale.deliveryCharge || 0,
        total: totalDueOf(sale),
        advancePaid: sale.advancePaid || 0,
        due: codOf(sale),
    };
    const payment = (sale.payment || '').toLowerCase();
    const zone = settings?.sales?.deliveryZones?.find((z) => z.name === sale.deliveryZone);

    const data = {
        businessName: BUSINESS,
        invoiceNo: sale.invoiceNo || sale.memoNo || '',
        orderNo: sale.orderNo || '',
        date: hf.date(sale.date),
        dateDots: dateDots(sale.date),
        printedOn: hf.date(new Date()),
        status: statusLabel(statusOf(sale)),
        payment: sale.payment || '',
        paymentStatus: amounts.due <= 0 ? 'Paid' : (amounts.advancePaid > 0 ? 'Partly paid' : 'Cash on delivery'),
        trxId: sale.trxId || '',
        trxIdLine: sale.trxId || '_______________________',
        customerName: sale.customerName || '',
        customerPhone: sale.customerPhone || '',
        customerAddress: sale.customerAddress || '',
        customerEmail: sale.customerEmail || '',
        deliveryZone: sale.deliveryZone || '',
        estDelivery: zone?.deliveryTime || '',
        notes: sale.notes || '',
        items,
        rows,
        itemCount: items.reduce((s, i) => s + Number(i.qty), 0),
        // Ticks for the invoice's payment boxes
        codBox: box(amounts.due > 0),
        bankBox: box(BANK.some((m) => payment.includes(m))),
        mfsBox: box(MFS.some((m) => payment.includes(m))),
        cashBox: box(payment.includes('cash') && amounts.due <= 0),
        paidBox: box(amounts.due <= 0),
        partBox: box(amounts.advancePaid > 0 && amounts.due > 0),
        unpaidBox: box(amounts.advancePaid <= 0 && amounts.due > 0),
    };
    for (const [key, value] of Object.entries(amounts)) {
        data[key] = hf.money(value);              // "Tk 1,830"
        data[`${key}Amount`] = plain(value);       // "1,830"
        data[`${key}Fixed`] = fixed(value);        // "1,830.00"
    }
    return data;
}


// ---------- Bangla message ----------
// Placeholders: {name} {phone} {address} {orderNo} {invoiceNo} {date} {items} {subtotal} {discount} {area}
// {delivery} {total} {advance} {due} {deliveryTime} {payment} {notes} {business} {contact}
const OPTIONAL = ['discount', 'advance', 'deliveryTime', 'notes', 'contact'];   // line removed when empty

export function banglaSummary(sale, settings) {
    const due = codOf(sale);
    const subtotal = sale.grossSale ?? (sale.items || []).reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const zone = settings?.sales?.deliveryZones?.find((z) => z.name === sale.deliveryZone);
    const time = zone?.deliveryTime
        ? hf.bn(zone.deliveryTime).replace(/\bdays?\b/gi, 'দিন').replace(/\bhours?\b/gi, 'ঘণ্টা')
        : '';
    const values = {
        name: sale.customerName || 'গ্রাহক',
        phone: hf.bn(sale.customerPhone || ''),
        address: sale.customerAddress || '',
        orderNo: sale.orderNo || sale.invoiceNo || '',
        invoiceNo: sale.invoiceNo || sale.memoNo || '',
        date: hf.bn(hf.date(sale.date || new Date())),
        items: (sale.items || []).map((i) => `• ${i.itemName} × ${hf.bn(i.qty)} = ${hf.bnMoney(i.qty * i.unitPrice)}`).join('\n'),
        subtotal: hf.bnMoney(subtotal),
        discount: sale.discount ? hf.bnMoney(sale.discount) : '',
        area: sale.deliveryZone || '',
        delivery: hf.bnMoney(sale.deliveryCharge || 0),
        total: hf.bnMoney(totalDueOf(sale)),
        advance: sale.advancePaid ? hf.bnMoney(sale.advancePaid) : '',
        due: due > 0 ? hf.bnMoney(due) : `${hf.bnMoney(0)} (সম্পূর্ণ পরিশোধিত ✅)`,
        deliveryTime: time,
        payment: sale.payment || '',
        notes: sale.notes || '',
        business: BUSINESS,
        contact: hf.bn(settings?.sales?.contactPhone || ''),
    };
    const template = settings?.sales?.summaryTemplate?.trim() ? settings.sales.summaryTemplate : DEFAULT_SUMMARY;
    return template
        .split('\n')
        .filter((line) => !OPTIONAL.some((key) => line.includes(`{${key}}`) && !values[key]))
        .map((line) => line.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match)))
        .join('\n')
        .replace(/\(\)/g, '')                // "()" left when the area is empty
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Links that open the phone's SMS app / WhatsApp with the message filled in
const smsLink = (phone, text) => `sms:${phone}?&body=${encodeURIComponent(text)}`;
const whatsappLink = (phone, text) => `https://wa.me/88${phone}?text=${encodeURIComponent(text)}`;

function sendButtons(phone, getText, onCopied) {
    const copyBtn = hf.create('button', { className: 'btn btn-primary', text: 'Copy message', attrs: { type: 'button' } });
    copyBtn.addEventListener('click', async () => {
        const ok = await hf.copy(getText());
        copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy message'; }, 1800);
        if (ok && onCopied) onCopied();
    });
    const sms = hf.create('a', { className: 'btn btn-ghost', text: 'Open SMS', attrs: { href: '#', title: 'Opens the messages app (on a phone)' } });
    sms.addEventListener('click', (e) => { e.preventDefault(); location.href = smsLink(phone, getText()); });
    const wa = hf.create('a', { className: 'btn btn-ghost', text: 'WhatsApp', attrs: { href: '#', target: '_blank', rel: 'noopener' } });
    wa.addEventListener('click', (e) => { e.preventDefault(); window.open(whatsappLink(phone, getText()), '_blank', 'noopener'); });
    return [copyBtn, sms, wa];
}

export function openSummary(sale, settings) {
    const body = hf.create('div', { className: 'stack' });
    body.append(hf.create('p', { className: 'hint', text: 'You can edit the text before copying.' }));
    const text = hf.create('textarea', { attrs: { 'aria-label': 'Order summary in Bangla' } });
    text.value = banglaSummary(sale, settings);
    body.append(text);
    hf.modal({
        title: `বাংলা অর্ডার সামারি · ${sale.orderNo || sale.invoiceNo || ''}`,
        body,
        wide: true,
        actions: sendButtons(sale.customerPhone, () => text.value),
    });
}


// ---------- Phone check (OTP) ----------
// Real automatic SMS needs a paid SMS service and a server, so this is the manual version:
// the app makes a code, you send it (copy / SMS / WhatsApp), the customer replies with it, you type it in.
function newCode() {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000;   // 4 digits, 1000–9999
    return String(n);
}

const otpText = (sale, code) =>
    `${BUSINESS}: আপনার অর্ডার ${sale.orderNo || sale.invoiceNo || ''} নিশ্চিত করতে এই কোডটি আমাদের পাঠান: ${hf.bn(code)} (${code})`;

export function openOtp(sale, onChange) {
    let code = sale.otpCode || '';
    const body = hf.create('div', { className: 'stack' });

    if (sale.phoneVerified) {
        body.append(hf.create('p', {
            className: 'notice ok',
            text: `✓ ${sale.customerPhone} was verified${sale.verifiedAt ? ` on ${hf.date(sale.verifiedAt)}` : ''}.`,
        }));
    }
    body.append(hf.create('p', { text: `Customer: ${sale.customerName || ''} · ${sale.customerPhone || ''}` }));

    const codeBox = hf.create('div', { className: 'otp-code', text: code || '— — — —' });
    const makeBtn = hf.create('button', { className: 'btn btn-ghost btn-sm', text: code ? 'Make a new code' : 'Make a code', attrs: { type: 'button' } });
    const status = hf.create('p', { className: 'form-message' });
    body.append(codeBox, makeBtn);

    const preview = hf.create('textarea', { attrs: { rows: '3', 'aria-label': 'Message with the code' } });
    preview.style.minHeight = '90px';
    preview.value = code ? otpText(sale, code) : '';
    body.append(hf.create('span', { className: 'field-label', text: 'Message to send' }), preview);

    body.append(hf.create('span', { className: 'field-label', text: 'Code the customer sent back' }));
    const row = hf.create('div', { className: 'otp-row' });
    const input = hf.create('input', { attrs: { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '0000', 'aria-label': 'Code from customer' } });
    const verifyBtn = hf.create('button', { className: 'btn btn-primary', text: 'Verify', attrs: { type: 'button' } });
    row.append(input, verifyBtn);
    body.append(row, status);

    const markBtn = hf.create('button', { className: 'btn btn-ghost btn-sm', text: 'Mark verified without code (confirmed by call)', attrs: { type: 'button' } });
    body.append(markBtn);

    const markVerified = async (how) => {
        await patchSale(sale.id, { phoneVerified: true, verifiedAt: new Date(), verifiedBy: how });
        await patchCustomer(sale.customerPhone, { phoneVerified: true });
        sale.phoneVerified = true;
        hf.message(status, '✓ Phone number verified', 'success', 0);
        if (onChange) onChange();
    };

    makeBtn.addEventListener('click', async () => {
        code = newCode();
        try {
            await patchSale(sale.id, { otpCode: code, otpCreatedAt: new Date() });
            sale.otpCode = code;
            codeBox.textContent = code;
            preview.value = otpText(sale, code);
            makeBtn.textContent = 'Make a new code';
            hf.message(status, 'Code saved. Send it to the customer.', 'success');
        } catch (error) {
            hf.message(status, `Could not save code: ${error.message}`, 'error', 0);
        }
    });
    verifyBtn.addEventListener('click', async () => {
        const typed = input.value.replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).trim();   // accepts Bangla digits too
        if (!code) return hf.message(status, 'Make and send a code first.', 'error');
        if (typed !== code) return hf.message(status, '✗ Code does not match.', 'error', 0);
        try { await markVerified('code'); } catch (error) { hf.message(status, error.message, 'error', 0); }
    });
    markBtn.addEventListener('click', async () => {
        try { await markVerified('call'); } catch (error) { hf.message(status, error.message, 'error', 0); }
    });

    hf.modal({
        title: 'Verify phone number',
        body,
        actions: sendButtons(sale.customerPhone, () => preview.value || 'Make a code first'),
    });
}
