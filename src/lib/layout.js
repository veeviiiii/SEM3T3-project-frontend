// The menu on the left and the bar along the top that every page shares,
// and the "are you logged in?" check.
import {
  getCurrentUser,
  logout,
  search,
  listBatches,
  listSubjects,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToEvents,
} from '../api.js';
import { $, escapeHtml, formatDate, initials, renderLoading, renderEmpty, renderError, showToast } from './ui.js';
import { icon, logoMark } from './icons.js';
import { setupThemeToggle, themeIcons } from './theme.js';

// Which links each role sees in the menu: address, label, icon.
const NAV = {
  hod: [
    ['/hod.html', 'Dashboard', 'dashboard'],
    ['/approvals.html', 'Approvals', 'approvals'],
    ['/timetable.html', 'Timetables', 'calendar'],
    ['/rooms.html', 'Rooms', 'rooms'],
    ['/reports.html', 'Reports', 'reports'],
    ['/whatif.html', 'What-if', 'whatif'],
  ],
  faculty: [
    ['/faculty.html', 'My week', 'week'],
    ['/timetable.html', 'Timetables', 'calendar'],
    ['/rooms.html', 'Rooms', 'rooms'],
  ],
  student: [
    ['/student.html', 'My timetable', 'week'],
    ['/timetable.html', 'Timetables', 'calendar'],
    ['/rooms.html', 'Rooms', 'rooms'],
  ],
};
// Links at the very bottom of the menu, under a line (like "Settings" in the design).
const NAV_BOTTOM = {
  hod: [['/settings.html', 'Settings', 'settings']],
  faculty: [],
  student: [],
};
const ROLE_NAME = { hod: 'Head of department', faculty: 'Teacher', student: 'Student' };

// Search results: the word shown next to each one, and the timetable.html address part it opens.
const RESULT_TYPE = { faculty: 'Teacher', batch: 'Batch', space: 'Room', subject: 'Subject' };
const TIMETABLE_PARAM = { faculty: 'faculty', batch: 'batch', space: 'room' };

/** The first page each role lands on after logging in. */
export function homeFor(role) {
  return { hod: '/hod.html', faculty: '/faculty.html', student: '/student.html' }[role] || '/index.html';
}

/**
 * Call this first on every page (except login).
 * Not logged in -> goes to the login page. Wrong role -> goes to their own home page.
 * Returns the user, or null if the page is being left.
 */
export function requireLogin(allowedRoles = ['hod', 'faculty', 'student']) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = '/index.html';
    return null;
  }
  if (!allowedRoles.includes(user.role)) {
    window.location.href = homeFor(user.role);
    return null;
  }
  return user;
}

/** One menu link. The page you are on is highlighted. */
function navLink([href, label, iconName]) {
  const active = window.location.pathname === href;
  return `<a href="${href}" class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition duration-200 ${
    active
      ? 'bg-nav font-medium text-slate-900 dark:shadow-[0_0_20px_-6px_rgb(120_150_255/0.45)]'
      : 'text-slate-600 hover:translate-x-1 hover:bg-blue-50 hover:text-slate-900'
  }" ${active ? 'aria-current="page"' : ''}>${icon(iconName)}${label}</a>`;
}

/**
 * Draws the menu on the left and the bar along the top into <header id="app-header">.
 * On phones the menu is hidden and slides in from the ☰ button.
 */
export function renderHeader(user) {
  const bottom = NAV_BOTTOM[user.role];
  document.getElementById('app-header').innerHTML = `
    <div id="sidebar-backdrop" class="fixed inset-0 z-40 hidden animate-fade-in bg-black/40 backdrop-blur-[2px] lg:hidden"></div>
    <aside id="sidebar" class="invisible fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col border-r border-slate-200 bg-white transition-transform duration-300 ease-out motion-reduce:transition-none lg:visible lg:translate-x-0" aria-label="Main menu">
      <div class="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <a href="${homeFor(user.role)}" class="group flex items-center gap-2 font-pixel text-[11px] tracking-wide text-slate-900">
          <span class="transition-transform duration-500 group-hover:rotate-180">${logoMark()}</span> SMART SCHEDULING
        </a>
        <button type="button" id="close-menu" class="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Close menu">${icon('panel')}</button>
      </div>
      <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-2">${NAV[user.role].map(navLink).join('')}</nav>
      <div class="p-3">
        <div class="rounded-2xl bg-card-yellow p-4 text-center">
          <span class="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-800">${escapeHtml(initials(user.name))}</span>
          <p class="mt-2 truncate text-sm font-semibold text-slate-900">${escapeHtml(user.name)}</p>
          <p class="text-xs text-slate-700">${ROLE_NAME[user.role] || ''}</p>
          <button type="button" id="logout" class="group mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-px hover:shadow-md">
            Log out <span class="transition-transform group-hover:translate-x-1">${icon('arrow-right', 'h-4 w-4')}</span>
          </button>
        </div>
      </div>
      ${bottom.length ? `<div class="space-y-1 border-t border-slate-200 px-3 py-3">${bottom.map(navLink).join('')}</div>` : ''}
    </aside>

    <div id="topbar" class="relative z-30 mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 pb-2 pt-5 sm:px-6">
      <button type="button" id="open-menu" class="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition hover:-translate-y-px hover:shadow-md lg:hidden" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button>
      <div class="min-w-0 flex-1" id="title-slot"></div>
      <div class="relative order-last w-full sm:order-none sm:w-64" id="search-box">
        <label for="search" class="sr-only">Search teachers, batches, rooms and subjects</label>
        <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">${icon('search')}</span>
        <input type="search" id="search" class="h-10 w-full rounded-full border border-transparent bg-white pl-10 pr-4 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 hover:shadow-md focus:border-blue-300 focus:ring-4 focus:ring-blue-100 focus:outline-none" placeholder="Search" autocomplete="off" />
        <div id="search-results" class="absolute left-0 right-0 top-full z-40 mt-1 hidden origin-top animate-pop-in rounded-xl shadow-lg sm:left-auto sm:w-80"></div>
      </div>
      <button type="button" id="theme-toggle" class="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition hover:-translate-y-px hover:text-slate-900 hover:shadow-md" aria-label="Dark mode" aria-pressed="false">
        ${themeIcons(icon('moon', 'h-5 w-5'), icon('sun', 'h-5 w-5'))}
      </button>
      <button type="button" id="bell" class="group relative flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition hover:-translate-y-px hover:text-slate-900 hover:shadow-md" aria-label="Notifications" aria-expanded="false" aria-controls="notif-panel">
        <span class="origin-top group-hover:animate-bell-ring">${icon('bell', 'h-5 w-5')}</span>
        <span id="bell-count" class="absolute -right-1 -top-1 hidden min-w-5 animate-badge-pop rounded-full bg-red-300 px-1 text-center text-xs font-bold leading-5 text-red-950 shadow-[0_0_10px_var(--color-red-300)]"></span>
      </button>
      <section id="notif-panel" class="absolute left-4 right-4 top-full z-40 mt-1 hidden origin-top-right animate-pop-in rounded-xl border border-slate-200 bg-white shadow-lg sm:left-auto sm:right-6 sm:w-96" aria-label="Notifications">
        <div class="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 class="font-semibold text-slate-900">Notifications</h2>
          <button type="button" id="mark-all" class="btn-secondary px-3 py-1.5 text-xs" disabled>Mark all as read</button>
        </div>
        <div id="notif-list" class="max-h-96 overflow-y-auto p-2"></div>
      </section>
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-orange text-sm font-semibold text-slate-800 ring-2 ring-white transition hover:scale-105" role="img" aria-label="Logged in as ${escapeHtml(user.name)}" title="${escapeHtml(user.name)}">${escapeHtml(initials(user.name))}</span>
    </div>`;

  // Make room on the left for the menu (on wide screens it is always shown).
  document.body.classList.add('lg:pl-64');
  // The page's own <h1> goes in the top bar, like "Dashboard" in the design. It is moved, not copied,
  // so the page can still change its text later (for example the HOD greeting).
  const title = document.querySelector('main h1');
  if (title) $('#title-slot').append(title);

  document.getElementById('logout').addEventListener('click', () => {
    logout();
    window.location.href = '/index.html';
  });
  setupThemeToggle($('#theme-toggle'));
  setupMenu();
  setupSearch();
  setupNotifications(user);
  refreshBell();
}

/** Phones: the ☰ button slides the menu in; ✕, Escape or a tap outside closes it. */
function setupMenu() {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const openButton = $('#open-menu');

  function open() {
    sidebar.classList.remove('invisible', '-translate-x-full');
    backdrop.classList.remove('hidden');
    openButton.setAttribute('aria-expanded', 'true');
    sidebar.querySelector('nav a').focus();
  }
  function close() {
    sidebar.classList.add('invisible', '-translate-x-full');
    backdrop.classList.add('hidden');
    openButton.setAttribute('aria-expanded', 'false');
    openButton.focus();
  }

  openButton.addEventListener('click', open);
  $('#close-menu').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    // The dark backdrop only shows while the menu is slid in.
    if (event.key === 'Escape' && !backdrop.classList.contains('hidden')) close();
  });
}

/** Puts the number of unread notifications on the bell. */
export async function refreshBell() {
  try {
    const page = await listNotifications({ limit: 1 });
    const badge = document.getElementById('bell-count');
    badge.textContent = page.unread;
    badge.classList.toggle('hidden', page.unread === 0);
  } catch {
    /* the bell is not important enough to show an error */
  }
}

// ------------------------------------------------------------------ search box

function setupSearch() {
  const input = $('#search');
  const results = $('#search-results');
  let timer = null;

  // Wait until the user stops typing for 300 ms, then search.
  input.addEventListener('input', () => {
    clearTimeout(timer);
    if (input.value.trim().length < 2) {
      results.classList.add('hidden');
      return;
    }
    timer = setTimeout(runSearch, 300);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') results.classList.add('hidden');
  });

  // Clicking anywhere else closes the list.
  document.addEventListener('pointerdown', (event) => {
    if (!$('#search-box').contains(event.target)) results.classList.add('hidden');
  });

  async function runSearch() {
    const text = input.value.trim();
    results.classList.remove('hidden');
    renderLoading(results, 'Searching...');
    try {
      const found = await search(text);
      // The user typed something else while we waited: a newer search will draw the list.
      if (text !== input.value.trim()) return;
      if (found.length === 0) {
        renderEmpty(results, 'No matches', 'Try a teacher, batch, room or subject.');
        return;
      }
      results.innerHTML = `
        <ul class="rounded-xl border border-slate-200 bg-white py-1">
          ${found
            .map(
              (r) => `
            <li>
              <button type="button" class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:-outline-offset-2 disabled:opacity-50">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-slate-900">${escapeHtml(r.label)}</span>
                  <span class="block truncate text-xs text-slate-500">${escapeHtml(r.sublabel)}</span>
                </span>
                <span class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-600">${escapeHtml(RESULT_TYPE[r.type] || r.type)}</span>
              </button>
            </li>`,
            )
            .join('')}
        </ul>`;
      results.querySelectorAll('button').forEach((button, i) =>
        button.addEventListener('click', () => openResult(button, found[i])),
      );
    } catch (err) {
      renderError(results, err, runSearch);
    }
  }
}

/** Opens the timetable for a search result. */
async function openResult(button, result) {
  if (result.type !== 'subject') {
    window.location.href = `/timetable.html?${TIMETABLE_PARAM[result.type]}=${result.id}`;
    return;
  }
  // A subject has no timetable of its own, so open the first batch of its semester.
  button.disabled = true;
  try {
    const [subjects, batches] = await Promise.all([listSubjects(), listBatches()]);
    const subject = subjects.find((s) => s.id === result.id);
    const batch = batches.find((b) => b.semester === subject?.semester);
    if (!batch) {
      button.disabled = false;
      showToast('No batch studies this subject yet.', 'error');
      return;
    }
    window.location.href = `/timetable.html?batch=${batch.id}`;
  } catch (err) {
    button.disabled = false;
    showToast(err.detail, 'error');
  }
}

// ------------------------------------------------------------------ notifications panel

function setupNotifications(user) {
  const bell = $('#bell');
  const panel = $('#notif-panel');
  const markAll = $('#mark-all');

  const isOpen = () => !panel.classList.contains('hidden');

  function close() {
    panel.classList.add('hidden');
    bell.setAttribute('aria-expanded', 'false');
  }

  bell.addEventListener('click', () => {
    if (isOpen()) {
      close();
      return;
    }
    panel.classList.remove('hidden');
    bell.setAttribute('aria-expanded', 'true');
    loadNotifications();
  });

  // Clicking outside the panel, or pressing Escape, closes it.
  document.addEventListener('pointerdown', (event) => {
    if (isOpen() && !panel.contains(event.target) && !bell.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      close();
      bell.focus();
    }
  });

  markAll.addEventListener('click', async () => {
    markAll.disabled = true;
    try {
      await markAllNotificationsRead();
      showToast('All notifications marked as read.', 'success');
      refreshBell();
      loadNotifications();
    } catch (err) {
      markAll.disabled = false;
      showToast(err.detail, 'error');
    }
  });

  // Live updates: a new notification pops up as a toast and the bell count goes up.
  subscribeToEvents({
    notification: (n) => {
      showToast(n.title);
      refreshBell();
      if (isOpen()) loadNotifications();
    },
  });

  async function loadNotifications() {
    const list = $('#notif-list');
    markAll.disabled = true;
    renderLoading(list, 'Loading notifications...');
    try {
      const page = await listNotifications();
      markAll.disabled = page.unread === 0;
      if (page.items.length === 0) {
        renderEmpty(list, 'No notifications yet', 'Changes to your classes will show up here.');
        return;
      }
      list.innerHTML = `
        <ul class="divide-y divide-slate-100">
          ${page.items
            .map(
              (n) => `
            <li>
              <button type="button" class="flex w-full gap-3 rounded-lg px-2 py-3 text-left transition hover:translate-x-0.5 hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:-outline-offset-2 disabled:opacity-50">
                <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? '' : 'bg-blue-400 shadow-[0_0_8px_var(--color-blue-300)]'}" aria-hidden="true"></span>
                <span class="min-w-0 flex-1">
                  ${n.read ? '' : '<span class="sr-only">Unread: </span>'}
                  <span class="block text-sm ${n.read ? 'text-slate-700' : 'font-bold text-slate-900'}">${escapeHtml(n.title)}</span>
                  <span class="mt-0.5 block text-xs text-slate-500">${escapeHtml(n.body)}</span>
                  <span class="mt-1 block text-xs text-slate-400">${escapeHtml(formatDate(n.created_at.slice(0, 10)))}, ${escapeHtml(n.created_at.slice(11, 16))}</span>
                </span>
              </button>
            </li>`,
            )
            .join('')}
        </ul>`;
      list.querySelectorAll('button').forEach((button, i) =>
        button.addEventListener('click', () => openNotification(button, page.items[i], user)),
      );
    } catch (err) {
      renderError(list, err, loadNotifications);
    }
  }
}

/** Marks a notification as read, then opens the page it is about. */
async function openNotification(button, n, user) {
  button.disabled = true;
  try {
    await markNotificationRead(n.id);
    window.location.href = linkFor(n.ref, user.role);
  } catch (err) {
    button.disabled = false;
    showToast(err.detail, 'error');
  }
}

/** Where a notification leads, based on what its ref points at. */
function linkFor(ref, role) {
  if (ref?.type === 'proposal') return `/approvals.html?id=${ref.id}`;
  // A leave or room closure: the HOD picks new slots, the teacher sees it in "My leave".
  if (ref?.type === 'unavailability') return role === 'hod' ? '/approvals.html' : '/faculty.html';
  // A changed class: the student's or teacher's own week.
  if (ref?.type === 'timetable') return role === 'student' ? '/student.html' : '/faculty.html';
  return homeFor(role);
}
