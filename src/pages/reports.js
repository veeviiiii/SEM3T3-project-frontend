// Reports page (HOD): trend charts, room use, busy-slot heatmap, teachers most affected, activity log.
import Chart from 'chart.js/auto';
import { getAnalyticsTrends, listActivity } from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { $, escapeHtml, formatDate, initials, renderLoading, renderError, renderEmpty, showToast, prefersReducedMotion } from '../lib/ui.js';

const PAGE_SIZE = 20;
// Heatmap shades, quiet to busy: pastel blues (colours in styles.css). Written out in full so Tailwind can see them.
const SHADES = [
  'bg-heat-0 text-slate-400',
  'bg-heat-1 text-heat-ink',
  'bg-heat-2 text-heat-ink',
  'bg-heat-3 text-heat-ink',
  'bg-heat-4 text-heat-ink',
  'bg-heat-5 text-heat-ink',
];
// The app's chart colours, with the same meaning as on the dashboard: moved = green, cancelled = red.
// Rooms are blue and labs are orange. They are CSS variables (styles.css), so dark mode gets softer ones.
const COLOURS = { moved: '--chart-green', cancelled: '--chart-red', rooms: '--chart-blue', labs: '--chart-orange' };

const user = requireLogin(['hod']);
if (user) {
  renderHeader(user);
  loadTrends();
  loadActivity();
  $('#load-more').addEventListener('click', loadMore);
  // Light / dark mode switched: draw the charts again with the new colours, at once (no grow-in animation).
  window.addEventListener('themechange', () => {
    if (trends) drawCharts({ animate: false });
  });
}

let charts = [];
let trends = null; // the last answer from getAnalyticsTrends(), kept so the charts can be redrawn
let activity = { items: [], total: 0 };

// ------------------------------------------------------------------ charts, heatmap, teachers

async function loadTrends() {
  const box = $('#trends');
  renderLoading(box, 'Loading the reports...');
  try {
    trends = await getAnalyticsTrends();
    drawTrends(box);
  } catch (err) {
    renderError(box, err, loadTrends);
  }
}

/** A small colour key, like the one under the ring chart in the design. */
const key = (items) => `
  <ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">${items
    .map(([label, colour]) => `<li class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-[3px]" style="background: var(${colour})" aria-hidden="true"></span>${label}</li>`)
    .join('')}</ul>`;

function drawTrends(box) {
  box.innerHTML = `
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section class="card p-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h2 class="font-medium text-slate-900">Moved and cancelled classes per week</h2>
          ${key([['Moved', COLOURS.moved], ['Cancelled', COLOURS.cancelled]])}
        </div>
        <p class="mb-3 text-sm text-slate-500">The last ${trends.weeks.length} weeks</p>
        <div class="h-64"><canvas id="weeks-chart" role="img" aria-label="Bar chart of moved and cancelled classes per week"></canvas></div>
      </section>
      <section class="card p-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h2 class="font-medium text-slate-900">How much each room is used</h2>
          ${key([['Room', COLOURS.rooms], ['Lab', COLOURS.labs]])}
        </div>
        <p class="mb-3 text-sm text-slate-500">Share of the 42 weekly slots that have a class</p>
        <div class="h-64"><canvas id="rooms-chart" role="img" aria-label="Bar chart of how much each room and lab is used"></canvas></div>
      </section>
      <section class="card p-4">
        <h2 class="font-medium text-slate-900">Busy slots</h2>
        <p class="mb-3 text-sm text-slate-500">Classes running at the same time across the department. A stronger colour means busier.</p>
        <div id="heatmap"></div>
      </section>
      <section class="card p-4">
        <h2 class="font-medium text-slate-900">Teachers by classes affected</h2>
        <p class="mb-3 text-sm text-slate-500">Leaves and the classes they cancelled or moved</p>
        <div id="by-faculty"></div>
      </section>
    </div>`;

  drawCharts();
  drawHeatmap($('#heatmap'), trends.heatmap);
  drawByFaculty($('#by-faculty'), trends.by_faculty);
}

/** Axis text and grid lines: grey on white in light mode, lighter grey on charcoal in dark mode. */
function axisColours() {
  const dark = document.documentElement.classList.contains('dark');
  return { text: dark ? '#999999' : '#64748b', grid: dark ? '#262626' : '#eef0f4' };
}

/** The current value of one of the COLOURS variables, e.g. "#b7ebc6" (Chart.js needs a real colour). */
const colour = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The two Chart.js charts. Called again (without animation) when light / dark mode is switched. */
function drawCharts({ animate = true } = {}) {
  charts.forEach((c) => c.destroy());
  // The bars grow up one after the other the first time; a theme switch redraws them at once.
  const motion =
    animate && !prefersReducedMotion()
      ? { animation: { duration: 700, easing: 'easeOutQuart', delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 45 : 0) } }
      : { animation: false };
  const axis = axisColours();
  const dark = document.documentElement.classList.contains('dark');
  Chart.defaults.color = axis.text;
  Chart.defaults.borderColor = axis.grid;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  // The hover label: a small rounded box, dark on the light theme and light on the dark one.
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: dark ? '#e9e9e9' : '#0f172a',
    titleColor: dark ? '#191919' : '#ffffff',
    bodyColor: dark ? '#191919' : '#ffffff',
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
  });
  // No vertical grid lines and no axis border, like the design.
  const x = { grid: { display: false }, border: { display: false } };
  const bar = { borderRadius: 6, borderSkipped: false, maxBarThickness: 22 };

  charts = [
    new Chart($('#weeks-chart'), {
      type: 'bar',
      data: {
        labels: trends.weeks.map((w) => formatDate(w.week_start)),
        datasets: [
          { label: 'Moved', data: trends.weeks.map((w) => w.moved), backgroundColor: colour(COLOURS.moved), ...bar },
          { label: 'Cancelled', data: trends.weeks.map((w) => w.cancelled), backgroundColor: colour(COLOURS.cancelled), ...bar },
        ],
      },
      options: {
        ...motion,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } }, // the colour key is in the card's header
        scales: { x, y: { beginAtZero: true, border: { display: false }, ticks: { precision: 0 } } },
      },
    }),
    new Chart($('#rooms-chart'), {
      type: 'bar',
      data: {
        labels: trends.room_utilisation.map((r) => r.space.code),
        datasets: [
          {
            label: 'Used',
            data: trends.room_utilisation.map((r) => r.pct),
            backgroundColor: trends.room_utilisation.map((r) => colour(r.space.kind === 'lab' ? COLOURS.labs : COLOURS.rooms)),
            ...bar,
          },
        ],
      },
      options: {
        ...motion,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const r = trends.room_utilisation[ctx.dataIndex];
                return `${r.pct}% (${r.used} of ${r.total} slots)`;
              },
            },
          },
        },
        scales: { x, y: { beginAtZero: true, max: 100, border: { display: false }, ticks: { callback: (v) => `${v}%` } } },
      },
    }),
  ];
}

function drawHeatmap(container, cells) {
  if (cells.length === 0) {
    renderEmpty(container, 'No classes yet');
    return;
  }
  const days = [...new Set(cells.map((c) => c.day))];
  const periods = [...new Set(cells.map((c) => c.period))].sort((a, b) => a - b);
  const max = Math.max(...cells.map((c) => c.classes), 1);
  const lookup = new Map(cells.map((c) => [`${c.day}|${c.period}`, c.classes]));
  const shade = (n) => SHADES[n === 0 ? 0 : Math.ceil((n / max) * (SHADES.length - 1))];

  let html = '<div></div>';
  html += periods.map((p) => `<div class="text-center text-xs font-semibold text-slate-500">P${p}</div>`).join('');
  for (const day of days) {
    html += `<div class="flex items-center text-xs font-semibold text-slate-500">${escapeHtml(day)}</div>`;
    for (const p of periods) {
      const n = lookup.get(`${day}|${p}`) ?? 0;
      html += `<div class="heat-cell flex h-9 items-center justify-center rounded-md text-xs font-semibold transition duration-200 hover:z-10 hover:scale-110 hover:shadow-md ${shade(n)}"
                    title="${escapeHtml(day)} P${p}: ${n} classes" aria-label="${escapeHtml(day)} period ${p}: ${n} classes">${n}</div>`;
    }
  }
  container.innerHTML = `
    <div class="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] gap-1">${html}</div>
    <div class="mt-3 flex items-center justify-end gap-1 text-xs text-slate-500">
      Fewer ${SHADES.slice(1).map((s) => `<span class="inline-block h-3 w-5 rounded-[3px] ${s}"></span>`).join('')} More
    </div>`;
}

function drawByFaculty(container, rows) {
  if (rows.length === 0) {
    renderEmpty(container, 'No leave yet', 'No teacher has been away in this period.');
    return;
  }
  const sorted = [...rows].sort((a, b) => b.classes_affected - a.classes_affected);
  container.innerHTML = `
    <div class="overflow-x-auto rounded-lg border border-slate-200"><table class="w-full text-left text-sm">
      <thead class="bg-slate-50 text-xs text-slate-500">
        <tr><th scope="col" class="px-3 py-2.5 font-medium">Teacher</th><th scope="col" class="px-3 py-2.5 text-right font-medium">Leaves</th><th scope="col" class="px-3 py-2.5 text-right font-medium">Classes affected</th></tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${sorted
          .map(
            (r) => `
          <tr class="transition-colors hover:bg-slate-50">
            <td class="px-3 py-2.5">
              <div class="flex items-center gap-2.5">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card-orange text-[10px] font-semibold text-slate-800" aria-hidden="true">${escapeHtml(initials(r.faculty.name))}</span>
                <span class="min-w-0">${escapeHtml(r.faculty.name)}</span>
              </div>
            </td>
            <td class="px-3 py-2.5 text-right tabular-nums">${escapeHtml(r.leaves)}</td>
            <td class="px-3 py-2.5 text-right"><span class="inline-block min-w-8 rounded-full bg-card-red px-2 py-0.5 text-center font-semibold tabular-nums text-slate-900">${escapeHtml(r.classes_affected)}</span></td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>`;
}

// ------------------------------------------------------------------ activity log

async function loadActivity() {
  renderLoading($('#activity'), 'Loading the activity log...');
  $('#more-row').classList.add('hidden');
  $('#activity-count').textContent = '';
  try {
    activity = await listActivity({ limit: PAGE_SIZE, offset: 0 });
    drawActivity();
  } catch (err) {
    renderError($('#activity'), err, loadActivity);
  }
}

async function loadMore() {
  const button = $('#load-more');
  button.disabled = true;
  button.textContent = 'Loading...';
  try {
    const page = await listActivity({ limit: PAGE_SIZE, offset: activity.items.length });
    activity = { items: [...activity.items, ...page.items], total: page.total };
    drawActivity();
  } catch (err) {
    showToast(err.detail || 'Could not load more activity.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Load more';
  }
}

/** "2026-10-28T09:13:00+05:30" -> "Wed 28 Oct, 09:13" (already in the department's time zone) */
function formatWhen(iso) {
  return `${formatDate(iso.slice(0, 10))}, ${iso.slice(11, 16)}`;
}

function drawActivity() {
  if (activity.items.length === 0) {
    renderEmpty($('#activity'), 'Nothing has happened yet', 'Leave, approvals and changes will show up here.');
    $('#activity-count').textContent = '';
    $('#more-row').classList.add('hidden');
    return;
  }
  $('#activity').innerHTML = `
    <div class="overflow-x-auto rounded-lg border border-slate-200"><table class="w-full text-left text-sm">
      <thead class="bg-slate-50 text-xs text-slate-500">
        <tr><th scope="col" class="px-3 py-2.5 font-medium">When</th><th scope="col" class="hidden px-3 py-2.5 sm:table-cell font-medium">Who</th><th scope="col" class="px-3 py-2.5 font-medium">What happened</th></tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${activity.items
          .map(
            (a) => `
          <tr class="align-top transition-colors hover:bg-slate-50">
            <td class="px-3 py-2.5 text-xs whitespace-nowrap text-slate-500">${escapeHtml(formatWhen(a.at))}</td>
            <td class="hidden px-3 py-2.5 sm:table-cell">
              <div class="flex items-center gap-2">
                <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${a.actor ? 'bg-card-orange' : 'bg-slate-100'} text-[10px] font-semibold text-slate-800" aria-hidden="true">${escapeHtml(a.actor ? initials(a.actor.name) : 'S')}</span>
                <span class="whitespace-nowrap">${escapeHtml(a.actor?.name ?? 'System')}</span>
              </div>
            </td>
            <td class="px-3 py-2.5">${escapeHtml(a.summary)}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>`;
  $('#activity-count').textContent = `Showing ${activity.items.length} of ${activity.total}`;
  $('#more-row').classList.toggle('hidden', activity.items.length >= activity.total);
}
