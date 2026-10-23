// Timetables page: any batch, teacher or room, for any week.
// Opened from the search box as timetable.html?batch=3, ?faculty=11 or ?room=10.
// Batches are grouped by programme (AI&DS, MBA, M.Sc., Executive) and semester. Below the grid,
// "Checks" lists every clash across all batches and the details on the sheets that need checking.
import { animate, stagger } from 'motion';
import { getCalendar, getClashes, getTimetable, listBatches, listFaculty, listSpaces } from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { renderTimetableGrid } from '../lib/timetable-grid.js';
import { refreshPills } from '../lib/motion.js';
import { $, escapeHtml, formatDate, addDays, roomCode, renderLoading, renderError, renderEmpty, prefersReducedMotion } from '../lib/ui.js';

// What each choice means: its URL parameter, its getTimetable() option and what the grid cards show.
const MODES = {
  batch: { label: 'Batch', apiKey: 'batchId', show: 'faculty' },
  faculty: { label: 'Teacher', apiKey: 'facultyId', show: 'batch' },
  room: { label: 'Room', apiKey: 'spaceId', show: 'both' },
};
// How each kind of clash is labelled. Full class names, so Tailwind can see them.
const CLASH_TYPE = { faculty: 'Teacher', room: 'Room', batch: 'Batch' };

const user = requireLogin(['hod', 'faculty', 'student']);
if (user) {
  renderHeader(user);
  start();
}

let calendar = null;
let weekStart = null;
let lists = { batch: [], faculty: [], room: [] };
let mode = 'batch';
let targetId = null;
let loadTicket = 0; // ignores answers that arrive after the user has already picked something else

async function start() {
  renderLoading($('#week-grid'), 'Loading timetables...');
  try {
    const [cal, batches, faculty, spaces] = await Promise.all([getCalendar(), listBatches(), listFaculty(), listSpaces()]);
    calendar = cal;
    weekStart = cal.current_week_start;
    lists = { batch: batches, faculty: [...faculty].sort((a, b) => sortName(a.name).localeCompare(sortName(b.name))), room: spaces };
  } catch (err) {
    renderError($('#week-grid'), err, start);
    return;
  }

  [mode, targetId] = initialChoice();
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  refreshPills(); // the sliding highlight moves to that tab
  fillTargets();

  document.querySelectorAll('input[name="mode"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      mode = radio.value;
      targetId = ownId(mode) ?? lists[mode][0]?.id ?? null;
      fillTargets();
      loadWeek();
    }),
  );
  $('#target').addEventListener('change', () => {
    targetId = Number($('#target').value);
    loadWeek();
  });
  // The semester buttons switch to another batch of the same programme.
  $('#siblings').addEventListener('click', (event) => {
    const button = event.target.closest('[data-batch]');
    if (!button) return;
    targetId = Number(button.dataset.batch);
    $('#target').value = String(targetId);
    loadWeek();
  });
  $('#prev-week').addEventListener('click', () => changeWeek(-7));
  $('#next-week').addEventListener('click', () => changeWeek(7));
  loadWeek();
  loadReview();
}

/** "Dr. Ritika Verma" sorts under R, not D. */
const sortName = (name) => name.split(' ').filter((w) => !w.endsWith('.')).join(' ');

/** The address decides first (?batch=3, ?faculty=11, ?room=10); otherwise the user's own timetable. */
function initialChoice() {
  const params = new URLSearchParams(window.location.search);
  for (const key of Object.keys(MODES)) {
    const id = Number(params.get(key));
    if (id && lists[key].some((item) => item.id === id)) return [key, id];
  }
  const own = user.role === 'student' ? 'batch' : 'faculty';
  if (ownId(own)) return [own, ownId(own)];
  // The HOD teaches no classes, so they start on the first batch.
  return ['batch', lists.batch[0]?.id ?? null];
}

/** The logged-in user's own batch or teacher id, if this mode has one (and they have classes). */
function ownId(forMode) {
  const id = forMode === 'batch' ? user.batch_id : forMode === 'faculty' ? user.faculty_id : null;
  const item = lists[forMode].find((x) => x.id === id);
  if (!item || (forMode === 'faculty' && !item.weekly_load)) return null;
  return id;
}

function optionLabel(forMode, item) {
  if (forMode === 'batch') return `Semester ${item.semester} · ${item.code}`;
  if (forMode === 'faculty') return item.name;
  return `${item.code} · ${item.name}`;
}

/** Batches are grouped by programme; teachers are in name order; rooms as they are. */
function fillTargets() {
  const select = $('#target');
  $('#target-label').textContent = MODES[mode].label;
  const option = (item) =>
    `<option value="${item.id}" ${item.id === targetId ? 'selected' : ''}>${escapeHtml(optionLabel(mode, item))}</option>`;
  const group = (label, list) => (list.length ? `<optgroup label="${escapeHtml(label)}">${list.map(option).join('')}</optgroup>` : '');
  if (mode === 'batch') {
    const programmes = [...new Set(lists.batch.map((b) => b.program))];
    select.innerHTML = programmes.map((p) => group(p, lists.batch.filter((b) => b.program === p))).join('');
  } else if (mode === 'room') {
    select.innerHTML = group('Rooms', lists.room.filter((s) => s.kind === 'room')) + group('Labs', lists.room.filter((s) => s.kind === 'lab'));
  } else {
    select.innerHTML = lists[mode].map(option).join('');
  }
  select.disabled = lists[mode].length === 0;
}

function changeWeek(days) {
  weekStart = addDays(weekStart, days);
  loadWeek();
}

/** The line under the page title. */
function describe(item) {
  if (!item) return '';
  if (mode === 'batch') return item.name;
  if (mode === 'faculty') return `${item.name} · ${item.designation}`;
  return `${item.code} · ${item.name}${item.capacity ? ` · ${item.capacity} seats` : ''}`;
}

/** Programme, semester, room, class teacher and start date of a batch; a teacher's batches; a room's batch. */
function showDetails(item) {
  const details = $('#details');
  const review = $('#batch-review');
  const siblings = $('#siblings');
  const pair = (label, value) => `<div><dt class="text-xs text-slate-500">${escapeHtml(label)}</dt><dd class="font-medium text-slate-900">${escapeHtml(value)}</dd></div>`;
  let rows = [];
  if (item && mode === 'batch') {
    const room = lists.room.find((s) => s.id === item.home_space_id);
    rows = [
      pair('Programme', item.program),
      pair('Semester', String(item.semester)),
      pair('Room', room ? room.code : 'Not given on the sheet'),
      pair('Class teacher', item.class_teacher?.name ?? 'Not given'),
      pair('Days', item.days.length === 7 ? 'Every day' : item.days.join(', ')),
      pair('From', formatDate(item.wef)),
    ];
  } else if (item && mode === 'faculty') {
    rows = [pair('Teaches', item.batches.length ? item.batches.join(', ') : 'No classes on the sheets'), pair('Classes a week', String(item.weekly_load))];
  } else if (item && mode === 'room') {
    const users = lists.batch.filter((b) => b.home_space_id === item.id).map((b) => b.code);
    rows = [pair('Home room of', users.length ? users.join(', ') : 'No batch')];
  }
  details.innerHTML = rows.join('');
  details.classList.toggle('hidden', rows.length === 0);
  details.classList.toggle('grid', rows.length > 0);

  // The other semesters of this batch's programme, as buttons.
  const others = item && mode === 'batch' ? lists.batch.filter((b) => b.program === item.program) : [];
  siblings.innerHTML = others.length > 1
    ? `<span class="mr-1 text-xs text-slate-500">${escapeHtml(item.program)}:</span>${others
        .map(
          (b) =>
            `<button type="button" data-batch="${b.id}" aria-pressed="${b.id === item.id}" class="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition-colors not-aria-pressed:hover:bg-slate-100 aria-pressed:border-transparent aria-pressed:bg-card-blue aria-pressed:text-slate-900">Sem ${escapeHtml(b.semester)}</button>`,
        )
        .join('')}`
    : '';
  siblings.classList.toggle('hidden', others.length <= 1);
  siblings.classList.toggle('flex', others.length > 1);

  // Classes the app moved away from the sheet's times, to remove a clash.
  const moved = item && mode === 'batch' ? item.changes ?? [] : [];
  $('#batch-changes').innerHTML = moved.length
    ? `<p class="font-medium">Changed from the sheet to remove clashes:</p><ul class="mt-1 list-disc space-y-0.5 pl-5">${moved.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : '';
  $('#batch-changes').classList.toggle('hidden', moved.length === 0);

  // What needs checking on this batch's sheet.
  const notes = item && mode === 'batch' ? item.review : [];
  review.innerHTML = notes.length
    ? `<p class="font-medium">Please check on the sheet (${escapeHtml(item.sheet)}):</p><ul class="mt-1 list-disc space-y-0.5 pl-5">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : '';
  review.classList.toggle('hidden', notes.length === 0);
}

async function loadWeek() {
  const ticket = ++loadTicket;
  const item = lists[mode].find((x) => x.id === targetId);
  $('#week-label').textContent = `Week of ${formatDate(weekStart)}`;
  $('#subtitle').textContent = describe(item);
  $('#grid-title').textContent = item ? `${MODES[mode].label}: ${mode === 'faculty' ? item.name : item.code}` : 'This week';
  showDetails(item);
  loadClashes();

  // Keep the address in step, so a reload or a shared link opens the same timetable.
  if (item) history.replaceState(null, '', `?${mode}=${item.id}${window.location.hash}`);

  if (!item) {
    renderEmpty($('#week-grid'), `No ${MODES[mode].label.toLowerCase()} to show`, 'Pick another one above.');
    return;
  }
  renderLoading($('#week-grid'), 'Loading the timetable...');
  try {
    const week = await getTimetable({ weekStart, [MODES[mode].apiKey]: targetId });
    if (ticket !== loadTicket) return;
    if (week.entries.length === 0) {
      const before = mode === 'batch' && weekStart < item.wef;
      renderEmpty($('#week-grid'), 'No classes this week', before ? `This timetable starts on ${formatDate(item.wef)}.` : 'Try another week with the arrows above.');
      return;
    }
    renderTimetableGrid($('#week-grid'), week, calendar, { show: MODES[mode].show });
    if (!prefersReducedMotion()) {
      animate('.tt-card', { opacity: [0, 1], y: [6, 0] }, { duration: 0.25, delay: stagger(0.008) });
    }
  } catch (err) {
    if (ticket !== loadTicket) return;
    renderError($('#week-grid'), err, loadWeek);
  }
}

// ------------------------------------------------------------------ checks: clashes and details to confirm

let clashTicket = 0;

/** Every clash in the shown week, across all batches. The ones that touch the chosen timetable come first. */
async function loadClashes() {
  const box = $('#clashes');
  const ticket = ++clashTicket;
  renderLoading(box, 'Looking for clashes...');
  try {
    const answer = await getClashes({ weekStart });
    if (ticket !== clashTicket) return;
    const n = answer.items.length;
    $('#clash-label').textContent = `Week of ${formatDate(answer.week_start)} · ${n === 1 ? '1 clash' : `${n} clashes`}`;
    if (n === 0) {
      renderEmpty(box, 'No clashes this week', 'No teacher, room or batch has two classes at once.');
      return;
    }
    const mine = (c) =>
      c.classes.some((x) => (mode === 'batch' && x.batch.id === targetId) || (mode === 'faculty' && x.faculty?.id === targetId) || (mode === 'room' && x.space?.id === targetId));
    const items = [...answer.items].sort((a, b) => mine(b) - mine(a));
    box.innerHTML = `<ul class="grid gap-2 lg:grid-cols-2">${items
      .map(
        (c) => `
        <li class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded bg-red-200 px-1.5 py-0.5 text-[11px] font-semibold text-red-900">${CLASH_TYPE[c.type]}</span>
            <span class="text-xs font-medium">${escapeHtml(c.day)} ${escapeHtml(c.start)}-${escapeHtml(c.end)}</span>
            ${mine(c) ? '<span class="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-medium">In this timetable</span>' : ''}
          </div>
          <p class="mt-1.5 font-medium">${escapeHtml(c.message)}</p>
          <ul class="mt-1.5 space-y-0.5 text-xs opacity-80">${c.classes
            .map(
              (x) =>
                `<li><a class="underline-offset-2 hover:underline" href="?batch=${x.batch.id}#checks">${escapeHtml(x.batch.code)}</a> · ${escapeHtml(x.subject.code)} · ${escapeHtml(x.start)}-${escapeHtml(x.end)} · ${escapeHtml(roomCode(x.space))}</li>`,
            )
            .join('')}</ul>
        </li>`,
      )
      .join('')}</ul>`;
  } catch (err) {
    if (ticket !== clashTicket) return;
    renderError(box, err, loadClashes);
  }
}

/** Everything flagged while typing in the sheets: per batch, then about teachers' names. */
function loadReview() {
  const batches = lists.batch.filter((b) => b.review.length);
  const people = lists.faculty.filter((f) => f.note);
  if (!batches.length && !people.length) {
    renderEmpty($('#review'), 'Nothing to check');
    return;
  }
  const block = (title, notes, link) => `
    <li class="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
      <p class="font-medium">${link ? `<a class="underline-offset-2 hover:underline" href="${link}">${escapeHtml(title)}</a>` : escapeHtml(title)}</p>
      <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </li>`;
  $('#review').innerHTML = `<ul class="grid gap-2 lg:grid-cols-2">${[
    ...batches.map((b) => block(`${b.code} · ${b.sheet}`, b.review, `?batch=${b.id}`)),
    people.length ? block("Teachers' names", people.map((f) => `${f.name}: ${f.note}`)) : '',
  ].join('')}</ul>`;
}
