// What-if page (HOD): a stack of pretend changes, simulated on the server without saving anything.
import { createUnavailability, getCalendar, listBatches, listFaculty, listSpaces, runWhatIf } from '../api.js';
import { renderHeader, requireLogin } from '../lib/layout.js';
import { $, escapeHtml, formatDate, renderEmpty, renderError, renderLoading, showToast } from '../lib/ui.js';

const user = requireLogin(['hod']);
let lists = { faculty: [], spaces: [], batches: [] };
const changes = []; // a stack: the last one is the newest; "Undo last" pops it

if (user) {
  renderHeader(user);
  start();
}

async function start() {
  renderEmpty($('#result'), 'Add a change to see what would happen', 'For example: a teacher on leave this Friday.');
  try {
    const [cal, faculty, spaces, batches] = await Promise.all([getCalendar(), listFaculty(), listSpaces(), listBatches()]);
    lists = { faculty, spaces, batches };
    for (const id of ['from', 'to']) {
      $(`#${id}`).value = cal.today;
      $(`#${id}`).min = cal.today;
    }
    $('#periods').innerHTML = cal.periods
      .map((p) => `<label class="rounded-lg border border-slate-200 px-2 py-1 text-xs"><input type="checkbox" class="accent-blue-400" value="${p.period}" /> P${p.period} ${p.start}</label>`)
      .join('');
    fillTargets();
  } catch (err) {
    renderError($('#result'), err, start);
    return;
  }
  $('#kind').addEventListener('change', fillTargets);
  document.querySelectorAll('input[name="span"]').forEach((r) => r.addEventListener('change', () => {
    $('#periods').classList.toggle('hidden', r.value === 'day' && r.checked);
    $('#periods').classList.toggle('flex', !(r.value === 'day' && r.checked));
  }));
  $('#change-form').addEventListener('submit', addChange);
  $('#undo').addEventListener('click', () => {
    changes.pop();
    simulate();
  });
}

function fillTargets() {
  const kind = $('#kind').value;
  const options = {
    faculty_leave: lists.faculty.map((f) => [f.id, f.name]),
    room_closure: lists.spaces.map((s) => [s.id, `${s.code} · ${s.name}`]),
    batch_event: lists.batches.map((b) => [b.id, `${b.code} · ${b.name}`]),
  }[kind];
  $('#target').innerHTML = options.map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join('');
}

function targetLabel(change) {
  const id = Number(change.target_id);
  if (change.kind === 'faculty_leave') return lists.faculty.find((f) => f.id === id)?.name ?? 'Teacher';
  if (change.kind === 'room_closure') return lists.spaces.find((s) => s.id === id)?.code ?? 'Room';
  return lists.batches.find((b) => b.id === id)?.code ?? 'Batch';
}

function addChange(event) {
  event.preventDefault();
  const error = $('#form-error');
  error.classList.add('hidden');
  const from = $('#from').value;
  const to = $('#to').value;
  const some = document.querySelector('input[name="span"]:checked').value === 'some';
  const periods = some ? [...document.querySelectorAll('#periods input:checked')].map((c) => Number(c.value)) : null;
  let problem = '';
  if (!from || !to) problem = 'Please pick the dates.';
  else if (to < from) problem = '"To" must be on or after "From".';
  else if (some && periods.length === 0) problem = 'Tick at least one period, or choose "Whole day".';
  if (problem) {
    error.textContent = problem;
    error.classList.remove('hidden');
    return;
  }
  changes.push({
    kind: $('#kind').value,
    target_id: Number($('#target').value),
    start_date: from,
    end_date: to,
    periods,
    reason: $('#reason').value.trim() || 'What-if',
  });
  simulate();
}

function renderChanges() {
  $('#undo').disabled = changes.length === 0;
  $('#changes').innerHTML = changes.length
    ? changes
        .map((c, i) => {
          const when = c.start_date === c.end_date ? formatDate(c.start_date) : `${formatDate(c.start_date)} to ${formatDate(c.end_date)}`;
          const what = { faculty_leave: 'on leave', room_closure: 'closed', batch_event: 'away' }[c.kind];
          return `<li class="rounded-lg bg-blue-50 px-3 py-2 text-blue-950"><b>${i + 1}.</b> ${escapeHtml(targetLabel(c))} ${what}, ${escapeHtml(when)}${c.periods ? ` (P${c.periods.join(', P')})` : ''}</li>`;
        })
        .join('')
    : '<li class="text-slate-500">No changes yet.</li>';
}

async function simulate() {
  renderChanges();
  if (changes.length === 0) {
    renderEmpty($('#result'), 'Add a change to see what would happen', 'For example: a teacher on leave this Friday.');
    return;
  }
  renderLoading($('#result'), 'Simulating...');
  try {
    renderResult(await runWhatIf(changes));
  } catch (err) {
    renderError($('#result'), err, simulate);
  }
}

const card = (label, value, tone = '') => `
  <div class="lift animate-fade-up rounded-xl p-4 ${tone || 'border border-slate-200/70 bg-white'}">
    <p class="text-sm text-slate-700">${label}</p><p class="mt-1 text-3xl font-medium text-slate-900">${value}</p>
  </div>`;

function classLine(c) {
  return `${escapeHtml(c.subject.code)} · ${escapeHtml(c.batch.code)} · ${escapeHtml(formatDate(c.date))} ${c.start}`;
}

function renderResult(r) {
  const s = r.summary;
  const steps = r.steps
    .map((step) => `
      <li class="lift rounded-xl border border-slate-200/70 bg-white p-3">
        <p class="font-medium">${escapeHtml(step.label)}</p>
        <p class="mt-1 text-sm text-slate-600">${step.affected.length
          ? step.affected.map((e) => `<span class="mr-1 mt-1 inline-block rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">${classLine(e)}</span>`).join('')
          : 'No classes hit by this change.'}</p>
      </li>`)
    .join('');
  const rows = r.plan
    .map((item) => {
      const o = item.option;
      return `<tr class="border-t border-slate-100">
        <td class="py-2 pr-3">${escapeHtml(item.original.subject.name)} <span class="text-slate-500">· ${escapeHtml(item.original.batch.code)}</span></td>
        <td class="py-2 pr-3">${escapeHtml(formatDate(item.original.date))} ${item.original.start}</td>
        <td class="py-2 pr-3">${o
          ? `<span class="font-medium text-green-700">${escapeHtml(formatDate(o.date))} ${o.start}, ${escapeHtml(o.space.code)}</span>${o.warnings.length ? ` <span class="text-xs text-orange-700">(${escapeHtml(o.warnings.join(', '))})</span>` : ''}`
          : '<span class="font-medium text-red-700">No free slot: the HOD decides</span>'}</td>
        <td class="py-2 text-right">${o ? o.score : '-'}</td>
      </tr>`;
    })
    .join('');

  $('#result').innerHTML = `
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      ${card('Classes hit', s.classes_affected, 'bg-card-orange')}
      ${card('Can be moved', s.classes_placed, 'bg-card-green')}
      ${card('Need the HOD', s.classes_unplaced, s.classes_unplaced ? 'bg-card-red' : 'bg-card-blue')}
      ${card('Worked out in', `${r.runtime_ms} ms`)}
    </div>
    <h2 class="mb-2 mt-5 font-medium text-slate-900">Step by step</h2>
    <ol class="space-y-2">${steps}</ol>
    <h2 class="mb-2 mt-5 font-medium text-slate-900">Suggested plan</h2>
    ${r.plan.length ? `<div class="card overflow-x-auto p-4"><table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500"><th class="pb-2 pr-3 font-medium">Class</th><th class="pb-2 pr-3 font-medium">Was</th><th class="pb-2 pr-3 font-medium">New slot</th><th class="pb-2 text-right font-medium">Score</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="text-sm text-slate-500">Nothing to move.</p>'}
    <div class="mt-5 flex flex-wrap items-center justify-end gap-2">
      <span class="text-sm text-slate-500">Happy with this? The classes will wait for your approval as usual.</span>
      <button type="button" id="make-real" class="btn-primary">Make it real</button>
    </div>`;
  $('#make-real').addEventListener('click', makeReal);
}

async function makeReal(event) {
  const n = changes.length;
  if (!window.confirm(`Save ${n} change${n === 1 ? '' : 's'} for real? Affected classes are cancelled and people are told.`)) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    for (const c of [...changes]) {
      await createUnavailability(c);
      changes.shift();
    }
    showToast('Saved. The classes are waiting for you in Approvals.', 'success');
    renderChanges();
    $('#result').innerHTML = '<div class="card"><p class="font-semibold">Saved.</p><p class="mt-1 text-sm text-slate-600">Choose the new slots in <a class="font-medium text-blue-700" href="/approvals.html">Approvals</a>.</p></div>';
  } catch (err) {
    showToast(err.detail || 'Could not save. Please try again.', 'error');
    button.disabled = false;
    renderChanges();
  }
}
