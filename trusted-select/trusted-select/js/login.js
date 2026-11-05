// ==============================
// login.js
// ==============================

// ---------- Imports ----------
import settings from "../settings.json" with { type: "json" };
import { hf } from "./utils.js";
import { login, watchUser } from "./firebase.js";


// ---------- Elements ----------
const loginForm = hf.q('#login-form');
const loginBtn = hf.q('.login-btn');
const message = hf.q('#form-message');

// Where to go after logging in
const AFTER_LOGIN_PAGE = 'dashboard.html';


// ---------- Functions ----------
function friendlyError(error) {
    switch (error.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
        case 'auth/invalid-email':
            return 'Wrong email or password.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait a few minutes and try again.';
        case 'auth/network-request-failed':
            return 'No internet connection.';
        default:
            return 'Could not log in. Please try again.';
    }
}


// ---------- Events ----------
hf.on(loginForm, 'submit', async (event) => {
    event.preventDefault();
    const { email, password } = hf.formData(loginForm);

    hf.busy(loginBtn, true, 'Logging in...');
    try {
        await login(email.trim(), password);
        location.href = AFTER_LOGIN_PAGE;
    } catch (error) {
        console.error(error);
        hf.message(message, friendlyError(error), 'error', 0);
        hf.busy(loginBtn, false);
    }
});


// ---------- Start ----------
const name = settings.business?.name || 'Trusted Select';
hf.title('Login');
hf.q('.login-title').textContent = name;
hf.q('.brand-mark').textContent = name[0];

// Already logged in? Skip this page.
watchUser((user) => {
    if (user) location.href = AFTER_LOGIN_PAGE;
});
