// Timetables page: any batch, teacher or room, for any week.
// Opened from the search box as timetable.html?batch=3, ?faculty=11 or ?room=10.
import { animate, stagger } from 'motion';
import { getCalendar, getTimetable, listBatches, listFaculty, listSpaces } from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { renderTimetableGrid } from '../lib/timetable-grid.js';
import { refreshPills } from '../lib/motion.js';
import { $, escapeHtml, formatDate, addDays, renderLoading, renderError, renderEmpty, prefersReducedMotion } from '../lib/ui.js';

// What each choice means: its URL parameter, its getTimetable() option and what the grid cards show.
const MODES = {
  batch: { label: 'Batch', apiKey: 'batchId', show: 'faculty' },
  faculty: { label: 'Teacher', apiKey: 'facultyId', show: 'batch' },
  room: { label: 'Room', apiKey: 'spaceId', show: 'both' },
};

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
    lists = { batch: batches, faculty, room: spaces };
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
  $('#prev-week').addEventListener('click', () => changeWeek(-7));
  $('#next-week').addEventListener('click', () => changeWeek(7));
  loadWeek();
}

/** The address decides first (?batch=3, ?faculty=11, ?room=10); otherwise the user's own timetable. */
function initialChoice() {
  const params = new URLSearchParams(window.location.search);
  for (const key of Object.keys(MODES)) {
    const id = Number(params.get(key));
    if (id && lists[key].some((item) => item.id === id)) return [key, id];
  }
  const own = user.role === 'student' ? 'batch' : 'faculty';
  return [own, ownId(own) ?? lists[own][0]?.id ?? null];
}

/** The logged-in user's own batch or teacher id, if this mode has one. */
function ownId(forMode) {
  const id = forMode === 'batch' ? user.batch_id : forMode === 'faculty' ? user.faculty_id : null;
  return id && lists[forMode].some((item) => item.id === id) ? id : null;
}

function optionLabel(forMode, item) {
  if (forMode === 'batch') return `${item.code} · ${item.name}`;
  if (forMode === 'faculty') return item.name;
  return `${item.code} · ${item.name}`;
}

function fillTargets() {
  const select = $('#target');
  $('#target-label').textContent = MODES[mode].label;
  const option = (item) =>
    `<option value="${item.id}" ${item.id === targetId ? 'selected' : ''}>${escapeHtml(optionLabel(mode, item))}</option>`;
  if (mode === 'room') {
    const rooms = lists.room.filter((s) => s.kind === 'room');
    const labs = lists.room.filter((s) => s.kind === 'lab');
    const group = (label, list) => (list.length ? `<optgroup label="${label}">${list.map(option).join('')}</optgroup>` : '');
    select.innerHTML = group('Rooms', rooms) + group('Labs', labs);
  } else {
    select.innerHTML = lists[mode].map(option).join('');
  }
  select.disabled = lists[mode].length === 0;
}

function changeWeek(days) {
  weekStart = addDays(weekStart, days);
  loadWeek();
}

/** "AI&DS-3 · M.Tech. (Dual Degree) AI&DS, Third Semester", "Ms. Ritika Verma · Class Teacher", "B-002 · Room B-002" */
function describe(item) {
  if (!item) return '';
  if (mode === 'batch') return `${item.code} · ${item.name}`;
  if (mode === 'faculty') return `${item.name} · ${item.designation}`;
  return `${item.code} · ${item.name}${item.capacity ? ` · ${item.capacity} seats` : ''}`;
}

async function loadWeek() {
  const ticket = ++loadTicket;
  const item = lists[mode].find((x) => x.id === targetId);
  $('#week-label').textContent = `Week of ${formatDate(weekStart)}`;
  $('#subtitle').textContent = describe(item);
  $('#grid-title').textContent = item ? `${MODES[mode].label}: ${mode === 'faculty' ? item.name : item.code}` : 'This week';

  // Keep the address in step, so a reload or a shared link opens the same timetable.
  if (item) history.replaceState(null, '', `?${mode}=${item.id}`);

  if (!item) {
    renderEmpty($('#week-grid'), `No ${MODES[mode].label.toLowerCase()} to show`, 'Pick another one above.');
    return;
  }
  renderLoading($('#week-grid'), 'Loading the timetable...');
  try {
    const week = await getTimetable({ weekStart, [MODES[mode].apiKey]: targetId });
    if (ticket !== loadTicket) return;
    if (week.entries.length === 0) {
      renderEmpty($('#week-grid'), 'No classes this week', 'Try another week with the arrows above.');
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
