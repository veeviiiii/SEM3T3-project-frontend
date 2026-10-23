/**
 * api.js - the ONLY file in the frontend that talks to the backend (contract v1.0).
 *
 * Pages import these functions and never call fetch() themselves:
 *     import { login, getMyTimetable } from './api.js';
 *
 * Two modes, same answers (the shapes in CONTRACT.md):
 *   - mock mode (default): answers come from /mock/*.json.
 *     Copy contract/mock/ to frontend/public/mock/ so Vite serves them.
 *   - real mode: answers come from the FastAPI server.
 *     Put VITE_USE_MOCK=false and VITE_API_BASE=http://localhost:8000 in frontend/.env
 *
 * Every function returns a Promise. On failure it throws an ApiError with
 * .status, .code and .detail (a sentence you can show to the user as-is).
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const USE_MOCK = env.VITE_USE_MOCK !== 'false';
export const API_BASE = (env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');
const MOCK_BASE = '/mock';
const MOCK_PASSWORD = 'demo1234';

// ------------------------------------------------------------------ errors

export class ApiError extends Error {
  constructor(status, code, detail, body = null) {
    super(detail);
    this.status = status;          // HTTP status, 0 = no connection
    this.code = code;              // e.g. "CLASH", "STALE", "FORBIDDEN" (CONTRACT.md 1.6)
    this.detail = detail;          // human sentence
    this.clashes = body?.clashes ?? null;
    this.fields = body?.fields ?? null;
  }
}

// ------------------------------------------------------------------ session (token + user)

// v2: the demo data became the real AI&DS timetable (new people and ids), so logins saved before are not used.
const TOKEN_KEY = 'sss.token.v2';
const USER_KEY = 'sss.user.v2';

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked: the session just won't survive a reload */ }
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function getToken() {
  return read(TOKEN_KEY);
}

/** The logged-in user ({id, name, email, role, faculty_id, batch_id}) or null. */
export function getCurrentUser() {
  try { return JSON.parse(read(USER_KEY)); } catch { return null; }
}

function saveSession(loginResponse) {
  store(TOKEN_KEY, loginResponse.access_token);
  store(USER_KEY, JSON.stringify(loginResponse.user));
}

export function logout() {
  store(TOKEN_KEY, null);
  store(USER_KEY, null);
}

// ------------------------------------------------------------------ real backend

async function request(method, path, { query, body, form } = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) logout();
    const detail = typeof data?.detail === 'string' ? data.detail : 'Something went wrong. Please try again.';
    throw new ApiError(res.status, data?.code || 'ERROR', detail, data);
  }
  return data;
}

// ------------------------------------------------------------------ mock backend helpers

const mockCache = new Map();
const mockRead = new Set();  // notification ids marked read during this session

async function mock(name) {
  if (!mockCache.has(name)) {
    mockCache.set(name, fetch(`${MOCK_BASE}/${name}.json`).then((r) => {
      if (!r.ok) throw new ApiError(404, 'NOT_FOUND', `Mock file ${name}.json is missing.`);
      return r.json();
    }));
  }
  const data = await mockCache.get(name);
  await new Promise((r) => setTimeout(r, 250));  // feel like a network, so loading states get built
  return structuredClone(data);
}

function mockUser() {
  const user = getCurrentUser();
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Please log in again.');
  return user;
}

function mockRequireHod() {
  if (mockUser().role !== 'hod') throw new ApiError(403, 'FORBIDDEN', 'Only the HOD can do this.');
}

function mockNotFound(what) {
  return new ApiError(404, 'NOT_FOUND', `${what} was not found.`);
}

// ------------------------------------------------------------------ auth

/** POST /api/auth/login  -> LoginResponse. Demo accounts: CONTRACT.md section 7. */
export async function login(email, password) {
  if (!USE_MOCK) {
    const res = await request('POST', '/api/auth/login', { body: { email, password } });
    saveSession(res);
    return res;
  }
  for (const role of ['hod', 'faculty', 'student']) {
    const res = await mock(`login_${role}`);
    if (res.user.email === email.trim().toLowerCase() && password === MOCK_PASSWORD) {
      saveSession(res);
      return res;
    }
  }
  throw new ApiError(401, 'UNAUTHORIZED', 'Wrong email or password.');
}

/** GET /api/auth/me -> User */
export async function getMe() {
  if (!USE_MOCK) return request('GET', '/api/auth/me');
  return mockUser();
}

// ------------------------------------------------------------------ reference data

/** GET /api/health -> Health */
export const getHealth = () => (USE_MOCK ? mock('health') : request('GET', '/api/health'));
/** GET /api/calendar -> Calendar (days, period times, today, current week) */
export const getCalendar = () => (USE_MOCK ? mock('calendar') : request('GET', '/api/calendar'));
/** GET /api/faculty -> Faculty[] */
export const listFaculty = () => (USE_MOCK ? mock('faculty') : request('GET', '/api/faculty'));
/** GET /api/batches -> Batch[] */
export const listBatches = () => (USE_MOCK ? mock('batches') : request('GET', '/api/batches'));
/** GET /api/subjects -> Subject[] */
export const listSubjects = () => (USE_MOCK ? mock('subjects') : request('GET', '/api/subjects'));
/** GET /api/spaces -> Space[] (rooms and labs) */
export const listSpaces = () => (USE_MOCK ? mock('spaces') : request('GET', '/api/spaces'));

// ------------------------------------------------------------------ timetable, rooms, search

/**
 * GET /api/timetable -> TimetableWeek
 * Give at most one of batchId / facultyId / spaceId; none = whole department.
 * The mock only has the week of 2026-10-26; other weeks come back empty.
 */
export async function getTimetable({ weekStart, batchId, facultyId, spaceId } = {}) {
  if (!USE_MOCK) {
    return request('GET', '/api/timetable', {
      query: { week_start: weekStart, batch_id: batchId, faculty_id: facultyId, space_id: spaceId },
    });
  }
  mockUser();
  const week = await mock('timetable_week');
  week.filter = { batch_id: batchId ?? null, faculty_id: facultyId ?? null, space_id: spaceId ?? null };
  if (weekStart && weekStart !== week.week_start) {
    return { ...week, week_start: weekStart, week_end: weekStart, entries: [] };
  }
  week.entries = week.entries.filter((e) =>
    (batchId == null || e.batch.id === Number(batchId))
    && (facultyId == null || e.faculty.id === Number(facultyId))
    && (spaceId == null || e.space.id === Number(spaceId)));
  return week;
}

/** GET /api/timetable/me -> TimetableWeek for the logged-in user (student: batch, faculty/HOD: own classes) */
export async function getMyTimetable({ weekStart } = {}) {
  if (!USE_MOCK) return request('GET', '/api/timetable/me', { query: { week_start: weekStart } });
  const user = mockUser();
  return user.role === 'student'
    ? getTimetable({ weekStart, batchId: user.batch_id })
    : getTimetable({ weekStart, facultyId: user.faculty_id });
}

/** GET /api/availability/rooms -> RoomAvailability (mock: Thursday 29 Oct only) */
export async function getRoomAvailability({ date, period } = {}) {
  if (!USE_MOCK) return request('GET', '/api/availability/rooms', { query: { date, period } });
  mockUser();
  const av = await mock('availability_rooms');
  if (period) av.spaces.forEach((s) => { s.slots = s.slots.filter((x) => x.period === Number(period)); });
  return av;
}

/** GET /api/search?q= -> SearchResult[] (faculty, batches, rooms, subjects; matches word starts) */
export async function search(q, limit = 8) {
  if (!USE_MOCK) return request('GET', '/api/search', { query: { q, limit } });
  mockUser();
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const [fac, bat, spa, sub] = await Promise.all([listFaculty(), listBatches(), listSpaces(), listSubjects()]);
  const items = [
    ...fac.map((f) => ({ type: 'faculty', id: f.id, label: f.name, sublabel: f.designation, code: f.code })),
    ...bat.map((b) => ({ type: 'batch', id: b.id, label: b.code, sublabel: b.name, code: b.code })),
    ...spa.map((s) => ({ type: 'space', id: s.id, label: s.code, sublabel: s.name, code: s.code })),
    ...sub.map((s) => ({ type: 'subject', id: s.id, label: s.name, sublabel: `${s.code} - Semester ${s.semester}`, code: s.code })),
  ];
  const words = (it) => [...it.label.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/), it.code.toLowerCase()];
  return items.filter((it) => words(it).some((w) => w.startsWith(term)))
    .slice(0, limit)
    .map(({ code, ...rest }) => rest);
}

// ------------------------------------------------------------------ leave, closures, events

/** GET /api/unavailability -> Unavailability[]  (faculty only ever get their own) */
export async function listUnavailability({ from, to, mine } = {}) {
  if (!USE_MOCK) return request('GET', '/api/unavailability', { query: { from, to, mine } });
  const user = mockUser();
  if (user.role === 'student') throw new ApiError(403, 'FORBIDDEN', 'Students cannot view leave records.');
  const all = await mock('unavailability');
  const own = (u) => u.created_by.id === user.id || (u.target.type === 'faculty' && u.target.id === user.faculty_id);
  return all.filter((u) => (user.role === 'hod' && !mine ? true : own(u))
    && (!from || u.end_date >= from) && (!to || u.start_date <= to));
}

/**
 * POST /api/unavailability -> UnavailabilityCreated
 * body: { kind, target_id, start_date, end_date, periods (null = whole day), reason }
 * The mock always answers with the Ms. Ritika Verma example.
 */
export async function createUnavailability(body) {
  if (!USE_MOCK) return request('POST', '/api/unavailability', { body });
  const user = mockUser();
  if (user.role === 'student') throw new ApiError(403, 'FORBIDDEN', 'Students cannot mark leave.');
  if (!body?.reason) {
    throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.',
      { fields: [{ field: 'reason', message: 'Please give a short reason' }] });
  }
  return mock('unavailability_create');
}

/** DELETE /api/unavailability/{id} -> UnavailabilityWithdrawn (only while nothing has been decided) */
export async function withdrawUnavailability(id) {
  if (!USE_MOCK) return request('DELETE', `/api/unavailability/${id}`);
  mockUser();
  return mock('unavailability_withdraw');
}

// ------------------------------------------------------------------ proposals (HOD)

/** GET /api/proposals -> Proposal[]  status: "pending" | "approved" | "rejected" */
export async function listProposals({ status, unavailabilityId } = {}) {
  if (!USE_MOCK) return request('GET', '/api/proposals', { query: { status, unavailability_id: unavailabilityId } });
  mockRequireHod();
  const all = await mock('proposals');
  return all.filter((p) => (!status || p.status === status)
    && (!unavailabilityId || p.unavailability_id === Number(unavailabilityId)));
}

/** GET /api/proposals/{id} -> Proposal */
export async function getProposal(id) {
  if (!USE_MOCK) return request('GET', `/api/proposals/${id}`);
  mockRequireHod();
  const p = (await mock('proposals')).find((x) => x.id === Number(id));
  if (!p) throw mockNotFound(`Proposal ${id}`);
  return p;
}

/** POST /api/proposals/{id}/check  body {date, period, space_id} -> CheckResult (for the "pick another slot" form) */
export async function checkProposalSlot(id, slot) {
  if (!USE_MOCK) return request('POST', `/api/proposals/${id}/check`, { body: slot });
  const p = await getProposal(id);
  const opt = p.options.find((o) => o.date === slot.date && o.period === Number(slot.period) && o.space.id === Number(slot.space_id));
  if (opt) return { ok: true, clashes: [], score: opt.score, breakdown: opt.breakdown };
  return mock('proposal_check_clash');
}

function mockDecide(p, action, version, extra) {
  if (p.status !== 'pending') throw new ApiError(409, 'ALREADY_DECIDED', 'A decision was already made for this class.');
  if (version !== p.version) throw new ApiError(409, 'STALE', 'Someone else changed this proposal. Reload to see the latest version.');
  const user = mockUser();
  return {
    ...p,
    status: action,
    version: p.version + 1,
    decision: { action, by: { id: user.id, name: user.name, role: user.role }, at: new Date().toISOString(), ...extra },
  };
}

/**
 * POST /api/proposals/{id}/approve -> Proposal
 * body: { version, option_rank }  or  { version, custom: {date, period, space_id} }, plus optional note
 */
export async function approveProposal(id, body) {
  if (!USE_MOCK) return request('POST', `/api/proposals/${id}/approve`, { body });
  const p = await getProposal(id);
  if (body.custom) {
    const check = await checkProposalSlot(id, body.custom);
    if (!check.ok) throw new ApiError(409, 'CLASH', 'This slot is no longer free.', check);
    const opt = p.options.find((o) => o.date === body.custom.date && o.period === Number(body.custom.period));
    return mockDecide(p, 'approved', body.version, { custom: true, rank: null, slot: opt ? pickSlot(opt) : null, note: body.note ?? null });
  }
  const opt = p.options.find((o) => o.rank === body.option_rank);
  if (!opt) throw new ApiError(400, 'VALIDATION', `There is no option ${body.option_rank}.`);
  return mockDecide(p, 'approved', body.version, { custom: false, rank: opt.rank, slot: pickSlot(opt), note: body.note ?? null });
}

const pickSlot = ({ date, day, period, start, end, space }) => ({ date, day, period, start, end, space });

/** POST /api/proposals/{id}/reject  body {version, note} -> Proposal (the class stays cancelled) */
export async function rejectProposal(id, body) {
  if (!USE_MOCK) return request('POST', `/api/proposals/${id}/reject`, { body });
  const p = await getProposal(id);
  return mockDecide(p, 'rejected', body.version, { custom: false, rank: null, slot: null, note: body.note ?? null });
}

// ------------------------------------------------------------------ what-if (HOD)

/**
 * POST /api/whatif  body {changes: [UnavailabilityCreate, ...]} -> WhatIfResult. Nothing is saved.
 * Undo = remove the last change from your list and call this again.
 */
export async function runWhatIf(changes) {
  if (!USE_MOCK) return request('POST', '/api/whatif', { body: { changes } });
  mockRequireHod();
  return mock('whatif');
}

// ------------------------------------------------------------------ notifications and live updates

async function mockNotifications() {
  const role = mockUser().role;
  const page = await mock(`notifications_${role}`);
  page.items.forEach((n) => { if (mockRead.has(n.id)) n.read = true; });
  page.unread = page.items.filter((n) => !n.read).length;
  return page;
}

/** GET /api/notifications -> NotificationPage {items, total, unread} (newest first) */
export async function listNotifications({ unreadOnly = false, limit = 20, offset = 0 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/notifications', { query: { unread_only: unreadOnly, limit, offset } });
  const page = await mockNotifications();
  const items = page.items.filter((n) => !unreadOnly || !n.read);
  return { ...page, items: items.slice(offset, offset + limit), total: items.length };
}

/** POST /api/notifications/{id}/read -> Notification */
export async function markNotificationRead(id) {
  if (!USE_MOCK) return request('POST', `/api/notifications/${id}/read`);
  const n = (await mockNotifications()).items.find((x) => x.id === Number(id));
  if (!n) throw mockNotFound(`Notification ${id}`);
  mockRead.add(n.id);
  return { ...n, read: true };
}

/** POST /api/notifications/read-all -> {updated} */
export async function markAllNotificationsRead() {
  if (!USE_MOCK) return request('POST', '/api/notifications/read-all');
  const page = await mockNotifications();
  const unread = page.items.filter((n) => !n.read);
  unread.forEach((n) => mockRead.add(n.id));
  return { updated: unread.length };
}

const mockListeners = new Set();

/**
 * Live updates (GET /api/notifications/stream, Server-Sent Events).
 * handlers: { notification(n), timetable_changed(e), proposal_updated(e) } - all optional.
 * Returns a function that stops listening. In mock mode nothing arrives by itself;
 * call mockEmit('notification') from the browser console to test your UI.
 */
export function subscribeToEvents(handlers) {
  if (USE_MOCK) {
    mockListeners.add(handlers);
    return () => mockListeners.delete(handlers);
  }
  const source = new EventSource(`${API_BASE}/api/notifications/stream?token=${encodeURIComponent(getToken() || '')}`);
  for (const type of ['notification', 'timetable_changed', 'proposal_updated']) {
    source.addEventListener(type, (ev) => handlers[type]?.(JSON.parse(ev.data)));
  }
  return () => source.close();
}

/** Mock only: pretend the server sent an event ("notification", "timetable_changed" or "proposal_updated"). */
export async function mockEmit(type = 'notification') {
  const examples = await mock('sse_examples');
  mockListeners.forEach((h) => h[type]?.(examples[type]));
}
if (USE_MOCK && typeof window !== 'undefined') window.mockEmit = mockEmit;

// ------------------------------------------------------------------ activity, analytics, settings (HOD)

/** GET /api/activity -> ActivityPage {items, total} (newest first) */
export async function listActivity({ limit = 50, offset = 0 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/activity', { query: { limit, offset } });
  mockRequireHod();
  const page = await mock('activity');
  return { items: page.items.slice(offset, offset + limit), total: page.total };
}

/** GET /api/analytics/summary -> AnalyticsSummary (numbers for the HOD dashboard cards) */
export async function getAnalyticsSummary({ weekStart } = {}) {
  if (!USE_MOCK) return request('GET', '/api/analytics/summary', { query: { week_start: weekStart } });
  mockRequireHod();
  return mock('analytics_summary');
}

/** GET /api/analytics/trends -> AnalyticsTrends (data for the Chart.js charts) */
export async function getAnalyticsTrends({ weeks = 8 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/analytics/trends', { query: { weeks } });
  mockRequireHod();
  return mock('analytics_trends');
}

/** GET /api/settings/ranking -> RankingSettings */
export async function getRankingSettings() {
  if (!USE_MOCK) return request('GET', '/api/settings/ranking');
  mockRequireHod();
  return mock('settings_ranking');
}

/** PUT /api/settings/ranking  body: any of {weights, k, max_batch_classes_per_day, min_notice_hours, search_weeks} -> RankingSettings */
export async function updateRankingSettings(patch) {
  if (!USE_MOCK) return request('PUT', '/api/settings/ranking', { body: patch });
  mockRequireHod();
  const current = await mock('settings_ranking');
  const missing = patch.weights ? Object.keys(current.weights).filter((k) => !(k in patch.weights)) : [];
  if (missing.length) {
    throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.',
      { fields: missing.map((k) => ({ field: `weights.${k}`, message: 'Send all six weights together' })) });
  }
  return { ...current, ...patch, weights: { ...current.weights, ...(patch.weights || {}) } };
}

// ------------------------------------------------------------------ import, demo tools (HOD)

/** POST /api/import/timetable (CSV file) -> ImportResult. dryRun = only check, save nothing. */
export async function importTimetable(file, { dryRun = true } = {}) {
  if (!USE_MOCK) {
    const form = new FormData();
    form.append('file', file);
    return request('POST', '/api/import/timetable', { query: { dry_run: dryRun }, form });
  }
  mockRequireHod();
  return { ...(await mock('import_result')), dry_run: dryRun };
}

/** POST /api/demo/reset -> DemoResetResult (puts the demo data back to the start) */
export async function resetDemo() {
  if (!USE_MOCK) return request('POST', '/api/demo/reset');
  mockRequireHod();
  mockRead.clear();
  return mock('demo_reset');
}

/** GET /api/outbox -> OutboxPage (emails the system sent; in demo mode they all go to one test inbox) */
export async function listOutbox({ limit = 50, offset = 0 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/outbox', { query: { limit, offset } });
  mockRequireHod();
  const page = await mock('outbox');
  return { items: page.items.slice(offset, offset + limit), total: page.total };
}
