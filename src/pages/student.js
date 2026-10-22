// EXAMPLE PAGE: read this one carefully, every other page follows the same pattern:
//   1. check the login   2. draw the header   3. show "Loading..."
//   4. ask api.js for data   5. draw it   6. react to clicks
import { animate, stagger } from 'motion';
import { getCalendar, getMyTimetable, listBatches } from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { renderTimetableGrid } from '../lib/timetable-grid.js';
import { $, escapeHtml, formatDate, addDays, statusInfo, renderLoading, renderError, renderEmpty, prefersReducedMotion } from '../lib/ui.js';

// 1 + 2. Only students may be here.
const user = requireLogin(['student']);
if (user) {
  renderHeader(user);
  start();
}

let calendar = null;
let weekStart = null;

async function start() {
  $('#greeting').textContent = `Hi, ${user.name.split(' ')[0]}`;
  try {
    // Ask for two things at the same time.
    const [cal, batches] = await Promise.all([getCalendar(), listBatches()]);
    calendar = cal;
    weekStart = cal.current_week_start;
    const batch = batches.find((b) => b.id === user.batch_id);
    $('#subtitle').textContent = batch ? `${batch.code} · ${batch.name}` : '';
  } catch (err) {
    renderError($('#week-grid'), err, start);
    return;
  }
  $('#prev-week').addEventListener('click', () => changeWeek(-7));
  $('#next-week').addEventListener('click', () => changeWeek(7));
  loadWeek();
}

function changeWeek(days) {
  weekStart = addDays(weekStart, days);
  loadWeek();
}

async function loadWeek() {
  $('#week-label').textContent = `Week of ${formatDate(weekStart)}`;
  // 3. Show loading boxes while we wait.
  renderLoading($('#week-grid'), 'Loading your timetable...');
  $('#changes').innerHTML = '';

  try {
    // 4. Ask api.js. (In mock mode this reads public/mock/timetable_week.json.)
    const week = await getMyTimetable({ weekStart });

    // 5. Draw it.
    if (week.entries.length === 0) {
      renderEmpty($('#week-grid'), 'No classes this week', 'Try another week with the arrows above.');
      renderEmpty($('#changes'), 'Nothing changed');
      return;
    }
    renderTimetableGrid($('#week-grid'), week, calendar, { show: 'faculty' });
    renderChanges(week.entries.filter((e) => e.status !== 'scheduled'));

    if (!prefersReducedMotion()) {
      animate('.tt-card', { opacity: [0, 1], y: [6, 0] }, { duration: 0.25, delay: stagger(0.008) });
    }
  } catch (err) {
    renderError($('#week-grid'), err, loadWeek);
  }
}

function renderChanges(changed) {
  if (changed.length === 0) {
    renderEmpty($('#changes'), 'Nothing changed this week', 'Every class is on as planned.');
    return;
  }
  $('#changes').innerHTML = `<ul class="grid gap-2 md:grid-cols-2">${changed
    .map((e) => {
      const info = statusInfo(e);
      return `
        <li class="flex items-start gap-3 rounded-xl border p-3 ${info.card}">
          <div class="flex-1">
            <p class="font-semibold">${escapeHtml(e.subject.name)}</p>
            <p class="text-sm opacity-80">${escapeHtml(formatDate(e.date))}, ${e.start} · ${escapeHtml(e.space.code)} · ${escapeHtml(e.faculty.name)}</p>
            ${e.reason ? `<p class="mt-1 text-xs opacity-80">${escapeHtml(e.reason)}</p>` : ''}
          </div>
          <span class="shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${info.badgeClass}">${escapeHtml(info.badge)}</span>
        </li>`;
    })
    .join('')}</ul>`;
}
