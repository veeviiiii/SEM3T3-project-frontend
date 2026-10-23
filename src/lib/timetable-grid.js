// The weekly timetable. Every page that shows a timetable uses this one function.
// Wide screens get the whole week as a grid. Phones get one day at a time: a row of day buttons,
// then that day's classes as a list, so nothing is squeezed and nothing scrolls sideways.
// Each batch keeps the time slots of its own sheet (9:00-10:00, 11:30-12:30, ...), so the rows come
// from the week (week.slots and week.breaks), not from one fixed list of periods.
import { escapeHtml, statusInfo, addDays, formatDate, roomCode, teacherName } from './ui.js';
import { slideIn } from './motion.js';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const time = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Draws a week into `container`.
 *   week      - the answer from getTimetable() / getMyTimetable(): days, slots, breaks and entries
 *   calendar  - the answer from getCalendar() (today)
 *   options.show - what the small second line of each card shows:
 *                  "faculty" (good for students), "batch" (good for teachers) or "both"
 */
export function renderTimetableGrid(container, week, calendar, { show = 'faculty' } = {}) {
  // 1. The days and the rows. A row is one time slot; the classes in it are matched by their start and end.
  const days = week.days?.length ? week.days : WEEK.slice(0, 5);
  const dates = days.map((day) => addDays(week.week_start, WEEK.indexOf(day)));
  const times = new Map();
  for (const s of [...(week.slots ?? []), ...week.entries]) times.set(`${s.start}-${s.end}`, { start: s.start, end: s.end });
  const breaks = week.breaks ?? [];
  const rows = [...[...times.values()].map((t) => ({ ...t, kind: 'slot' })), ...breaks.map((b) => ({ ...b, kind: 'break' }))].sort(
    (a, b) => time(a.start) - time(b.start) || time(a.end) - time(b.end),
  );

  // 2. Classes in buckets by "date|start-end" for the grid, and by date (in time order) for the phone list.
  const cells = new Map();
  const byDate = new Map(dates.map((date) => [date, []]));
  for (const entry of [...week.entries].sort((a, b) => time(a.start) - time(b.start))) {
    const key = `${entry.date}|${entry.start}-${entry.end}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
    byDate.get(entry.date)?.push(entry);
  }
  const weekend = days.map((day) => day === 'Sat' || day === 'Sun');

  // 3. Header row: "Time", then one column per day. Today is blue.
  let html = '<div class="sticky left-0 z-10 bg-white px-2 py-2 text-xs font-medium text-slate-500">Time</div>';
  dates.forEach((date) => {
    const today = date === calendar.today;
    html += `<div class="px-2 py-2 text-center text-xs font-medium ${today ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-600'}">${escapeHtml(
      formatDate(date),
    )}${today ? ' · Today' : ''}</div>`;
  });

  // 4. One row per time slot, and a grey band for each break. Weekend columns are grey, like the design.
  for (const row of rows) {
    if (row.kind === 'break') {
      html += `<div class="col-span-full bg-slate-50 py-1.5 text-center text-xs text-slate-500">${escapeHtml(row.label)} · ${escapeHtml(row.start)}-${escapeHtml(row.end)}</div>`;
      continue;
    }
    html += `<div class="sticky left-0 z-10 bg-white px-2 py-2 text-xs text-slate-500">
               <div class="font-medium text-slate-800">${escapeHtml(row.start)}</div><span class="font-mono text-[10px]">${escapeHtml(row.end)}</span></div>`;
    dates.forEach((date, i) => {
      const entries = cells.get(`${date}|${row.start}-${row.end}`) || [];
      html += `<div class="min-h-16 space-y-1 p-1.5 ${weekend[i] ? 'bg-slate-100' : 'bg-white'}">${entries.map((e) => card(e, show)).join('')}</div>`;
    });
  }

  // 5. Which day the phone view shows: the same one as before when only the data changed,
  //    otherwise today (or the first day that has classes).
  const before = container.dataset.week;
  container.dataset.week = week.week_start;
  let day = before && container.dataset.phoneDay ? Math.min(Number(container.dataset.phoneDay), dates.length - 1) : startDay(dates, byDate, calendar.today);

  // 6. Phones (below 768px): day buttons + the chosen day's list. Wider screens: the grid, which may
  //    scroll sideways; the page itself does not. The 1px gaps between white cells, on a grey
  //    background, draw the grid lines.
  container.innerHTML = `
    <div class="animate-fade-in">
      <div class="md:hidden">
        <div class="grid gap-1" style="grid-template-columns: repeat(${dates.length}, minmax(0, 1fr));" role="group" aria-label="Pick a day" data-days>
          ${dates.map((date, i) => dayButton(date, i, calendar.today, weekend[i], byDate.get(date))).join('')}
        </div>
        <p class="mt-3 mb-2 text-xs text-slate-500" data-day-title></p>
        <div data-day-list></div>
      </div>
      <div class="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
        <div class="grid gap-px bg-slate-200" style="min-width: ${4 + dates.length * 7.5}rem; grid-template-columns: 4rem repeat(${dates.length}, minmax(0, 1fr));">
          ${html}
        </div>
      </div>
    </div>`;

  const list = container.querySelector('[data-day-list]');
  const showDay = () => {
    const date = dates[day];
    const entries = byDate.get(date);
    container.dataset.phoneDay = day;
    container.querySelectorAll('[data-day]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.day) === day)));
    const count = entries.length === 1 ? '1 class' : `${entries.length} classes`;
    container.querySelector('[data-day-title]').textContent = `${formatDate(date)}${date === calendar.today ? ' · Today' : ''} · ${count}`;
    list.innerHTML = dayList(date, entries, breaks, show);
  };
  showDay();

  // Tapping a day shows its classes; the list slides in from the side of the day you picked.
  container.querySelector('[data-days]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-day]');
    if (!button || Number(button.dataset.day) === day) return;
    const direction = Math.sign(Number(button.dataset.day) - day);
    day = Number(button.dataset.day);
    showDay();
    slideIn(list, direction);
  });

  // 7. After a week change, the new week slides in from the side you moved to (later weeks from the right).
  if (before && before !== week.week_start) slideIn(container.firstElementChild, week.week_start > before ? 1 : -1);
}

/** Today if it has classes, otherwise the first day with classes, otherwise today (or the first day). */
function startDay(dates, byDate, today) {
  const todayIndex = dates.indexOf(today);
  if (todayIndex !== -1 && byDate.get(today).length > 0) return todayIndex;
  const first = dates.findIndex((date) => byDate.get(date).length > 0);
  return first !== -1 ? first : Math.max(todayIndex, 0);
}

/** One day button for the phone view: "WED / 28", with a small orange dot when a class that day changed. */
function dayButton(date, index, today, weekend, entries) {
  const [dayName, dayNumber] = formatDate(date).split(' ');
  const changed = entries.some((e) => e.status !== 'scheduled');
  const colour = date === today ? 'text-blue-700' : weekend ? 'text-slate-400' : 'text-slate-600';
  return `
    <button type="button" data-day="${index}" aria-pressed="false" aria-label="${escapeHtml(formatDate(date))}${date === today ? ', today' : ''}${changed ? ', has changes' : ''}"
      class="flex flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors not-aria-pressed:hover:bg-slate-100 aria-pressed:bg-card-blue aria-pressed:text-slate-900 ${colour}">
      <span class="text-[10px] font-medium uppercase tracking-wide">${escapeHtml(dayName)}</span>
      <span class="text-base font-semibold leading-tight tabular-nums">${escapeHtml(dayNumber)}</span>
      <span class="h-1 w-1 rounded-full ${changed ? 'bg-orange-400' : 'bg-transparent'}" aria-hidden="true"></span>
    </button>`;
}

/** The phone list for one day: each class with its time on the left, and the breaks in between. */
function dayList(date, entries, breaks, show) {
  if (entries.length === 0) {
    return `<p class="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">Nothing on ${escapeHtml(formatDate(date))}.</p>`;
  }
  const rows = entries.map((entry, i) => {
    const previous = entries[i - 1];
    const between = breaks.filter((b) => previous && time(previous.end) <= time(b.start) && time(entry.start) >= time(b.end));
    return between.map(breakRow).join('') + listCard(entry, show);
  });
  return `<ol class="space-y-2">${rows.join('')}</ol>`;
}

function breakRow(b) {
  return `
    <li class="flex items-center gap-2 py-0.5 pl-14 text-[11px] text-slate-500">
      <span class="h-px flex-1 bg-slate-200" aria-hidden="true"></span>${escapeHtml(b.label)} · ${escapeHtml(b.start)}-${escapeHtml(b.end)}<span class="h-px flex-1 bg-slate-200" aria-hidden="true"></span>
    </li>`;
}

/** A small red tag on a class that clashes with another one (same teacher, room or batch at the same time). */
function clashTag(entry) {
  return entry.clash
    ? `<span class="mt-1 inline-block rounded bg-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-900" title="${escapeHtml(entry.clash)}">Clash</span>`
    : '';
}

/** One class in the phone list: full subject name, then code · who · room, then what changed and why. */
function listCard(entry, show) {
  const info = statusInfo(entry);
  return `
    <li class="flex gap-3">
      <div class="w-11 shrink-0 pt-2.5 text-right">
        <p class="text-sm font-medium tabular-nums text-slate-800">${escapeHtml(entry.start)}</p>
        <p class="font-mono text-[10px] text-slate-500">${escapeHtml(entry.end)}</p>
      </div>
      <div class="min-w-0 flex-1 rounded-lg border px-3 py-2.5 ${info.card} ${entry.clash ? 'ring-2 ring-red-300' : ''}">
        <p class="text-sm font-semibold leading-snug ${info.strike ? 'line-through' : ''}">${escapeHtml(entry.subject.name)}</p>
        <p class="mt-0.5 text-xs opacity-75">${escapeHtml(entry.subject.code)} · ${escapeHtml(who(entry, show))} · ${escapeHtml(roomCode(entry.space))}</p>
        ${info.badge ? `<span class="mt-2 inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${info.badgeClass}">${escapeHtml(info.badge)}</span>` : ''}
        ${info.badge && entry.reason ? `<p class="mt-1 text-xs opacity-75">${escapeHtml(entry.reason)}</p>` : ''}
        ${entry.clash ? `<p class="mt-1 text-xs font-medium text-red-700">${escapeHtml(entry.clash)}</p>` : ''}
      </div>
    </li>`;
}

// What the small second line of a card shows (see options.show above).
function who(entry, show) {
  return {
    faculty: teacherName(entry.faculty),
    batch: entry.batch.code,
    both: `${entry.batch.code} · ${teacherName(entry.faculty)}`,
  }[show];
}

function card(entry, show) {
  const info = statusInfo(entry);
  return `
    <div class="tt-card rounded-md border px-2 py-1.5 text-[11px] leading-snug transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${info.card} ${entry.clash ? 'ring-2 ring-red-300' : ''}" title="${escapeHtml(entry.subject.name)}${entry.clash ? ` (${escapeHtml(entry.clash)})` : ''}">
      <div class="font-semibold ${info.strike ? 'line-through' : ''}">${escapeHtml(entry.subject.code)}</div>
      <div class="truncate opacity-75">${escapeHtml(who(entry, show))}</div>
      <div class="opacity-75">${escapeHtml(roomCode(entry.space))}</div>
      ${info.badge ? `<span class="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${info.badgeClass}">${escapeHtml(info.badge)}</span>` : ''}
      ${clashTag(entry)}
    </div>`;
}
