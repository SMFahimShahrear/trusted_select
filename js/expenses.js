// ==============================
// expenses.js — shop running costs
// ==============================

// ---------- Imports ----------
import { hf } from "./utils.js";
import { loadSettings, DEFAULT_SETTINGS } from "./app-settings.js";
import { startPage, createRangeFilter } from "./layout.js";
import { addExpense, getExpenses, deleteExpense } from "./firebase.js";


// ---------- Elements ----------
const expenseForm = hf.q('#add-expense-form');
const submitBtn = hf.q('.expense-submit-btn');
const message = hf.q('#form-message');
const dateInput = hf.q('#expense-date');
const categorySelect = hf.q('#expense-category');
const paidBySelect = hf.q('#expense-paid-by');
const summary = hf.q('#expense-summary');
const tableBody = hf.q('#expense-table-body');

const COLUMNS = 6;
let range;
let settings = DEFAULT_SETTINGS;   // replaced with saved settings when the page loads


// ---------- Functions ----------
function readExpenseForm() {
    const data = hf.formData(expenseForm);
    return {
        date: data.date,
        category: data.category,
        details: data.details.trim(),
        amount: hf.num(data.amount),
        paidBy: data.paidBy,
    };
}

function resetForm() {
    expenseForm.reset();
    hf.fillSelect(categorySelect, settings.expenses?.categories || ['Other'], 'Choose category');
    hf.fillSelect(paidBySelect, settings.expenses?.paidBy || ['Cash']);
    dateInput.value = hf.today();
}

async function removeExpense(expense) {
    const ok = confirm(`Delete this ${expense.category} expense of ${hf.money(expense.amount)}?`);
    if (!ok) return;
    try {
        await deleteExpense(expense.id);
        hf.message(message, 'Expense deleted.');
        await loadExpenses();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not delete: ${error.message}`, 'error', 0);
    }
}

function createExpenseRow(e) {
    const categoryCell = hf.create('td');
    categoryCell.append(hf.create('span', { className: 'badge badge-neutral', text: e.category }));

    const actions = hf.create('td', { className: 'actions' });
    actions.append(hf.rowButton('Delete', 'danger', () => removeExpense(e)));

    const row = hf.create('tr');
    row.append(
        hf.create('td', { text: hf.date(e.date) }),
        categoryCell,
        hf.create('td', { className: 'wrap', text: e.details || '' }),
        hf.create('td', { text: e.paidBy || '' }),
        hf.create('td', { className: 'num', text: hf.money(e.amount) }),
        actions,
    );
    return row;
}

async function loadExpenses() {
    hf.tableMessage(tableBody, 'Loading...', COLUMNS);
    summary.replaceChildren();
    try {
        const expenses = await getExpenses(range.from, range.to);
        const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);

        summary.append(
            hf.create('span', { text: range.label }),
            hf.create('span', { text: `${expenses.length} expenses` }),
        );
        const t = hf.create('span', { text: 'Total: ' });
        t.append(hf.create('strong', { text: hf.money(total) }));
        summary.append(t);

        if (expenses.length === 0) {
            hf.tableMessage(tableBody, 'No expenses in this period.', COLUMNS);
            return;
        }
        hf.clear(tableBody);
        expenses.forEach((e) => tableBody.append(createExpenseRow(e)));
    } catch (error) {
        console.error(error);
        hf.tableMessage(tableBody, `Could not load expenses: ${error.message}`, COLUMNS);
    }
}


// ---------- Events ----------
hf.on(expenseForm, 'submit', async (event) => {
    event.preventDefault();
    const expense = readExpenseForm();

    hf.busy(submitBtn, true);
    try {
        await addExpense(expense);
        hf.message(message, `${expense.category} · ${hf.money(expense.amount)} saved ✓`);
        resetForm();
        await loadExpenses();
    } catch (error) {
        console.error(error);
        hf.message(message, `Could not save: ${error.message}`, 'error', 0);
    } finally {
        hf.busy(submitBtn, false);
    }
});


// ---------- Start ----------
resetForm();
range = createRangeFilter(hf.q('#expense-range'), loadExpenses);
startPage({
    title: 'Expenses',
    onReady: async () => {
        settings = await loadSettings();
        resetForm();
        loadExpenses();
    },
});
