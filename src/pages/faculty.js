// My week page (teachers, and the HOD for their own classes):
//   the week grid, a "Mark leave" form, and the list of leave already marked.
// Same pattern as student.js:
//   1. check the login   2. draw the header   3. show "Loading..."
//   4. ask api.js for data   5. draw it   6. react to clicks
import { animate, stagger } from 'motion';
import { getCalendar, getMyTimetable, createUnavailability, listUnavailability, withdrawUnavailability } from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { renderTimetableGrid } from '../lib/timetable-grid.js';
import { $, escapeHtml, formatDate, addDays, statusInfo, renderLoading, renderError, renderEmpty, showToast, prefersReducedMotion } from '../lib/ui.js';

// Where each field's error message goes: field name from the server -> id of the red text under it.
const ERROR_BOX = { start_date: 'from-error', end_date: 'to-error', periods: 'periods-error', reason: 'reason-error' };

// 1 + 2. Teachers and the HOD may be here.
const user = requireLogin(['faculty', 'hod']);
if (user) {
  renderHeader(user);
  start();
  loadLeave();
}

let calendar = null;
let weekStart = null;

async function start() {
  renderLoading($('#week-grid'), 'Loading your timetable...');
  try {
    calendar = await getCalendar();
    weekStart = calendar.current_week_start;
  } catch (err) {
    renderError($('#week-grid'), err, start);
    return;
  }

  // One tick box per period, for "Only some periods".
  $('#period-list').innerHTML = calendar.periods
    .map(
      (p) => `
      <label class="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-sm">
        <input type="checkbox" name="period" value="${escapeHtml(p.period)}" class="accent-blue-400" /> P${escapeHtml(p.period)}
        <span class="text-xs text-slate-500">${escapeHtml(p.start)}</span>
      </label>`,
    )
    .join('');

  $('#prev-week').addEventListener('click', () => changeWeek(-7));
  $('#next-week').addEventListener('click', () => changeWeek(7));
  $('#mark-leave').addEventListener('click', openLeaveForm);
  $('#cancel-leave').addEventListener('click', () => $('#leave-dialog').close());
  $('#leave-form').addEventListener('submit', saveLeave);
  document.querySelectorAll('input[name="scope"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      $('#period-boxes').classList.toggle('hidden', !wantsSomePeriods());
      $('#periods-error').classList.add('hidden');
    }),
  );
  // Moving "From" past "To" moves "To" along with it.
  $('#leave-from').addEventListener('change', () => {
    if ($('#leave-to').value < $('#leave-from').value) $('#leave-to').value = $('#leave-from').value;
  });
  $('#mark-leave').disabled = false;
  loadWeek();
}

// ------------------------------------------------------------------ week grid

function changeWeek(days) {
  weekStart = addDays(weekStart, days);
  loadWeek();
}

async function loadWeek() {
  $('#week-label').textContent = `Week of ${formatDate(weekStart)}`;
  renderLoading($('#week-grid'), 'Loading your timetable...');
  try {
    const week = await getMyTimetable({ weekStart });
    if (week.entries.length === 0) {
      renderEmpty($('#week-grid'), 'No classes this week', 'Try another week with the arrows above.');
      return;
    }
    // show: 'batch' -> each card says which batch you are teaching.
    renderTimetableGrid($('#week-grid'), week, calendar, { show: 'batch' });
    if (!prefersReducedMotion()) {
      animate('.tt-card', { opacity: [0, 1], y: [6, 0] }, { duration: 0.25, delay: stagger(0.008) });
    }
  } catch (err) {
    renderError($('#week-grid'), err, loadWeek);
  }
}

// ------------------------------------------------------------------ "Mark leave" form

function wantsSomePeriods() {
  return document.querySelector('input[name="scope"]:checked').value === 'some';
}

/** Empties the form, then opens it. */
function openLeaveForm() {
  $('#leave-form').reset();
  $('#leave-from').value = calendar.today;
  $('#leave-to').value = calendar.today;
  $('#leave-from').min = calendar.today;
  $('#leave-to').min = calendar.today;
  $('#period-boxes').classList.add('hidden');
  $('#save-leave').disabled = false;
  clearErrors();
  $('#leave-dialog').showModal();
}

function clearErrors() {
  document.querySelectorAll('#leave-form [data-error]').forEach((box) => {
    box.textContent = '';
    box.classList.add('hidden');
  });
}

/** Puts each message in red under its field. Messages for an unknown field go in the box at the bottom. */
function showFieldErrors(fields) {
  for (const f of fields) {
    const box = document.getElementById(ERROR_BOX[f.field]) || $('#form-error');
    box.textContent = f.message;
    box.classList.remove('hidden');
  }
}

async function saveLeave(event) {
  event.preventDefault();
  clearErrors();
  const from = $('#leave-from').value;
  const to = $('#leave-to').value;
  const wholeDay = !wantsSomePeriods();
  const periods = [...document.querySelectorAll('input[name="period"]:checked')].map((box) => Number(box.value));

  // Quick checks before asking the server (the server checks everything again).
  const problems = [];
  if (!from) problems.push({ field: 'start_date', message: 'Please pick the first day' });
  if (!to) problems.push({ field: 'end_date', message: 'Please pick the last day' });
  else if (from && to < from) problems.push({ field: 'end_date', message: '"To" must be on or after "From"' });
  if (!wholeDay && periods.length === 0) problems.push({ field: 'periods', message: 'Tick at least one period, or choose Whole day' });
  if (problems.length) {
    showFieldErrors(problems);
    return;
  }

  const button = $('#save-leave');
  button.disabled = true;
  try {
    const result = await createUnavailability({
      kind: 'faculty_leave',
      target_id: user.faculty_id,
      start_date: from,
      end_date: to,
      periods: wholeDay ? null : periods, // null = the whole day
      reason: $('#leave-reason').value.trim(),
    });
    $('#leave-dialog').close();
    const message = `Saved. ${classes(result.affected.length)} cancelled and sent to the HOD for new slots`;
    showToast(`${message}.`, 'success');
    renderSaved(message, result.affected);
    loadWeek();
    loadLeave();
  } catch (err) {
    button.disabled = false;
    if (err.code === 'VALIDATION' && err.fields) {
      showFieldErrors(err.fields);
    } else {
      // Shown inside the form, because a toast would sit behind the open form.
      $('#form-error').textContent = err.detail;
      $('#form-error').classList.remove('hidden');
    }
  }
}

/** "1 class was" / "3 classes were" */
function classes(n) {
  return n === 1 ? '1 class was' : `${n} classes were`;
}

/** After saving: the sentence, then one row per cancelled class. */
function renderSaved(message, affected) {
  const box = $('#saved');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="card">
      <p class="font-medium text-slate-900">${escapeHtml(message)}</p>
      <ul class="mt-3 grid gap-2 md:grid-cols-2">${affected
        .map((e) => {
          const info = statusInfo(e);
          return `
          <li class="flex items-start gap-3 rounded-xl border p-3 ${info.card}">
            <div class="min-w-0 flex-1">
              <p class="font-medium">${escapeHtml(e.subject.name)}</p>
              <p class="text-sm opacity-80">${escapeHtml(formatDate(e.date))}, ${escapeHtml(e.start)} · ${escapeHtml(e.batch.code)} · ${escapeHtml(e.space.code)}</p>
            </div>
            <span class="shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${info.badgeClass}">${escapeHtml(info.badge)}</span>
          </li>`;
        })
        .join('')}</ul>
    </div>`;
}

// ------------------------------------------------------------------ "My leave" list

/** "Thu 29 Oct" or "Thu 29 Oct to Sat 31 Oct" */
function dateRange(u) {
  return u.start_date === u.end_date ? formatDate(u.start_date) : `${formatDate(u.start_date)} to ${formatDate(u.end_date)}`;
}

async function loadLeave() {
  const box = $('#leave-list');
  renderLoading(box, 'Loading your leave...');
  try {
    // The HOD gets everyone's leave and room closures, so keep only leave for this teacher.
    const all = await listUnavailability();
    const items = all.filter((u) => u.kind === 'faculty_leave' && u.target.id === user.faculty_id);
    if (items.length === 0) {
      renderEmpty(box, 'No leave marked', 'Use "Mark leave" when you will be away.');
      return;
    }
    // One row per leave, in a table like the design's.
    const rows = items
      .map((u) => {
        // Withdrawing is only allowed while the HOD has not decided anything yet.
        const canWithdraw = u.status === 'active' && u.pending_count === u.affected_count;
        const counts = `${escapeHtml(u.affected_count)} ${u.affected_count === 1 ? 'class' : 'classes'} affected, ${escapeHtml(u.pending_count)} waiting for the HOD`;
        const status =
          u.status === 'withdrawn'
            ? '<span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"><span class="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden="true"></span>Withdrawn</span>'
            : '<span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"><span class="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true"></span>Active</span>';
        return `
        <tr>
          <td class="px-3 py-3">
            <p class="font-medium text-slate-900">${escapeHtml(dateRange(u))}</p>
            <p class="text-xs text-slate-500">${u.periods ? `P${escapeHtml(u.periods.join(', P'))}` : 'Whole day'}</p>
            <p class="mt-1 text-xs text-slate-600 md:hidden"><span class="sm:hidden">${escapeHtml(u.reason)} · </span>${counts}</p>
          </td>
          <td class="hidden px-3 py-3 text-slate-700 sm:table-cell">${escapeHtml(u.reason)}</td>
          <td class="hidden px-3 py-3 text-slate-600 md:table-cell">${counts}</td>
          <td class="hidden px-3 py-3 sm:table-cell">${status}</td>
          <td class="px-3 py-3 text-right">
            ${canWithdraw ? `<button type="button" class="btn-danger px-3 py-1.5 text-xs" data-withdraw="${escapeHtml(u.id)}">Withdraw</button>` : ''}
          </td>
        </tr>`;
      })
      .join('');
    box.innerHTML = `
      <div class="overflow-hidden rounded-lg border border-slate-200">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th scope="col" class="px-3 py-2.5 font-medium">Dates</th>
              <th scope="col" class="hidden px-3 py-2.5 font-medium sm:table-cell">Reason</th>
              <th scope="col" class="hidden px-3 py-2.5 font-medium md:table-cell">Classes</th>
              <th scope="col" class="hidden px-3 py-2.5 font-medium sm:table-cell">Status</th>
              <th scope="col" class="px-3 py-2.5"><span class="sr-only">Withdraw</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">${rows}</tbody>
        </table>
      </div>`;
    box.querySelectorAll('[data-withdraw]').forEach((button) => {
      const u = items.find((x) => x.id === Number(button.dataset.withdraw));
      button.addEventListener('click', () => withdraw(button, u));
    });
  } catch (err) {
    renderError(box, err, loadLeave);
  }
}

async function withdraw(button, u) {
  if (!window.confirm(`Withdraw your leave for ${dateRange(u)}? Your classes will go back to normal.`)) return;
  button.disabled = true;
  try {
    const result = await withdrawUnavailability(u.id);
    showToast(`Leave withdrawn. ${classes(result.restored.length)} put back on the timetable.`, 'success');
    $('#saved').classList.add('hidden');
    loadLeave();
    if (calendar) loadWeek();
  } catch (err) {
    button.disabled = false;
    if (err.code === 'STALE') {
      showToast('Someone else changed this leave. Showing the latest version.', 'error');
      loadLeave();
    } else {
      showToast(err.detail, 'error');
    }
  }
}
