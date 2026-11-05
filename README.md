# Trusted Select — Business Tracker

A small web app for tracking products, stock, purchases, sales, expenses and profit.
Plain HTML, CSS and JavaScript with Firebase (Firestore + Authentication). No build step.

## Folder structure

```
trusted-select/
├── index.html        start page: goes to dashboard (logged in) or login
├── login.html
├── dashboard.html    profit & loss, stock overview, month by month
├── products.html     add / edit / delete products, stock status
├── purchases.html    stock coming in (raises stock)
├── sales.html        memos with several items (lowers stock)
├── expenses.html     rent, courier, packaging, etc.
├── customers.html    customer list + full order history by phone number
├── settings.html     edit defaults: delivery zones & charges, payment methods, categories...
├── settings.json     starting defaults (business name, currency, first-time settings)
├── firestore.rules   copy of the security rules
├── css/style.css     all styling (colours at the top)
└── js/
    ├── firebase.js       config + every database function
    ├── app-settings.js   loads settings (saved ones over settings.json defaults)
    ├── utils.js          helpers (hf): formatting, forms, dates, phone numbers
    ├── layout.js         sidebar, header, login check, date-range filter
    ├── index.js, login.js, dashboard.js, products.js, purchases.js,
    └── sales.js, expenses.js, customers.js, settings-page.js
```

## Where things are stored in Firestore

| Collection     | What                                                    |
|----------------|---------------------------------------------------------|
| `products`     | one document per product, with `currentStock`           |
| `purchases`    | stock coming in                                         |
| `sales`        | one document per invoice, items inside                  |
| `customers`    | one document per phone number (updated on every sale)   |
| `expenses`     | shop costs                                              |
| `settings`     | `settings/app` — everything on the Settings page        |
| `Track Data`   | counters: `ProductCount`, `SaleCount` (invoice numbers) |

## Order statuses

Pending → Packaged → Handed to courier → Courier collected → Courier paid.
Change it from the dropdown in the Orders list, or by editing the order.
**Returned** and **Cancelled** put the items back into stock and stop the order counting as a sale
(switch back and the stock is taken again). Sales saved before statuses existed count as "Courier paid".

## Delivery & courier money

Each delivery area (Settings page) has two amounts: what the **customer pays** for delivery and the
**courier fee** (what the courier keeps). An optional COD % is added to the fee based on the cash the courier collects.

On every order:
- Customer pays = items − discount + delivery charge
- Courier collects = customer pays − advance paid
- Courier pays you = courier collects − courier fee
- Profit = items − discount − product cost + delivery charge − courier fee

"Courier owes you" (dashboard and orders list) adds up orders that are *Handed to courier* or *Courier collected*.

## Editing orders

Click **Edit** on an order. Saving works out the stock difference (e.g. 2 → 1 puts one back),
updates the customer's totals, and keeps the original product cost so past profit doesn't change.
Delete is inside the edit form.

## Invoice & order numbers

Left blank, they are created automatically when a sale is saved:
- **Invoice:** optional prefix + year + 5 digits, restarting each year → `2600001`, `2600002`…
- **Order:** area prefix + yymmdd + 5 digits, restarting each day → `OD26101800001`.
  Set each area's prefix (e.g. ID / OD) on the Settings page.
Counters live in `Track Data` as `InvoiceCount_26`, `OrderCount_261018`, etc.

## Printing (Print page)

Upload your own Word (.docx) templates for **Invoice** and **Order confirmation** (or start from the samples
in `templates/`). Type placeholders like `{customerName}` or `{total}` where details should go; the full list
is on the Print page. Choose an order → preview → **Print / Save as PDF** or **Download Word file**.
Orders also have a **Print** button in the Sales list. Templates must be under 700 KB.

## Blacklist

On the Customers page, open a customer and click **Blacklist** (with a reason), or add any number with
"Blacklist a number". When that number is typed on the sale form, a red warning shows and saving asks
for confirmation. Remove it the same way.

## Sales not showing?

If a sale is saved but missing from the list, its date was stored in the wrong format.
The Sales page detects this, lists those sales and offers a **Fix** button.

## Running locally

Open the folder in VS Code and use **Live Server** (right-click `index.html` → Open with Live Server).
Opening the files by double-clicking won't work, because browsers block `settings.json` on `file://` pages.

## Firebase setup (already done once)

1. Authentication → Sign-in method → Email/Password **on**.
2. Authentication → Users → add each person who uses the app.
3. Firestore → Rules → paste `firestore.rules`, put in the real emails, **Publish**.
4. Authentication → Settings → Authorized domains → add `127.0.0.1` and, later, your GitHub Pages domain.

## Adding a new person

1. Authentication → Users → **Add user**.
2. Add their email to the list in Firestore → Rules → **Publish**.

## Changing dropdown lists

Use the **Settings** page in the app. `settings.json` only holds the starting defaults
(used until you first save on the Settings page) plus the business name and currency.
JSON has no comments and no trailing commas: one extra comma breaks every page.

## Counters

Item codes (`TS-260001`) and memo numbers (`1001`, `1002`…) come from the `Track Data`
collection in Firestore (`ProductCount`, `SaleCount`). Don't edit those by hand except to fix a mistake.

## Putting it online (GitHub Pages)

1. Create a GitHub repository and upload everything in this folder.
2. Repository → Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
3. Add `yourname.github.io` to Firebase → Authentication → Settings → Authorized domains.

## Free plan limits to keep in mind

Firestore Spark plan: 50,000 reads and 20,000 writes per day, 1 GiB stored.
Each record shown counts as one read, so the dashboard for "This year" reads every sale and expense of the year.
Check usage in Firestore → Usage.
