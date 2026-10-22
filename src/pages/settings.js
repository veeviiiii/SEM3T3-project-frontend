// Settings page (HOD): ranking weights, CSV import, demo reset, email outbox.
import { getRankingSettings, importTimetable, listOutbox, resetDemo, updateRankingSettings } from '../api.js';
import { renderHeader, requireLogin } from '../lib/layout.js';
import { $, escapeHtml, renderEmpty, renderError, renderLoading, showToast } from '../lib/ui.js';

const user = requireLogin(['hod']);
let saved = null; // the settings as the server has them
const OUTBOX_PAGE = 10;
let outboxShown = 0;

if (user) {
  renderHeader(user);
  loadRanking();
  setUpImport();
  $('#reset').addEventListener('click', reset);
  loadOutbox(true);
}

// ------------------------------------------------------------------ ranking

async function loadRanking() {
  renderLoading($('#weights'), 'Loading settings...');
  try {
    saved = await getRankingSettings();
    fillRanking(saved);
  } catch (err) {
    renderError($('#weights'), err, loadRanking);
    return;
  }
  $('#ranking-reset').addEventListener('click', () => fillRanking(saved));
  $('#ranking-form').addEventListener('submit', saveRanking);
}

function fillRanking(s) {
  $('#weights').innerHTML = s.rules
    .map((r) => `
      <div>
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium text-slate-700" for="w-${r.rule}">${escapeHtml(r.label)}</label>
          <output class="rounded-md bg-card-blue px-2 text-sm font-semibold text-slate-900" id="o-${r.rule}">${s.weights[r.rule]}</output>
        </div>
        <input class="w-full accent-blue-400" id="w-${r.rule}" data-rule="${r.rule}" type="range" min="0" max="10" step="0.5" value="${s.weights[r.rule]}" />
        <p class="text-xs text-slate-500">${escapeHtml(r.description)}</p>
      </div>`)
    .join('');
  document.querySelectorAll('#weights input[type="range"]').forEach((input) => {
    input.addEventListener('input', () => { $(`#o-${input.dataset.rule}`).textContent = input.value; });
  });
  $('#k').value = s.k;
  $('#maxload').value = s.max_batch_classes_per_day;
  $('#notice').value = s.min_notice_hours;
  $('#weeks').value = s.search_weeks;
}

async function saveRanking(event) {
  event.preventDefault();
  const button = event.submitter;
  const weights = {};
  document.querySelectorAll('#weights input[type="range"]').forEach((i) => { weights[i.dataset.rule] = Number(i.value); });
  button.disabled = true;
  try {
    saved = await updateRankingSettings({
      weights, // all six together, as the contract asks
      k: Number($('#k').value),
      max_batch_classes_per_day: Number($('#maxload').value),
      min_notice_hours: Number($('#notice').value),
      search_weeks: Number($('#weeks').value),
    });
    fillRanking(saved);
    showToast('Saved. New cancellations will use these weights.', 'success');
  } catch (err) {
    showToast(err.detail || 'Could not save the settings.', 'error');
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------------ CSV import

function setUpImport() {
  const file = $('#csv');
  file.addEventListener('change', () => {
    $('#csv-check').disabled = !file.files.length;
    $('#csv-import').disabled = true;
    $('#csv-result').innerHTML = '';
  });
  $('#csv-check').addEventListener('click', () => runImport(true));
  $('#csv-import').addEventListener('click', () => {
    if (window.confirm('Replace the whole weekly timetable with this file? Current changes and proposals are cleared.')) runImport(false);
  });
}

async function runImport(dryRun) {
  const box = $('#csv-result');
  renderLoading(box, dryRun ? 'Checking the file...' : 'Importing...');
  try {
    const r = await importTimetable($('#csv').files[0], { dryRun });
    const problems = [...r.errors.map((e) => ({ ...e, type: 'Error' })), ...r.clashes.map((c) => ({ ...c, type: 'Clash' }))];
    const ok = problems.length === 0;
    $('#csv-import').disabled = !(dryRun && ok);
    box.innerHTML = `
      <p class="font-medium ${ok ? 'text-green-700' : 'text-red-700'}">${
        dryRun
          ? ok ? `All ${r.rows} rows look fine. Press Import to use them.` : `${problems.length} problem${problems.length === 1 ? '' : 's'} in ${r.rows} rows. Fix the file and check again.`
          : `Imported ${r.imported} classes.`
      }</p>
      ${ok ? '' : `<ul class="mt-2 max-h-48 space-y-1 overflow-y-auto">${problems
        .map((p) => `<li class="rounded bg-red-50 px-2 py-1 text-red-800"><b>Row ${p.row}</b> (${p.type}): ${escapeHtml(p.message)}</li>`)
        .join('')}</ul>`}`;
    if (!dryRun) showToast(`Imported ${r.imported} classes.`, 'success');
  } catch (err) {
    renderError(box, err);
  }
}

// ------------------------------------------------------------------ demo reset

async function reset(event) {
  if (!window.confirm('Reset all demo data? Every approval, leave and notification made since the start is undone.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const r = await resetDemo();
    showToast(r.message, 'success');
    loadOutbox(true);
  } catch (err) {
    showToast(err.detail || 'Could not reset the demo data.', 'error');
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------------ outbox

async function loadOutbox(fresh) {
  const box = $('#outbox');
  if (fresh) {
    outboxShown = 0;
    renderLoading(box, 'Loading emails...');
  }
  try {
    const page = await listOutbox({ limit: OUTBOX_PAGE, offset: outboxShown });
    const rows = page.items
      .map((m) => {
        const history = m.delivered_to.startsWith('demo history'); // made by the seed, never really sent
        const tone = history ? 'bg-slate-100 text-slate-600' : m.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
        const label = history ? 'demo history' : m.status;
        const when = new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        return `<tr class="border-t border-slate-100 align-top">
          <td class="py-2 pr-3 whitespace-nowrap text-slate-500">${escapeHtml(when)}</td>
          <td class="py-2 pr-3">${escapeHtml(m.subject)}<div class="text-xs text-slate-500">for ${escapeHtml(m.to)}</div></td>
          <td class="py-2 pr-3"><span class="rounded px-2 py-0.5 text-xs font-semibold ${tone}">${label}</span>
            <div class="text-xs text-slate-500">${escapeHtml(m.delivered_to)}</div></td>
        </tr>`;
      })
      .join('');
    if (fresh) {
      if (!page.items.length) {
        renderEmpty(box, 'No emails yet');
        $('#outbox-count').textContent = '';
        return;
      }
      box.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-slate-500">
        <th class="pb-2 pr-3 font-medium">When</th><th class="pb-2 pr-3 font-medium">Email</th><th class="pb-2 pr-3 font-medium">Status</th>
        </tr></thead><tbody id="outbox-rows"></tbody></table></div>
        <div class="mt-3 flex justify-center"><button type="button" id="more" class="btn-secondary">Load more</button></div>`;
      $('#more').addEventListener('click', () => loadOutbox(false));
    }
    $('#outbox-rows').insertAdjacentHTML('beforeend', rows);
    outboxShown += page.items.length;
    $('#outbox-count').textContent = `${page.total} in total`;
    $('#more').classList.toggle('hidden', outboxShown >= page.total);
  } catch (err) {
    renderError(box, err, () => loadOutbox(true));
  }
}
