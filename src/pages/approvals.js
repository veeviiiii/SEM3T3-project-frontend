// Approvals page (HOD): every cancelled class gets a new slot here, or stays cancelled.
//   Left:  the list of proposals (Waiting / Approved / Rejected).
//   Right: the chosen proposal, its suggested slots, and the buttons to decide.
// Same pattern as student.js:
//   1. check the login   2. draw the header   3. show "Loading..."
//   4. ask api.js for data   5. draw it   6. react to clicks
import { animate, stagger } from 'motion';
import {
  listProposals,
  getProposal,
  approveProposal,
  rejectProposal,
  checkProposalSlot,
  getCalendar,
  listSpaces,
} from '../api.js';
import { requireLogin, renderHeader } from '../lib/layout.js';
import { $, escapeHtml, formatDate, initials, renderLoading, renderError, renderEmpty, showToast, prefersReducedMotion } from '../lib/ui.js';

// What the left list says when a tab has nothing in it.
const EMPTY = {
  pending: ['Nothing is waiting', 'Every cancelled class has a decision.'],
  approved: ['Nothing approved yet', 'Approved classes will show up here.'],
  rejected: ['Nothing kept cancelled', 'Classes you keep cancelled will show up here.'],
};

// The page's state. Declared before start() runs, because start() uses them straight away.
let status = 'pending'; // which tab is open
let selectedId = null; // which proposal is open on the right
let slotData = null; // calendar + rooms for "Pick another slot", fetched the first time it is opened
// These ignore answers that arrive after the user has already clicked something else.
let listTicket = 0;
let detailTicket = 0;
let checkTicket = 0;

// 1 + 2. Only the HOD may be here.
const user = requireLogin(['hod']);
if (user) {
  renderHeader(user);
  document.querySelectorAll('[data-status]').forEach((tab) =>
    tab.addEventListener('click', () => {
      setTab(tab.dataset.status);
      loadList();
    }),
  );
  start();
}

/** Open ?id=... if the address has one, otherwise the first class waiting. */
async function start() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (id) openProposal(id);
  else renderLoading($('#detail'), 'Loading...');

  const items = await loadList();
  if (id) return;
  if (items && items.length > 0) openProposal(items[0].id);
  else if (items) renderEmpty($('#detail'), 'Nothing is waiting for you', 'Every cancelled class has a decision.');
  else $('#detail').innerHTML = '';
}

function setTab(newStatus) {
  status = newStatus;
  document.querySelectorAll('[data-status]').forEach((tab) => {
    tab.setAttribute('aria-pressed', String(tab.dataset.status === status));
  });
}

// ------------------------------------------------------------------ left: the list

/** Draws the list for the open tab. Returns the proposals, or null if it failed. */
async function loadList() {
  const box = $('#proposal-list');
  const ticket = ++listTicket;
  renderLoading(box, 'Loading...');
  try {
    const items = await listProposals({ status });
    if (ticket !== listTicket) return null;
    if (status === 'pending') {
      $('#pending-count').textContent = items.length;
      $('#pending-count').classList.remove('hidden');
    }
    if (items.length === 0) {
      renderEmpty(box, EMPTY[status][0], EMPTY[status][1]);
      return items;
    }
    box.innerHTML = `<ul class="space-y-1">${items
      .map(
        (p) => `
        <li>
          <button type="button" class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50" data-id="${escapeHtml(p.id)}">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card-orange text-xs font-semibold text-slate-800" aria-hidden="true">${escapeHtml(initials(p.original.subject.name))}</span>
            <span class="min-w-0">
              <span class="block truncate font-medium text-slate-900">${escapeHtml(p.original.subject.name)}</span>
              <span class="block text-xs text-slate-500">${escapeHtml(p.original.batch.code)} · ${escapeHtml(formatDate(p.original.date))}, ${escapeHtml(p.original.start)}</span>
            </span>
          </button>
        </li>`,
      )
      .join('')}</ul>`;
    box.querySelectorAll('[data-id]').forEach((button) =>
      button.addEventListener('click', () => {
        openProposal(button.dataset.id);
        // On a phone the details are below the list, so bring them into view.
        $('#detail').scrollIntoView({ block: 'nearest' });
      }),
    );
    markSelected();
    return items;
  } catch (err) {
    if (ticket !== listTicket) return null;
    renderError(box, err, loadList);
    return null;
  }
}

/** Gives the open proposal a blue background in the list. */
function markSelected() {
  document.querySelectorAll('#proposal-list [data-id]').forEach((button) => {
    const on = Number(button.dataset.id) === selectedId;
    button.classList.toggle('bg-nav', on);
    button.setAttribute('aria-current', String(on));
  });
}

// ------------------------------------------------------------------ right: one proposal

async function openProposal(id) {
  selectedId = Number(id);
  markSelected();
  // Keep the address in step, so a reload opens the same class.
  history.replaceState(null, '', `?id=${selectedId}`);
  const box = $('#detail');
  const ticket = ++detailTicket;
  renderLoading(box, 'Loading the class...');
  try {
    const p = await getProposal(selectedId);
    if (ticket !== detailTicket) return;
    renderDetail(p);
  } catch (err) {
    if (ticket !== detailTicket) return;
    renderError(box, err, () => openProposal(id));
  }
}

function renderDetail(p) {
  const o = p.original;
  const planned = `
    <div class="card flex flex-wrap items-start gap-4 p-4">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card-orange text-sm font-semibold text-slate-800" aria-hidden="true">${escapeHtml(initials(o.subject.name))}</span>
      <div class="min-w-0 flex-1 basis-48">
        <p class="text-xs font-medium text-slate-500">The class as planned</p>
        <h2 class="text-lg font-semibold text-slate-900">${escapeHtml(o.subject.name)}</h2>
        <p class="text-sm text-slate-600">
          ${escapeHtml(o.batch.code)} · ${escapeHtml(formatDate(o.date))} ${escapeHtml(o.start)} · ${escapeHtml(o.space.code)} · ${escapeHtml(o.faculty.name)}
        </p>
      </div>
      <span class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
        <span class="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true"></span>Cancelled: ${escapeHtml(p.reason)}
      </span>
    </div>`;

  // Already decided: show what was decided, no buttons.
  if (p.status !== 'pending') {
    $('#detail').innerHTML = planned + decisionCard(p);
    return;
  }

  // The recommended option goes first, then the rest in rank order.
  const best = p.options.filter((opt) => opt.rank === p.recommended_rank);
  const others = p.options.filter((opt) => opt.rank !== p.recommended_rank);
  const ordered = [...best, ...others];

  $('#detail').innerHTML = `
    ${planned}
    <h3 class="mb-2 mt-5 font-medium text-slate-900">Suggested slots</h3>
    ${
      ordered.length
        ? `<ol class="grid gap-3 xl:grid-cols-2">${ordered.map((opt) => optionCard(p, opt)).join('')}</ol>`
        : '<p class="card text-sm text-slate-600">No free slot was found. Use "Pick another slot" to choose one yourself.</p>'
    }
    <div class="card mt-4 p-4">
      <div class="flex flex-wrap justify-between gap-2">
        <button type="button" class="btn-secondary" id="pick-another" aria-expanded="false" aria-controls="custom-slot">Pick another slot</button>
        <button type="button" class="btn-danger" id="keep-cancelled">Keep cancelled</button>
      </div>
      <div class="mt-4 hidden" id="custom-slot"></div>
    </div>`;

  document.querySelectorAll('#detail [data-rank]').forEach((button) => {
    const opt = p.options.find((x) => x.rank === Number(button.dataset.rank));
    button.addEventListener('click', () => approveOption(button, p, opt));
  });
  $('#pick-another').addEventListener('click', () => toggleCustomSlot(p));
  $('#keep-cancelled').addEventListener('click', () => keepCancelled($('#keep-cancelled'), p));

  if (!prefersReducedMotion()) {
    animate('.option-card', { opacity: [0, 1], y: [8, 0] }, { duration: 0.25, delay: stagger(0.05) });
  }
}

/** One suggested slot: when and where, score bar, "Why this slot?" chips, warnings, Approve button. */
function optionCard(p, opt) {
  const recommended = opt.rank === p.recommended_rank;
  const score = Math.max(0, Math.min(100, Number(opt.score) || 0));
  const where = `${formatDate(opt.date)} ${opt.start}, ${opt.space.code}`;
  return `
    <li class="option-card lift flex flex-col rounded-xl border bg-white p-4 ${recommended ? 'border-blue-300 shadow-[0_0_28px_-10px_var(--color-brand)] ring-2 ring-card-blue dark:shadow-none dark:ring-brand/70' : 'border-slate-200/70'}">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="font-medium text-slate-900">${escapeHtml(formatDate(opt.date))} · ${escapeHtml(opt.start)}-${escapeHtml(opt.end)}</p>
          <p class="text-sm text-slate-500">Period ${escapeHtml(opt.period)} · ${escapeHtml(opt.space.code)}</p>
        </div>
        ${recommended ? '<span class="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-ink">Recommended</span>' : ''}
      </div>

      <div class="mt-3 flex items-center gap-3">
        <div class="h-2 flex-1 rounded-full bg-slate-100" aria-hidden="true">
          <div class="h-2 origin-left animate-grow-x rounded-full ${recommended ? 'bg-brand-strong shadow-[0_0_10px_var(--color-brand)] dark:shadow-none' : 'bg-slate-400'}" style="width: ${score}%"></div>
        </div>
        <span class="text-sm font-medium text-slate-700">Score ${score}<span class="font-normal text-slate-500"> / 100</span></span>
      </div>

      ${
        opt.breakdown.length
          ? `<p class="mt-3 text-xs font-medium text-slate-500">Why this slot?</p>
             <ul class="mt-1 flex flex-wrap gap-1.5">${opt.breakdown
               .map((b) => `<li class="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">${escapeHtml(b.label)}</li>`)
               .join('')}</ul>`
          : ''
      }

      ${
        opt.warnings.length
          ? `<ul class="mt-3 space-y-1">${opt.warnings
              .map((w) => `<li class="rounded-md bg-orange-50 px-2 py-1 text-sm text-orange-800"><span aria-hidden="true">⚠</span> ${escapeHtml(w)}</li>`)
              .join('')}</ul>`
          : ''
      }

      <div class="mt-auto pt-4">
        <button type="button" class="${recommended ? 'btn-primary' : 'btn-secondary'}" data-rank="${escapeHtml(opt.rank)}">
          Approve this slot<span class="sr-only">: ${escapeHtml(where)}</span>
        </button>
        <div class="mt-3" data-clashes></div>
      </div>
    </li>`;
}

/** For an approved or rejected proposal: what was decided, by whom and when. */
function decisionCard(p) {
  const d = p.decision;
  if (!d) return '';
  const approved = d.action === 'approved';
  const what = approved
    ? `Moved to ${d.slot ? `${formatDate(d.slot.date)} ${d.slot.start}, ${d.slot.space.code}` : 'a slot picked by hand'}`
    : 'Kept cancelled';
  return `
    <div class="mt-4 rounded-xl border p-5 ${approved ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}">
      <p class="font-medium">${escapeHtml(what)}</p>
      <p class="mt-1 text-sm">
        Decided by ${escapeHtml(d.by.name)} on ${escapeHtml(formatDate(d.at.slice(0, 10)))}, ${escapeHtml(d.at.slice(11, 16))}${d.custom ? ' (slot picked by hand)' : ''}
      </p>
      ${d.note ? `<p class="mt-1 text-sm">Note: ${escapeHtml(d.note)}</p>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ deciding

async function approveOption(button, p, opt) {
  button.disabled = true;
  try {
    await approveProposal(p.id, { version: p.version, option_rank: opt.rank });
    showToast(
      `Approved. ${p.original.subject.code} moved to ${formatDate(opt.date)} ${opt.start} in ${opt.space.code} and ${p.original.batch.code} has been told.`,
      'success',
    );
    afterDecision(p.id);
  } catch (err) {
    button.disabled = false;
    showActionError(err, p, button.closest('li').querySelector('[data-clashes]'));
  }
}

async function keepCancelled(button, p) {
  const o = p.original;
  const note = window.prompt('Add a note for the students (optional):', '');
  if (note === null) return; // pressed Cancel
  if (!window.confirm(`Keep ${o.subject.code} for ${o.batch.code} on ${formatDate(o.date)} cancelled? Students will be told.`)) return;
  button.disabled = true;
  try {
    await rejectProposal(p.id, { version: p.version, note: note.trim() || null });
    showToast(`Kept cancelled. ${o.batch.code} has been told that ${o.subject.code} on ${formatDate(o.date)} will not happen.`, 'success');
    afterDecision(p.id);
  } catch (err) {
    button.disabled = false;
    showActionError(err, p, null);
  }
}

/** After a decision: go back to the Waiting tab, refresh it, and open the next class in it. */
async function afterDecision(decidedId) {
  setTab('pending');
  const items = await loadList();
  if (!items) return;
  // Open the one below it in the list. (The real server removes decided classes from the list,
  // so then it is simply the first one. The mock does not, so it is still there.)
  const at = items.findIndex((x) => x.id === decidedId);
  const next = at === -1 ? items[0] : items[(at + 1) % items.length];
  if (next && next.id !== decidedId) {
    openProposal(next.id);
  } else {
    selectedId = null;
    history.replaceState(null, '', window.location.pathname);
    renderEmpty($('#detail'), 'All done', 'Nothing else is waiting for you.');
  }
}

/** When approve or keep cancelled fails. clashBox = where to list the clashes, if the slot is now taken. */
function showActionError(err, p, clashBox) {
  if (err.code === 'STALE') {
    showToast('Someone else changed this proposal, so it has been reloaded. Please check it again.', 'error');
    openProposal(p.id);
    loadList();
  } else if (err.code === 'ALREADY_DECIDED') {
    showToast(err.detail, 'error');
    openProposal(p.id);
    loadList();
  } else if (err.code === 'CLASH' && clashBox) {
    renderClashes(clashBox, err.clashes || [], 'This slot was just taken:');
  } else {
    showToast(err.detail, 'error');
  }
}

/** A red box listing why a slot is not free. */
function renderClashes(box, clashes, title) {
  box.innerHTML = `
    <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p class="font-semibold">${escapeHtml(title)}</p>
      <ul class="mt-1 list-disc space-y-0.5 pl-5">${clashes.map((c) => `<li>${escapeHtml(c.message)}</li>`).join('')}</ul>
    </div>`;
}

// ------------------------------------------------------------------ "Pick another slot"

function toggleCustomSlot(p) {
  const box = $('#custom-slot');
  const isOpen = !box.classList.contains('hidden');
  box.classList.toggle('hidden', isOpen);
  $('#pick-another').setAttribute('aria-expanded', String(!isOpen));
  if (!isOpen && box.innerHTML === '') loadCustomForm(p);
}

/** The first time: fetch the periods and rooms. Then draw the little form. */
async function loadCustomForm(p) {
  const box = $('#custom-slot');
  renderLoading(box, 'Loading rooms...');
  try {
    if (!slotData) {
      const [calendar, spaces] = await Promise.all([getCalendar(), listSpaces()]);
      slotData = { calendar, spaces };
    }
  } catch (err) {
    renderError(box, err, () => loadCustomForm(p));
    return;
  }

  const room = (s) =>
    `<option value="${escapeHtml(s.id)}" ${s.id === p.original.space.id ? 'selected' : ''}>${escapeHtml(s.code)}${s.capacity ? ` · ${escapeHtml(s.capacity)} seats` : ''}</option>`;
  // A group of rooms or labs, left out when there are none.
  const group = (label, list) => (list.length ? `<optgroup label="${label}">${list.map(room).join('')}</optgroup>` : '');
  box.innerHTML = `
    <form class="grid gap-3 sm:grid-cols-3" id="custom-form" novalidate>
      <div>
        <label class="label" for="custom-date">Date</label>
        <input class="input" id="custom-date" type="date" min="${escapeHtml(slotData.calendar.today)}" />
      </div>
      <div>
        <label class="label" for="custom-period">Period</label>
        <select class="input" id="custom-period">
          <option value="">Choose...</option>
          ${slotData.calendar.periods
            .map((x) => `<option value="${escapeHtml(x.period)}">P${escapeHtml(x.period)} · ${escapeHtml(x.start)}-${escapeHtml(x.end)}</option>`)
            .join('')}
        </select>
      </div>
      <div>
        <label class="label" for="custom-room">Room</label>
        <select class="input" id="custom-room">
          ${group('Rooms', slotData.spaces.filter((s) => s.kind === 'room'))}
          ${group('Labs', slotData.spaces.filter((s) => s.kind === 'lab'))}
        </select>
      </div>
    </form>
    <div class="mt-3 text-sm" id="custom-result" aria-live="polite">
      <p class="text-slate-500">Pick a date, period and room to check if the slot is free.</p>
    </div>
    <button type="button" class="btn-secondary mt-3" id="custom-approve" disabled>Approve this slot</button>`;

  // Check the slot again on every change.
  ['#custom-date', '#custom-period', '#custom-room'].forEach((field) => $(field).addEventListener('change', () => checkCustom(p)));
  $('#custom-form').addEventListener('submit', (event) => event.preventDefault());
  $('#custom-approve').addEventListener('click', () => approveCustom($('#custom-approve'), p));
}

/** The slot in the form, or null until all three fields are filled in. */
function readCustomSlot() {
  const date = $('#custom-date').value;
  const period = $('#custom-period').value;
  const room = $('#custom-room').value;
  if (!date || !period || !room) return null;
  return { date, period: Number(period), space_id: Number(room) };
}

async function checkCustom(p) {
  const result = $('#custom-result');
  const approve = $('#custom-approve');
  approve.disabled = true; // only allowed once the server says the slot is free
  const slot = readCustomSlot();
  if (!slot) {
    result.innerHTML = '<p class="text-slate-500">Pick a date, period and room to check if the slot is free.</p>';
    return;
  }
  const ticket = ++checkTicket;
  renderLoading(result, 'Checking the slot...');
  try {
    const answer = await checkProposalSlot(p.id, slot);
    if (ticket !== checkTicket) return;
    if (answer.ok) {
      result.innerHTML = `<p class="font-semibold text-green-700">✓ Free, score ${escapeHtml(answer.score)}</p>`;
      approve.disabled = false;
    } else {
      renderClashes(result, answer.clashes, 'This slot is not free:');
    }
  } catch (err) {
    if (ticket !== checkTicket) return;
    renderError(result, err, () => checkCustom(p));
  }
}

async function approveCustom(button, p) {
  const slot = readCustomSlot();
  button.disabled = true;
  try {
    await approveProposal(p.id, { version: p.version, custom: slot });
    const period = slotData.calendar.periods.find((x) => x.period === slot.period);
    const room = slotData.spaces.find((s) => s.id === slot.space_id);
    showToast(
      `Approved. ${p.original.subject.code} moved to ${formatDate(slot.date)} ${period.start} in ${room.code} and ${p.original.batch.code} has been told.`,
      'success',
    );
    afterDecision(p.id);
  } catch (err) {
    button.disabled = err.code === 'CLASH'; // stays off if the slot has just been taken
    showActionError(err, p, $('#custom-result'));
  }
}
