// Small helpers used by every page.

/** Find one element: $('#week-grid') */
export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * ALWAYS pass text from the server through this before putting it inside innerHTML.
 * It stops a name like "<script>" from being run as code (this attack is called XSS).
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10-29" -> "Thu 29 Oct" */
export function formatDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "2026-10-26" + 7 -> "2026-11-02" */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * How to show a timetable entry, based on its status (CONTRACT.md section 3.2).
 * Returns Tailwind classes for the card and a short badge text.
 * A changed class is a soft coloured chip, like the calendar in the design. A normal class is white.
 */
export function statusInfo(entry) {
  switch (entry.status) {
    case 'pending':
      return { card: 'border-blue-200 bg-blue-50 text-blue-950', badge: 'New time coming', badgeClass: 'bg-blue-200 text-blue-900', strike: false };
    case 'cancelled':
      return { card: 'border-red-200 bg-red-50 text-red-950', badge: 'Cancelled', badgeClass: 'bg-red-200 text-red-900', strike: true };
    case 'moved_away':
      return {
        card: 'border-slate-200 bg-slate-100 text-slate-500',
        badge: `Moved to ${entry.moved_to.day} ${entry.moved_to.start}`,
        badgeClass: 'bg-slate-200 text-slate-700',
        strike: true,
      };
    case 'moved_here':
      return {
        card: 'border-green-200 bg-green-50 text-green-950',
        badge: `Moved here from ${entry.moved_from.day} ${entry.moved_from.start}`,
        badgeClass: 'bg-green-200 text-green-900',
        strike: false,
      };
    case 'room_changed':
      return {
        card: 'border-orange-200 bg-orange-50 text-orange-950',
        badge: `Room changed: ${entry.moved_from.space.code} → ${entry.space.code}`,
        badgeClass: 'bg-orange-200 text-orange-900',
        strike: false,
      };
    default: // "scheduled"
      return { card: 'border-slate-200 bg-white text-slate-800 shadow-sm', badge: '', badgeClass: '', strike: false };
  }
}

/** "Dr. Rakesh Jain" -> "RJ" (titles like "Dr." and "Prof." are skipped). Used for the round avatars. */
export function initials(name) {
  const words = String(name ?? '').split(' ').filter((w) => w && !w.endsWith('.'));
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * A grey "Loading..." box. Show it before every api.js call.
 * It fades in after a short moment, so a quick answer does not make the screen flicker.
 */
export function renderLoading(container, text = 'Loading...') {
  container.innerHTML = `
    <div class="flex animate-fade-in items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-5 text-sm text-slate-500 [animation-delay:120ms]">
      <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-400"></span>
      ${escapeHtml(text)}
    </div>`;
}

/** A friendly box for "nothing here yet". */
export function renderEmpty(container, title, hint = '') {
  container.innerHTML = `
    <div class="animate-fade-up rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p class="font-medium text-slate-700">${escapeHtml(title)}</p>
      ${hint ? `<p class="mt-1 text-sm text-slate-500">${escapeHtml(hint)}</p>` : ''}
    </div>`;
}

/** A red box with the server's message and a "Try again" button. */
export function renderError(container, error, onRetry) {
  container.innerHTML = `
    <div class="animate-fade-up rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p class="font-semibold">Something went wrong</p>
      <p class="mt-1">${escapeHtml(error?.detail || error?.message || 'Please try again.')}</p>
      ${onRetry ? '<button type="button" class="btn-secondary mt-3" data-retry>Try again</button>' : ''}
    </div>`;
  if (onRetry) container.querySelector('[data-retry]').addEventListener('click', onRetry);
}

/** A small message in the corner that disappears by itself. kind: "info" | "success" | "error" */
export function showToast(message, kind = 'info') {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.className = 'fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2';
    document.body.append(root);
  }
  const colours = { info: 'bg-slate-900 text-white', success: 'bg-green-200 text-green-950', error: 'bg-red-200 text-red-950' };
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  // It slides up when it appears and fades away before it is removed.
  toast.className = `animate-toast-in rounded-xl px-4 py-3 text-sm shadow-lg transition duration-300 ${colours[kind] || colours.info}`;
  toast.textContent = message;
  root.append(toast);
  setTimeout(() => toast.classList.add('translate-y-2', 'opacity-0'), 3700);
  setTimeout(() => toast.remove(), 4000);
}

/** True when the user asked their computer for less animation. Check it before animating. */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
