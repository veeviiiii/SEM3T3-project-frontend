// HOD dashboard: this week's numbers, a calendar of the classes that changed, the classes waiting
// for a decision, the latest activity, a ring chart of this week's changes, and a form to mark
// a teacher absent, close a room, or take a batch away for an event.
// Same pattern as student.js:
//   1. check the login   2. draw the header   3. show "Loading..."
//   4. ask api.js for data   5. draw it   6. react to clicks
import {
  getAnalyticsSummary,
  getTimetable,
  listProposals,
  listActivity,
  getCalendar,
  listFaculty,
  listSpaces,
  listBatches,
  createUnavailability,
} from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { renderTimetableGrid } from '../lib/timetable-grid.js';
import { logoMark } from '../lib/icons.js';
import {
  $,
  escapeHtml,
  formatDate,
  addDays,
  initials,
  statusInfo,
  renderLoading,
  renderError,
  renderEmpty,
  showToast,
  prefersReducedMotion,
} from '../lib/ui.js';

// The four number cards: label, field of getAnalyticsSummary(), and card colour (full class names for Tailwind).
// The same meaning everywhere: blue = waiting, green = moved, red = cancelled. The total is orange.
const STATS = [
  { label: 'Classes this week', field: 'classes_total', colour: 'bg-card-orange' },
  { label: 'Waiting for you', field: 'pending_approvals', colour: 'bg-card-blue' },
  { label: 'Moved', field: 'moved', colour: 'bg-card-green' },
  { label: 'Cancelled', field: 'cancelled', colour: 'bg-card-red' },
];

// The ring chart: one piece per kind of change, coloured exactly like its number card above.
// `colour` fills the piece and `edge` outlines it (CSS variables from styles.css, so they change with
// light / dark mode: in dark mode the card colours are dark, so the outline keeps the piece visible).
// `text` is for the percentage.
const RING = [
  { label: 'Waiting for a new time', field: 'pending', colour: 'var(--color-card-blue)', edge: 'var(--ring-edge-blue)', text: 'text-blue-700' },
  { label: 'Moved', field: 'moved', colour: 'var(--color-card-green)', edge: 'var(--ring-edge-green)', text: 'text-green-700' },
  { label: 'Cancelled', field: 'cancelled', colour: 'var(--color-card-red)', edge: 'var(--ring-edge-red)', text: 'text-red-600' },
];

// The "What" choices in the form: the word above the second dropdown.
const TARGET_LABEL = { faculty_leave: 'Teacher', room_closure: 'Room', batch_event: 'Batch' };

// Where each field's error message goes: field name from the server -> id of the red text under it.
const ERROR_BOX = {
  target_id: 'target-error',
  start_date: 'from-error',
  end_date: 'to-error',
  periods: 'periods-error',
  reason: 'reason-error',
};

let calendar = null; // days, period times and this week, for the calendar card
let weekStart = null; // the week the calendar card shows
let formData = null; // the calendar and the teacher / room / batch lists for the form, fetched the first time it opens

// 1 + 2. Only the HOD may be here.
const user = requireLogin(['hod']);
if (user) {
  renderHeader(user);
  $('#greeting').textContent = `${greeting()}, ${shortName(user.name)}`;
  loadSummary();
  loadCalendar();
  loadWaiting();
  loadActivity();
  setUpForm();
}

/** "Good morning" / "Good afternoon" / "Good evening", from the computer's clock. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Dr. Rakesh Jain" -> "Dr. Jain", "Rakesh Jain" -> "Rakesh" */
function shortName(name) {
  const parts = name.split(' ');
  return parts[0].endsWith('.') ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

// ------------------------------------------------------------------ number cards + ring chart

/** One call to getAnalyticsSummary() fills both the number cards and the ring chart. */
async function loadSummary() {
  renderLoading($('#stats'), 'Loading this week...');
  renderLoading($('#breakdown'), 'Loading...');
  try {
    const summary = await getAnalyticsSummary();
    if (!summary) {
      renderEmpty($('#stats'), 'No numbers for this week yet');
      renderEmpty($('#breakdown'), 'No numbers for this week yet');
      return;
    }
    drawStats(summary);
    drawRing(summary);
  } catch (err) {
    renderError($('#stats'), err, loadSummary);
    renderError($('#breakdown'), err, loadSummary);
  }
}

function drawStats(summary) {
  const total = Number(summary.classes_total) || 0;
  // "2% of the week" (how many of this week's classes this number is).
  const share = (n) => `${total ? Math.round((n / total) * 100) : 0}% of the week`;
  const pills = {
    classes_total: `${summary.scheduled} as planned`,
    pending_approvals: 'Review now',
    moved: share(summary.moved),
    cancelled: share(summary.cancelled),
  };
  $('#stats').innerHTML = `<div class="grid grid-cols-2 gap-3 md:grid-cols-4">${STATS.map((s, i) => {
    const delay = `style="animation-delay: ${i * 60}ms"`; // the cards appear one after the other
    const inside = `
      <div class="flex items-start justify-between gap-2">
        <p class="text-sm text-slate-800">${s.label}</p>
        ${s.field === 'pending_approvals' ? `<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-slate-700" aria-hidden="true">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg></span>` : ''}
      </div>
      <p class="mt-1 font-display text-3xl font-medium tabular-nums text-slate-900" data-count="${escapeHtml(summary[s.field])}">${escapeHtml(summary[s.field])}</p>
      <div class="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-4 text-xs text-slate-700">
        <span>This week</span>
        <span class="rounded-full bg-white px-2 py-0.5 font-medium text-slate-800">${escapeHtml(pills[s.field])}</span>
      </div>`;
    // "Waiting for you" is the blue one and opens the Approvals page.
    return s.field === 'pending_approvals'
      ? `<a href="/approvals.html" class="lift flex min-h-36 animate-fade-up flex-col rounded-xl ${s.colour} p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400" ${delay}>${inside}</a>`
      : `<div class="lift flex min-h-36 animate-fade-up flex-col rounded-xl ${s.colour} p-4" ${delay}>${inside}</div>`;
  }).join('')}</div>`;
  countUp($('#stats'));
}

/** The big numbers count up from 0 when they appear (not for people who asked for less motion). */
function countUp(root) {
  if (prefersReducedMotion()) return;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count);
    if (!Number.isFinite(end) || end <= 0) return;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / 700, 1);
      el.textContent = Math.round(end * (1 - (1 - t) ** 3)); // fast at first, slow at the end
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** A ring split into this week's changes, drawn with SVG: each piece is a dashed circle. */
function drawRing(summary) {
  const box = $('#breakdown');
  $('#breakdown-label').textContent = `Week of ${formatDate(summary.week_start)}`;
  const parts = RING.map((r) => ({ ...r, value: Number(summary[r.field]) || 0 }));
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) {
    renderEmpty(box, 'No changes this week', 'Every class is on as planned.');
    return;
  }

  const radius = 70;
  const around = 2 * Math.PI * radius; // the length of the whole ring
  const shown = parts.filter((p) => p.value > 0);
  const gap = shown.length > 1 ? 6 : 0; // a small white gap between the pieces
  let start = 0;
  const edge = 1.5; // the outline's width
  const pieces = shown
    .map((p, i) => {
      const length = Math.max((p.value / total) * around - gap, 2 * edge + 1);
      // Each piece is drawn twice: a wide arc in the outline colour, then a slightly thinner and shorter
      // arc in the card colour on top, which leaves a thin outline all round.
      // .ring-piece (styles.css) draws each piece in, one after the other.
      const timing = `animation-delay: ${i * 150}ms`;
      const piece = `
        <circle class="ring-piece" style="stroke: ${p.edge}; ${timing}" cx="90" cy="90" r="${radius}" fill="none" stroke-width="26"
          stroke-dasharray="${length} ${around}" stroke-dashoffset="${-start}" />
        <circle class="ring-piece" style="stroke: ${p.colour}; ${timing}" cx="90" cy="90" r="${radius}" fill="none" stroke-width="${26 - 2 * edge}"
          stroke-dasharray="${length - 2 * edge} ${around}" stroke-dashoffset="${-(start + edge)}" />`;
      start += (p.value / total) * around;
      return piece;
    })
    .join('');

  box.innerHTML = `
    <div class="relative mx-auto my-2 h-44 w-44">
      <svg viewBox="0 0 180 180" class="h-full w-full -rotate-90" aria-hidden="true">${pieces}</svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <p class="font-display text-3xl font-semibold tabular-nums text-slate-900" data-count="${total}">${total}</p>
        <p class="text-xs text-slate-500">classes changed</p>
      </div>
    </div>
    <ul class="mt-3 space-y-2">${parts
      .map(
        (p) => `
      <li class="flex items-center gap-2 text-sm">
        <span class="h-3.5 w-3.5 shrink-0 rounded" style="background: ${p.colour}; box-shadow: inset 0 0 0 1.5px ${p.edge}" aria-hidden="true"></span>
        <span class="min-w-0 flex-1 text-slate-700">${p.label}</span>
        <span class="tabular-nums text-slate-700">${escapeHtml(p.value)}</span>
        <span class="text-slate-300" aria-hidden="true">|</span>
        <span class="w-10 text-right font-medium tabular-nums ${p.text}">${Math.round((p.value / total) * 100)}%</span>
      </li>`,
      )
      .join('')}</ul>`;
  countUp(box);
}

// ------------------------------------------------------------------ calendar of this week's changes

async function loadCalendar() {
  renderLoading($('#changes-grid'), 'Loading the calendar...');
  try {
    calendar = await getCalendar();
    weekStart = calendar.current_week_start;
  } catch (err) {
    renderError($('#changes-grid'), err, loadCalendar);
    return;
  }
  $('#prev-week').addEventListener('click', () => changeWeek(-7));
  $('#next-week').addEventListener('click', () => changeWeek(7));
  $('#this-week').addEventListener('click', () => {
    weekStart = calendar.current_week_start;
    loadChanges();
  });
  loadChanges();
}

function changeWeek(days) {
  weekStart = addDays(weekStart, days);
  loadChanges();
}

async function loadChanges() {
  const box = $('#changes-grid');
  $('#calendar-label').textContent = `Week of ${formatDate(weekStart)}`;
  renderLoading(box, 'Loading the calendar...');
  try {
    // The whole department's week, then only the classes that are not "as planned".
    const week = await getTimetable({ weekStart });
    const changed = week.entries.filter((e) => e.status !== 'scheduled');
    if (changed.length === 0) {
      renderEmpty(box, 'Nothing changed this week', 'Every class is on as planned.');
      return;
    }
    renderTimetableGrid(box, { ...week, entries: changed }, calendar, { show: 'both' });
  } catch (err) {
    renderError(box, err, loadChanges);
  }
}

// ------------------------------------------------------------------ "Waiting for you" table

async function loadWaiting() {
  const box = $('#waiting');
  renderLoading(box, 'Loading the classes waiting for you...');
  try {
    const proposals = await listProposals({ status: 'pending' });
    if (proposals.length === 0) {
      renderEmpty(box, 'Nothing is waiting for you', 'When a class is cancelled, it shows up here so you can pick a new slot.');
      return;
    }
    const rows = proposals
      .map((p) => {
        const o = p.original;
        // The slot the system recommends is the option whose rank is recommended_rank.
        const best = p.options.find((opt) => opt.rank === p.recommended_rank);
        const suggested = best ? `${formatDate(best.date)} ${best.start}, ${best.space.code}` : 'No free slot found';
        return `
        <tr>
          <td class="px-3 py-3">
            <div class="flex items-center gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card-orange text-xs font-semibold text-slate-800" aria-hidden="true">${escapeHtml(initials(o.subject.name))}</span>
              <div class="min-w-0">
                <p class="font-medium text-slate-900">${escapeHtml(o.subject.name)} <span class="font-normal text-slate-500">· ${escapeHtml(o.batch.code)}</span></p>
                <p class="text-xs text-slate-500">Was ${escapeHtml(formatDate(o.date))}, ${escapeHtml(o.start)} · ${escapeHtml(p.reason)}</p>
                <p class="mt-1 text-xs font-medium text-blue-700 sm:hidden">Suggested: ${escapeHtml(suggested)}</p>
              </div>
            </div>
          </td>
          <td class="hidden px-3 py-3 md:table-cell">
            <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              <span class="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true"></span>Waiting
            </span>
          </td>
          <td class="hidden px-3 py-3 sm:table-cell">
            <span class="inline-block whitespace-nowrap rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">${escapeHtml(suggested)}</span>
          </td>
          <td class="px-3 py-3 text-right">
            <a href="/approvals.html?id=${escapeHtml(p.id)}" class="btn-secondary px-3 py-1.5 text-xs">
              Review<span class="sr-only"> ${escapeHtml(o.subject.code)} for ${escapeHtml(o.batch.code)}</span>
            </a>
          </td>
        </tr>`;
      })
      .join('');
    box.innerHTML = `
      <div class="overflow-hidden rounded-lg border border-slate-200">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th scope="col" class="px-3 py-2.5 font-medium">Class</th>
              <th scope="col" class="hidden px-3 py-2.5 font-medium md:table-cell">Status</th>
              <th scope="col" class="hidden px-3 py-2.5 font-medium sm:table-cell">Suggested</th>
              <th scope="col" class="px-3 py-2.5"><span class="sr-only">Review</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">${rows}</tbody>
        </table>
      </div>`;
  } catch (err) {
    renderError(box, err, loadWaiting);
  }
}

// ------------------------------------------------------------------ latest activity

async function loadActivity() {
  const box = $('#activity');
  renderLoading(box, 'Loading the latest activity...');
  try {
    const page = await listActivity({ limit: 5 });
    if (page.items.length === 0) {
      renderEmpty(box, 'Nothing has happened yet', 'Leave, approvals and changes will show up here.');
      return;
    }
    box.innerHTML = `<ul class="space-y-3">${page.items
      .map(
        (a) => `
        <li class="flex items-start gap-2.5">
          ${
            a.actor
              ? `<span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card-orange text-[10px] font-semibold text-slate-800" title="${escapeHtml(a.actor.name)}">${escapeHtml(initials(a.actor.name))}</span>`
              : `<span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100" title="System">${logoMark('h-3.5 w-3.5')}</span>`
          }
          <div class="min-w-0">
            <p class="text-sm text-slate-700">${escapeHtml(a.summary)}</p>
            <p class="text-xs text-slate-400">${escapeHtml(formatDate(a.at.slice(0, 10)))}, ${escapeHtml(a.at.slice(11, 16))} · ${escapeHtml(a.actor?.name ?? 'System')}</p>
          </div>
        </li>`,
      )
      .join('')}</ul>`;
  } catch (err) {
    renderError(box, err, loadActivity);
  }
}

// ------------------------------------------------------------------ "Mark absence / close a room" form

function setUpForm() {
  // The three buttons open the same form, each with its own "What" already chosen.
  document.querySelectorAll('[data-kind]').forEach((button) => button.addEventListener('click', () => openForm(button)));
  $('#cancel-absence').addEventListener('click', () => $('#absence-dialog').close());
  $('#absence-form').addEventListener('submit', save);
  $('#kind').addEventListener('change', fillTargets);
  document.querySelectorAll('input[name="scope"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      $('#period-boxes').classList.toggle('hidden', !wantsSomePeriods());
      $('#periods-error').classList.add('hidden');
    }),
  );
  // Moving "From" past "To" moves "To" along with it.
  $('#absence-from').addEventListener('change', () => {
    if ($('#absence-to').value < $('#absence-from').value) $('#absence-to').value = $('#absence-from').value;
  });
}

function wantsSomePeriods() {
  return document.querySelector('input[name="scope"]:checked').value === 'some';
}

/** The first time: fetch the lists the form needs. Then empty the form and open it. */
async function openForm(button) {
  if (!formData) {
    button.disabled = true;
    try {
      const [cal, faculty, spaces, batches] = await Promise.all([getCalendar(), listFaculty(), listSpaces(), listBatches()]);
      formData = { calendar: cal, faculty, spaces, batches };
    } catch (err) {
      button.disabled = false;
      showToast(err.detail, 'error');
      return;
    }
    button.disabled = false;
    // One tick box per period, for "Only some periods".
    $('#period-list').innerHTML = formData.calendar.periods
      .map(
        (p) => `
        <label class="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-sm">
          <input type="checkbox" name="period" value="${escapeHtml(p.period)}" class="accent-blue-400" /> P${escapeHtml(p.period)}
          <span class="text-xs text-slate-500">${escapeHtml(p.start)}</span>
        </label>`,
      )
      .join('');
  }

  const today = formData.calendar.today;
  $('#absence-form').reset();
  $('#kind').value = button.dataset.kind;
  $('#absence-from').value = today;
  $('#absence-to').value = today;
  $('#absence-from').min = today;
  $('#absence-to').min = today;
  $('#period-boxes').classList.add('hidden');
  $('#save-absence').disabled = false;
  fillTargets();
  clearErrors();
  $('#absence-dialog').showModal();
}

/** Fills the second dropdown with teachers, rooms or batches, depending on "What". */
function fillTargets() {
  const kind = $('#kind').value;
  const options = {
    faculty_leave: formData.faculty.map((f) => [f.id, f.name]),
    room_closure: formData.spaces.map((s) => [s.id, `${s.code} · ${s.name}`]),
    batch_event: formData.batches.map((b) => [b.id, `${b.code} · ${b.name}`]),
  }[kind];
  $('#target-label').textContent = TARGET_LABEL[kind];
  $('#target').innerHTML = options
    .map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`)
    .join('');
}

function clearErrors() {
  document.querySelectorAll('#absence-form [data-error]').forEach((box) => {
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

async function save(event) {
  event.preventDefault();
  clearErrors();
  const from = $('#absence-from').value;
  const to = $('#absence-to').value;
  const wholeDay = !wantsSomePeriods();
  const periods = [...document.querySelectorAll('input[name="period"]:checked')].map((box) => Number(box.value));

  // Quick checks before asking the server (the server checks everything again).
  const problems = [];
  if (!$('#target').value) problems.push({ field: 'target_id', message: 'Please choose one' });
  if (!from) problems.push({ field: 'start_date', message: 'Please pick the first day' });
  if (!to) problems.push({ field: 'end_date', message: 'Please pick the last day' });
  else if (from && to < from) problems.push({ field: 'end_date', message: '"To" must be on or after "From"' });
  if (!wholeDay && periods.length === 0) problems.push({ field: 'periods', message: 'Tick at least one period, or choose Whole day' });
  if (problems.length) {
    showFieldErrors(problems);
    return;
  }

  const button = $('#save-absence');
  button.disabled = true;
  try {
    const result = await createUnavailability({
      kind: $('#kind').value,
      target_id: Number($('#target').value),
      start_date: from,
      end_date: to,
      periods: wholeDay ? null : periods, // null = the whole day
      reason: $('#absence-reason').value.trim(),
    });
    $('#absence-dialog').close();
    const n = result.affected.length;
    const message = `Saved. ${n === 1 ? '1 class was' : `${n} classes were`} cancelled and are waiting for you to pick new slots`;
    showToast(`${message}.`, 'success');
    renderSaved(message, result.affected);
    loadSummary();
    if (calendar) loadChanges();
    loadWaiting();
    loadActivity();
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
              <p class="text-sm opacity-80">${escapeHtml(formatDate(e.date))}, ${escapeHtml(e.start)} · ${escapeHtml(e.batch.code)} · ${escapeHtml(e.faculty.name)} · ${escapeHtml(e.space.code)}</p>
            </div>
            <span class="shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${info.badgeClass}">${escapeHtml(info.badge)}</span>
          </li>`;
        })
        .join('')}</ul>
    </div>`;
}
