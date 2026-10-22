import { login, getCurrentUser } from '../api.js';
import { homeFor } from '../lib/layout.js';
import { setupThemeToggle, themeIcons } from '../lib/theme.js';
import { icon } from '../lib/icons.js';

const DEMO_PASSWORD = 'demo1234';
const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');

// The light / dark button in the corner.
const themeButton = document.getElementById('theme-toggle');
themeButton.innerHTML = themeIcons(icon('moon', 'h-5 w-5'), icon('sun', 'h-5 w-5'));
setupThemeToggle(themeButton);

// Already logged in? Skip this page.
const existing = getCurrentUser();
if (existing) window.location.href = homeFor(existing.role);

async function signIn(email, password, button) {
  errorBox.classList.add('hidden');
  button.disabled = true;
  try {
    const res = await login(email, password);
    window.location.href = homeFor(res.user.role);
  } catch (err) {
    errorBox.textContent = err.detail || 'Could not sign in. Please try again.';
    errorBox.classList.remove('hidden');
    button.disabled = false;
  }
}

// The three demo buttons.
document.querySelectorAll('[data-demo]').forEach((button) => {
  button.addEventListener('click', () => signIn(button.dataset.demo, DEMO_PASSWORD, button));
});

// The email form.
form.addEventListener('submit', (event) => {
  event.preventDefault(); // stop the browser from reloading the page
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) {
    errorBox.textContent = 'Please enter your email and password.';
    errorBox.classList.remove('hidden');
    return;
  }
  signIn(email, password, form.querySelector('button[type="submit"]'));
});
