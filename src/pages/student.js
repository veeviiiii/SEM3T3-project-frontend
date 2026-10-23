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
  // In date order. Each row reads top to bottom: the day, what happened, which class, and why.
  changed.sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  $('#changes').innerHTML = `<ul class="grid gap-2 md:grid-cols-2">${changed
    .map((e) => {
      const info = statusInfo(e);
      const [day, date] = formatDate(e.date).split(' ');
      return `
        <li class="flex gap-3 rounded-xl border p-3 ${info.card}">
          <div class="flex w-11 shrink-0 flex-col items-center self-start rounded-lg bg-white/70 py-1.5" aria-hidden="true">
            <span class="text-[10px] font-medium uppercase tracking-wide opacity-80">${escapeHtml(day)}</span>
            <span class="text-lg font-semibold leading-tight">${escapeHtml(date)}</span>
          </div>
          <div class="min-w-0 flex-1">
            <span class="inline-block rounded px-2 py-0.5 text-xs font-semibold ${info.badgeClass}">${escapeHtml(info.badge)}</span>
            <p class="mt-1 font-semibold leading-snug">${escapeHtml(e.subject.name)}</p>
            <p class="text-sm opacity-80"><span class="sr-only">${escapeHtml(formatDate(e.date))}, </span>${escapeHtml(e.start)} · ${escapeHtml(e.space.code)} · ${escapeHtml(e.faculty.name)}</p>
            ${e.reason ? `<p class="mt-1 text-xs opacity-80">Why: ${escapeHtml(e.reason)}</p>` : ''}
          </div>
        </li>`;
    })
    .join('')}</ul>`;
}
