// index.js — decides where to send you when you open the site.
import { watchUser } from "./firebase.js";

watchUser((user) => {
    location.replace(user ? 'dashboard.html' : 'login.html');
});
