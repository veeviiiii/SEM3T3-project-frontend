// Rooms page: is each room or lab free, busy or closed at a chosen date and hour?
import { getCalendar, getRoomAvailability } from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { $, escapeHtml, formatDate, teacherName, renderLoading, renderError, renderEmpty } from '../lib/ui.js';

// How each status looks. Class names are written out in full so Tailwind can see them.
const STATUS = {
  free: { text: 'Free', pill: 'bg-green-50 text-green-700', dot: 'bg-green-500', card: 'border-slate-200/70' },
  busy: { text: 'Busy', pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', card: 'border-slate-200/70' },
  closed: { text: 'Closed', pill: 'bg-red-50 text-red-700', dot: 'bg-red-500', card: 'border-red-200 bg-red-50/50' },
};
const KIND_WORDS = { all: ['room or lab', 'rooms and labs'], room: ['room', 'rooms'], lab: ['lab', 'labs'] };

const user = requireLogin(['hod', 'faculty', 'student']);
if (user) {
  renderHeader(user);
  start();
}

let calendar = null;
let availability = null;
let kind = 'all';
let loadTicket = 0;

async function start() {
  renderLoading($('#rooms'), 'Loading rooms...');
  try {
    calendar = await getCalendar();
  } catch (err) {
    renderError($('#rooms'), err, start);
    return;
  }
  $('#date').value = calendar.today;
  $('#period').innerHTML = calendar.periods
    .map((p) => `<option value="${p.period}">${p.start}-${p.end}</option>`)
    .join('');
  $('#period').value = String(calendar.now_period ?? calendar.periods[0].period);
  $('#date').disabled = false;
  $('#period').disabled = false;

  $('#date').addEventListener('change', load);
  $('#period').addEventListener('change', load);
  document.querySelectorAll('input[name="kind"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      kind = radio.value;
      render();
    }),
  );
  load();
}

async function load() {
  const date = $('#date').value;
  const period = Number($('#period').value);
  if (!date) {
    renderEmpty($('#rooms'), 'Pick a date', 'Choose a date and a period to see which rooms are free.');
    $('#summary').textContent = '';
    return;
  }
  const ticket = ++loadTicket;
  renderLoading($('#rooms'), 'Checking the rooms...');
  $('#summary').textContent = '';
  try {
    const answer = await getRoomAvailability({ date, period });
    if (ticket !== loadTicket) return;
    availability = { ...answer, period };
    render();
  } catch (err) {
    if (ticket !== loadTicket) return;
    renderError($('#rooms'), err, load);
  }
}

function render() {
  if (!availability) return;
  const p = calendar.periods.find((x) => x.period === availability.period);
  $('#results-title').textContent = `${formatDate(availability.date)}${p ? ` · ${p.start}-${p.end}` : ''}`;

  const shown = availability.spaces
    .filter((s) => kind === 'all' || s.space.kind === kind)
    .map((s) => ({ space: s.space, slot: s.slots.find((x) => x.period === availability.period) ?? s.slots[0] }));

  const [one, many] = KIND_WORDS[kind];
  if (shown.length === 0) {
    $('#summary').textContent = '';
    renderEmpty($('#rooms'), `No ${many} to show`, 'Try another filter.');
    return;
  }
  const free = shown.filter((x) => x.slot?.status === 'free').length;
  $('#summary').textContent = `${free} of ${shown.length} ${shown.length === 1 ? one : many} free`;
  $('#rooms').innerHTML = `<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${shown.map(roomCard).join('')}</ul>`;
}

function roomCard({ space, slot }) {
  const look = STATUS[slot?.status] ?? STATUS.busy;
  let detail = '';
  if (slot?.status === 'busy' && slot.entry) {
    detail = `
      <p class="mt-3 inline-block rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-900">${escapeHtml(slot.entry.batch.code)} · ${escapeHtml(slot.entry.subject.code)}</p>
      <p class="mt-1 text-xs text-slate-500">${escapeHtml(slot.entry.subject.name)} · ${escapeHtml(teacherName(slot.entry.faculty))}</p>`;
  } else if (slot?.status === 'closed') {
    detail = `<p class="mt-3 text-sm text-red-800">${escapeHtml(slot.note || 'Closed')}</p>`;
  }
  return `
    <li class="lift rounded-xl border bg-white p-4 ${look.card}">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card-orange text-[11px] font-semibold text-slate-800" aria-hidden="true">${escapeHtml(space.kind === 'lab' ? 'LAB' : 'R')}</span>
          <div class="min-w-0">
            <p class="font-medium text-slate-900">${escapeHtml(space.code)}</p>
            <p class="truncate text-xs text-slate-500">${escapeHtml(space.name)}${space.capacity ? ` · ${escapeHtml(space.capacity)} seats` : ''}</p>
          </div>
        </div>
        <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${look.pill}">
          <span class="h-1.5 w-1.5 rounded-full ${look.dot}" aria-hidden="true"></span>${look.text}
        </span>
      </div>
      ${detail}
    </li>`;
}
