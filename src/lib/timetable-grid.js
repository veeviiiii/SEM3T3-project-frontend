// The weekly timetable grid. Every page that shows a timetable uses this one function.
import { escapeHtml, statusInfo, addDays, formatDate } from './ui.js';
import { slideIn } from './motion.js';

/**
 * Draws a week into `container`.
 *   week      - the answer from getTimetable() / getMyTimetable()
 *   calendar  - the answer from getCalendar() (days, period times, today)
 *   options.show - what the small second line of each card shows:
 *                  "faculty" (good for students), "batch" (good for teachers) or "both"
 */
export function renderTimetableGrid(container, week, calendar, { show = 'faculty' } = {}) {
  // 1. Put entries in buckets by "date|period", so each cell can find its classes quickly.
  const cells = new Map();
  for (const entry of week.entries) {
    const key = `${entry.date}|${entry.period}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
  }

  const dates = calendar.days.map((_, i) => addDays(week.week_start, i));
  const weekend = calendar.days.map((day) => day === 'Sat' || day === 'Sun');
  const lunch = calendar.breaks[0];

  // 2. Header row: "Time", then one column per day. Today is blue.
  let html = '<div class="sticky left-0 z-10 bg-white px-2 py-2 text-xs font-medium text-slate-500">Time</div>';
  dates.forEach((date) => {
    const today = date === calendar.today;
    html += `<div class="px-2 py-2 text-center text-xs font-medium ${today ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-600'}">${escapeHtml(
      formatDate(date),
    )}${today ? ' · Today' : ''}</div>`;
  });

  // 3. One row per period (and the lunch break after period 4). Weekend columns are grey, like the design.
  for (const p of calendar.periods) {
    html += `<div class="sticky left-0 z-10 bg-white px-2 py-2 text-xs text-slate-500">
               <div class="font-medium text-slate-800">${escapeHtml(p.start)}</div><span class="font-mono text-[10px]">P${p.period}</span></div>`;
    dates.forEach((date, i) => {
      const entries = cells.get(`${date}|${p.period}`) || [];
      html += `<div class="min-h-16 space-y-1 p-1.5 ${weekend[i] ? 'bg-slate-100' : 'bg-white'}">${entries.map((e) => card(e, show)).join('')}</div>`;
    });
    if (lunch && p.period === lunch.after_period) {
      html += `<div class="col-span-full bg-slate-50 py-1.5 text-center text-xs text-slate-500">
                 ${escapeHtml(lunch.label)} · ${lunch.start}-${lunch.end}</div>`;
    }
  }

  // 4. The grid scrolls sideways on phones; the page itself does not.
  //    The 1px gaps between white cells, on a grey background, draw the grid lines.
  container.innerHTML = `
    <div class="animate-fade-in overflow-x-auto rounded-lg border border-slate-200">
      <div class="grid min-w-[760px] gap-px bg-slate-200" style="grid-template-columns: 4rem repeat(${dates.length}, minmax(0, 1fr));">
        ${html}
      </div>
    </div>`;

  // 5. After a week change, the new week slides in from the side you moved to (later weeks from the right).
  const before = container.dataset.week;
  container.dataset.week = week.week_start;
  if (before && before !== week.week_start) slideIn(container.firstElementChild, week.week_start > before ? 1 : -1);
}

function card(entry, show) {
  const info = statusInfo(entry);
  const second = {
    faculty: entry.faculty.name,
    batch: entry.batch.code,
    both: `${entry.batch.code} · ${entry.faculty.name}`,
  }[show];
  return `
    <div class="tt-card rounded-md border px-2 py-1.5 text-[11px] leading-snug transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${info.card}" title="${escapeHtml(entry.subject.name)}">
      <div class="font-semibold ${info.strike ? 'line-through' : ''}">${escapeHtml(entry.subject.code)}</div>
      <div class="truncate opacity-75">${escapeHtml(second)}</div>
      <div class="opacity-75">${escapeHtml(entry.space.code)}</div>
      ${info.badge ? `<span class="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${info.badgeClass}">${escapeHtml(info.badge)}</span>` : ''}
    </div>`;
}
