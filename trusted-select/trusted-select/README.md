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
├── settings.json     business name, currency, categories, payment methods
├── firestore.rules   copy of the security rules
├── css/style.css     all styling (colours at the top)
└── js/
    ├── firebase.js   config + every database function
    ├── utils.js      helpers (hf): formatting, forms, dates
    ├── layout.js     sidebar, header, login check, date-range filter
    ├── index.js, login.js, dashboard.js, products.js,
    └── purchases.js, sales.js, expenses.js
```

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

Edit `settings.json` (categories, units, payment methods, expense categories).
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
