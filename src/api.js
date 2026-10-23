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

import { createEngine } from './mock/engine.js';

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

// v3: the demo data now holds every batch from the department's sheets (new ids), so older saved logins are not used.
const TOKEN_KEY = 'sss.token.v3';
const USER_KEY = 'sss.user.v3';

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

/** A fixed mock file (logins, health). */
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

// In mock mode everything else comes from the demo engine (src/mock/engine.js): it reads the department's
// timetables (public/mock/timetables.json) and keeps what people do in this browser until "Reset demo data".
const DEMO_KEY = 'sss.demo.v1';
let enginePromise = null;

function demoEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all(['timetables', 'demo', 'settings_ranking'].map((name) =>
      fetch(`${MOCK_BASE}/${name}.json`).then((r) => {
        if (!r.ok) throw new ApiError(404, 'NOT_FOUND', `Mock file ${name}.json is missing.`);
        return r.json();
      })))
      .then(([source, demo, ranking]) => createEngine({
        source,
        demo,
        ranking,
        saved: (() => { try { return JSON.parse(read(DEMO_KEY)) || []; } catch { return []; } })(),
        onSave: (events) => store(DEMO_KEY, JSON.stringify(events)),
        makeError: (status, code, detail, body) => new ApiError(status, code, detail, body),
      }))
      .catch((err) => {
        enginePromise = null;  // try again next time
        throw err;
      });
  }
  return enginePromise;
}

/** Asks the demo engine, after a short pretend network delay. */
async function demo(ask) {
  const engine = await demoEngine();
  await new Promise((r) => setTimeout(r, 250));
  return structuredClone(ask(engine));
}

function mockUser() {
  const user = getCurrentUser();
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Please log in again.');
  return user;
}

function mockRequireHod() {
  if (mockUser().role !== 'hod') throw new ApiError(403, 'FORBIDDEN', 'Only the HOD can do this.');
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
/** GET /api/calendar -> Calendar (days, the hours of the day, today, current week) */
export const getCalendar = () => (USE_MOCK ? demo((e) => e.calendar()) : request('GET', '/api/calendar'));
/** GET /api/faculty -> Faculty[] */
export const listFaculty = () => (USE_MOCK ? demo((e) => e.faculty()) : request('GET', '/api/faculty'));
/** GET /api/batches -> Batch[] (each with its programme, semester, room, days and its own time slots) */
export const listBatches = () => (USE_MOCK ? demo((e) => e.batches()) : request('GET', '/api/batches'));
/** GET /api/subjects -> Subject[] */
export const listSubjects = () => (USE_MOCK ? demo((e) => e.subjects()) : request('GET', '/api/subjects'));
/** GET /api/spaces -> Space[] (rooms and labs) */
export const listSpaces = () => (USE_MOCK ? demo((e) => e.spaces()) : request('GET', '/api/spaces'));

// ------------------------------------------------------------------ timetable, rooms, search

/**
 * GET /api/timetable -> TimetableWeek {week_start, days, slots, breaks, entries}
 * Give at most one of batchId / facultyId / spaceId; none = every batch.
 * slots are the rows of the grid: a batch's own time slots, or the times a teacher's or room's classes use.
 */
export async function getTimetable({ weekStart, batchId, facultyId, spaceId } = {}) {
  if (!USE_MOCK) {
    return request('GET', '/api/timetable', {
      query: { week_start: weekStart, batch_id: batchId, faculty_id: facultyId, space_id: spaceId },
    });
  }
  mockUser();
  return demo((e) => e.week({ weekStart, batchId, facultyId, spaceId }));
}

/** GET /api/timetable/me -> TimetableWeek for the logged-in user (student: batch, faculty/HOD: own classes) */
export async function getMyTimetable({ weekStart } = {}) {
  if (!USE_MOCK) return request('GET', '/api/timetable/me', { query: { week_start: weekStart } });
  const user = mockUser();
  return user.role === 'student'
    ? getTimetable({ weekStart, batchId: user.batch_id })
    : getTimetable({ weekStart, facultyId: user.faculty_id });
}

/** GET /api/availability/rooms -> RoomAvailability (period = an hour of the day, see getCalendar().periods) */
export async function getRoomAvailability({ date, period } = {}) {
  if (!USE_MOCK) return request('GET', '/api/availability/rooms', { query: { date, period } });
  mockUser();
  return demo((e) => e.roomAvailability(date, period));
}

/** GET /api/clashes -> {week_start, items, counts}: two classes at once for one teacher, room or batch, in that week */
export async function getClashes({ weekStart } = {}) {
  if (!USE_MOCK) return request('GET', '/api/clashes', { query: { week_start: weekStart } });
  mockUser();
  return demo((e) => e.clashes({ weekStart }));
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
    ...sub.map((s) => ({ type: 'subject', id: s.id, label: s.name, sublabel: `${s.code} · ${s.batch_code}`, code: s.code })),
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
  return demo((e) => e.unavailability(user, { from, to, mine }));
}

/**
 * POST /api/unavailability -> UnavailabilityCreated {unavailability, affected, proposals}
 * body: { kind, target_id, start_date, end_date, periods (null = whole day), reason }
 * The affected classes are cancelled and each gets ranked suggestions for a new slot.
 */
export async function createUnavailability(body) {
  if (!USE_MOCK) return request('POST', '/api/unavailability', { body });
  const user = mockUser();
  return demo((e) => e.createUnavailability(user, body));
}

/** DELETE /api/unavailability/{id} -> UnavailabilityWithdrawn (only while nothing has been decided) */
export async function withdrawUnavailability(id) {
  if (!USE_MOCK) return request('DELETE', `/api/unavailability/${id}`);
  const user = mockUser();
  return demo((e) => e.withdrawUnavailability(user, id));
}

// ------------------------------------------------------------------ proposals (HOD)

/** GET /api/proposals -> Proposal[]  status: "pending" | "approved" | "rejected" */
export async function listProposals({ status, unavailabilityId } = {}) {
  if (!USE_MOCK) return request('GET', '/api/proposals', { query: { status, unavailability_id: unavailabilityId } });
  mockRequireHod();
  return demo((e) => e.proposals({ status, unavailabilityId }));
}

/** GET /api/proposals/{id} -> Proposal */
export async function getProposal(id) {
  if (!USE_MOCK) return request('GET', `/api/proposals/${id}`);
  mockRequireHod();
  return demo((e) => e.proposal(id));
}

/** POST /api/proposals/{id}/check  body {date, period, space_id} -> CheckResult (for the "pick another slot" form) */
export async function checkProposalSlot(id, slot) {
  if (!USE_MOCK) return request('POST', `/api/proposals/${id}/check`, { body: slot });
  mockRequireHod();
  return demo((e) => e.checkSlot(id, slot));
}

/**
 * POST /api/proposals/{id}/approve -> Proposal
 * body: { version, option_rank }  or  { version, custom: {date, period, space_id} }, plus optional note
 */
export async function approveProposal(id, body) {
  if (!USE_MOCK) return request('POST', `/api/proposals/${id}/approve`, { body });
  mockRequireHod();
  const user = mockUser();
  return demo((e) => e.approve(user, id, body));
}

/** POST /api/proposals/{id}/reject  body {version, note} -> Proposal (the class stays cancelled) */
export async function rejectProposal(id, body) {
  if (!USE_MOCK) return request('POST', `/api/proposals/${id}/reject`, { body });
  mockRequireHod();
  const user = mockUser();
  return demo((e) => e.reject(user, id, body));
}

// ------------------------------------------------------------------ what-if (HOD)

/**
 * POST /api/whatif  body {changes: [UnavailabilityCreate, ...]} -> WhatIfResult. Nothing is saved.
 * Undo = remove the last change from your list and call this again.
 */
export async function runWhatIf(changes) {
  if (!USE_MOCK) return request('POST', '/api/whatif', { body: { changes } });
  mockRequireHod();
  const user = mockUser();
  return demo((e) => e.whatIf(user, changes));
}

// ------------------------------------------------------------------ notifications and live updates

/** GET /api/notifications -> NotificationPage {items, total, unread} (newest first) */
export async function listNotifications({ unreadOnly = false, limit = 20, offset = 0 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/notifications', { query: { unread_only: unreadOnly, limit, offset } });
  const user = mockUser();
  return demo((e) => e.notifications(user, { unreadOnly, limit, offset }));
}

/** POST /api/notifications/{id}/read -> Notification */
export async function markNotificationRead(id) {
  if (!USE_MOCK) return request('POST', `/api/notifications/${id}/read`);
  const user = mockUser();
  return demo((e) => e.markRead(user, id));
}

/** POST /api/notifications/read-all -> {updated} */
export async function markAllNotificationsRead() {
  if (!USE_MOCK) return request('POST', '/api/notifications/read-all');
  const user = mockUser();
  return demo((e) => e.markAllRead(user));
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
  const user = mockUser();
  const example = await demo((e) => e.liveExample(type, user));
  if (example) mockListeners.forEach((h) => h[type]?.(example));
}
if (USE_MOCK && typeof window !== 'undefined') window.mockEmit = mockEmit;

// ------------------------------------------------------------------ activity, analytics, settings (HOD)

/** GET /api/activity -> ActivityPage {items, total} (newest first) */
export async function listActivity({ limit = 50, offset = 0 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/activity', { query: { limit, offset } });
  mockRequireHod();
  return demo((e) => e.activity({ limit, offset }));
}

/** GET /api/analytics/summary -> AnalyticsSummary (numbers for the HOD dashboard cards) */
export async function getAnalyticsSummary({ weekStart } = {}) {
  if (!USE_MOCK) return request('GET', '/api/analytics/summary', { query: { week_start: weekStart } });
  mockRequireHod();
  return demo((e) => e.summary({ weekStart }));
}

/** GET /api/analytics/trends -> AnalyticsTrends (data for the Chart.js charts) */
export async function getAnalyticsTrends({ weeks = 8 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/analytics/trends', { query: { weeks } });
  mockRequireHod();
  return demo((e) => e.trends({ weeks }));
}

/** GET /api/settings/ranking -> RankingSettings */
export async function getRankingSettings() {
  if (!USE_MOCK) return request('GET', '/api/settings/ranking');
  mockRequireHod();
  return demo((e) => e.ranking());
}

/** PUT /api/settings/ranking  body: any of {weights, k, max_batch_classes_per_day, min_notice_hours, search_weeks} -> RankingSettings */
export async function updateRankingSettings(patch) {
  if (!USE_MOCK) return request('PUT', '/api/settings/ranking', { body: patch });
  mockRequireHod();
  const user = mockUser();
  return demo((e) => e.updateRanking(user, patch));
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
  const text = await file.text();
  return demo((e) => e.checkImport(text, dryRun));
}

/** POST /api/demo/reset -> DemoResetResult (puts the demo data back to the start) */
export async function resetDemo() {
  if (!USE_MOCK) return request('POST', '/api/demo/reset');
  mockRequireHod();
  return demo((e) => e.reset());
}

/** GET /api/outbox -> OutboxPage (emails the system sent; in demo mode they all go to one test inbox) */
export async function listOutbox({ limit = 50, offset = 0 } = {}) {
  if (!USE_MOCK) return request('GET', '/api/outbox', { query: { limit, offset } });
  mockRequireHod();
  return demo((e) => e.outbox({ limit, offset }));
}
