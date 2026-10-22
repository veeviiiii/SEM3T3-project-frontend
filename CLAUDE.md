# CLAUDE.md: Smart Scheduling frontend (Apoorvi's pages)

You are helping Apoorvi build her part of the frontend of a team project. This folder is a working
Vite + vanilla JavaScript + Tailwind starter. The specification below says exactly what to build.

## Scope

Build only these four parts, one per session, in this order unless Apoorvi asks for another:

| Section | What | Files |
|---|---|---|
| §4.1 | Top bar: search box + notifications panel | `src/lib/layout.js` |
| §4.2 | Faculty: My week | `faculty.html`, `src/pages/faculty.js` |
| §4.3 | HOD: Dashboard | `hod.html`, `src/pages/hod.js` |
| §4.4 | HOD: Approvals (the main demo screen) | `approvals.html`, `src/pages/approvals.js` |

- **Already built by Vedant. Do not change:** Timetables, Rooms, Reports, What-if and Settings
  (`timetable.html`, `rooms.html`, `reports.html`, `whatif.html`, `settings.html` and their `src/pages/*.js`).
  Read them freely: they are good examples of the 6-step pattern.
- **Never edit:** `src/api.js`, anything in `public/mock/`, `src/lib/ui.js`, `src/lib/timetable-grid.js`,
  `src/styles.css`, `index.html`, `student.html`, `src/pages/student.js`, `vite.config.js`, `package.json`,
  `.claude/`.
- **`src/lib/layout.js`:** edit it only for §4.1. Keep `homeFor`, `requireLogin`, `renderHeader` and
  `refreshBell` with the same names and behaviour, because every page imports them.
- **No new dependencies, frameworks or CDN scripts.**

## How to work on a page

0. If `node_modules/` is missing, run `npm install` first. Node.js 22 or newer is needed.
1. Read its section below, `src/pages/student.js` (the reference page), and the `public/mock/` files the
   page's api.js functions return.
2. Build it following §1–§3 exactly.
3. Run the dev server (`npm run dev`). Log in with the demo buttons on the login page, then check:
   - every item in the page's **Acceptance** list;
   - the browser console shows no errors;
   - at 375px width the page does not scroll sideways.
4. Fix anything that fails, then report to Apoorvi:
   - what passed;
   - anything that did not pass;
   - a short explanation in plain words of how the page works: which api.js functions it calls, what
     happens when a button is clicked, and how errors are shown.

   She will be asked about her pages in the viva, so keep this explanation simple and clear.
5. Match the style of `student.js`: short comments, plain names, nothing clever.

## Git workflow rules

Repo: https://github.com/veeviiiii/SEM3T3-project-frontend (public). Reviewer: Vee (`veeviiiii`).

- Never commit or push directly to main.
- Before starting new work: switch to main, pull the latest changes, then create a new branch with a
  short descriptive name (e.g. `feature/login-page`, `fix/navbar-mobile`).
- When Apoorvi says the change is done or "send for review": commit with clear messages, push the branch,
  and open a PR into main using `gh`, with `veeviiiii` as reviewer.
- The PR description must cover: what changed, which pages/components are affected, how to test it, and
  anything unfinished or that Apoorvi wants Vee's opinion on.
- After opening the PR, give Apoorvi the PR link.
- When Apoorvi says "fix review comments": read all of Vee's comments on the PR (including inline code
  comments), make the changes on the SAME branch, and push. Do not open a new PR.
- After a PR is merged: switch to main, pull, and delete the old branch.
- Never commit `.env` files, API keys, or secrets.

---

# Frontend Technical Specification: Smart Scheduling System

## 0. Scope and Stack

- **Stack:** Vite multi-page app, vanilla JS (ES modules), Tailwind CSS, Chart.js (Reports only), Motion (optional, light use).
- **Scope:** Frontend only. No backend, database, or algorithm work.
- **Data source:** `src/api.js` only. It currently reads mock files from `public/mock/`; switching to the real server is a single config flag inside `api.js` and requires zero page changes.
- **Source of truth for response shapes:** `CONTRACT.md` §3–4 and the matching `public/mock/*.json` file.

### 0.1 File map

| Path | Status | Rule |
|---|---|---|
| `index.html`, `src/pages/login.js` | Done | Do not modify |
| `student.html`, `src/pages/student.js` | Done | **Reference implementation.** Copy its pattern |
| `faculty.html`, `hod.html`, `approvals.html` + matching `src/pages/*.js` | **To build** | Stubs already contain header + title |
| `timetable.html`, `rooms.html`, `reports.html`, `whatif.html`, `settings.html` + matching `src/pages/*.js` | Done by Vedant | Do not touch |
| `src/lib/layout.js` | **To finish** | Search box + notifications (see §4.1) |
| `src/api.js` | Read-only | Never edit |
| `public/mock/` (35 files) | Read-only | Never edit |
| `src/lib/ui.js`, `src/lib/timetable-grid.js`, `src/styles.css` | Use | Shared helpers and classes |
| `vite.config.js` | Edit only to add pages | Every new page = `.html` + `src/pages/<name>.js` + entry here |

### 0.2 Available helpers (import, do not re-implement)

| Module | Export | Purpose |
|---|---|---|
| `lib/layout.js` | `requireLogin(allowedRoles)` | Returns `user` or redirects to the user's own home page |
| | `renderHeader(user)` | Draws the top bar |
| | `refreshBell()` | Re-fetches the unread count on the bell |
| | `homeFor(role)` | Home page path for a role |
| `lib/ui.js` | `$(selector, root?)` | `querySelector` shorthand |
| | `escapeHtml(value)` | XSS escaping (mandatory, see §2.1) |
| | `formatDate(isoDate)`, `addDays(isoDate, days)` | Date helpers |
| | `statusInfo(entry)` | Status → colour/badge (see §3) |
| | `renderLoading(container, text?)` | Loading state |
| | `renderEmpty(container, title, hint?)` | Empty state |
| | `renderError(container, error, onRetry)` | Error state + "Try again" |
| | `showToast(message, kind)` | `kind`: `'info'` (default) \| `'success'` \| `'error'` |
| | `prefersReducedMotion()` | Gate any Motion animation |
| `lib/timetable-grid.js` | `renderTimetableGrid(container, week, calendar, { show })` | `show`: `'faculty'` (default) \| `'batch'` \| `'both'` |

---

## 1. Global Architecture Rules

### 1.1 Mandatory 6-step page pattern

Every page script MUST follow this structure (from `src/pages/student.js`):

```js
// 1. Role gate. Unauthorised users are redirected automatically.
const user = requireLogin(['student']);

if (user) {
  renderHeader(user);              // 2. Draw the top bar
  load();
}

async function load() {
  renderLoading(box);              // 3. Show loading state immediately
  try {
    const week = await getMyTimetable({ weekStart });   // 4. Call api.js
    renderTimetableGrid(box, week, calendar);           // 5. Render the response
  } catch (err) {
    renderError(box, err, load);   // Error state with retry
  }
}

nextButton.addEventListener('click', () => { /* update state */ load(); });   // 6. React to events
```

| Step | Requirement |
|---|---|
| 1 | `requireLogin([...])` at module top level. All other code runs only inside `if (user)` |
| 2 | `renderHeader(user)` before any data load |
| 3 | `renderLoading(container)` before every `await` that fills a region |
| 4 | Data comes from an `api.js` function, nothing else |
| 5 | Render the result. Use `renderEmpty(...)` when the result is empty. Use `renderError(container, err, retryFn)` in `catch` |
| 6 | Event handlers update state and re-call the relevant `load()` |

### 1.2 Data access rules

- **NEVER** call `fetch()`, `XMLHttpRequest`, or `EventSource` directly. Always import a function from `src/api.js` (full list in §5).
- **NEVER** edit `src/api.js` or anything in `public/mock/`.
- Thrown errors expose:
  - `err.detail`: a user-facing sentence. Display it as-is.
  - `err.code`: a machine-readable code (see below).
  - Extra fields depending on the code.

| `err.code` | Extra field | Required handling |
|---|---|---|
| `VALIDATION` | `err.fields: [{ field, message }]` | Show each `message` in red directly under its form field |
| `STALE` | — | Tell the user someone else changed the record, then reload it |
| `CLASH` | `err.clashes` | Render the clash list |
| any other | — | Show `err.detail` (via `renderError` or `showToast(err.detail, 'error')`) |

### 1.3 Role access

| Page | `requireLogin(...)` | In nav for |
|---|---|---|
| `student.html` | `['student']` | Student |
| `faculty.html` | `['faculty', 'hod']` | Faculty |
| `hod.html` | `['hod']` | HOD |
| `approvals.html` | `['hod']` | HOD |
| `timetable.html` | `['hod', 'faculty', 'student']` | All |
| `rooms.html` | `['hod', 'faculty', 'student']` | All |
| `reports.html` | `['hod']` | HOD |

---

## 2. Security & UI Rules

### 2.1 XSS: `escapeHtml()` is mandatory

- Every server-derived value inserted through `innerHTML` or an HTML template string MUST be wrapped: `${escapeHtml(entry.subject.name)}`.
- No exceptions: names, codes, reasons, notes, labels, warnings, notification titles, error text.
- Using `textContent` instead of `innerHTML` is also acceptable.

### 2.2 Async buttons

- Set `button.disabled = true` **before** the `await` on any button that triggers an API call. This prevents double-submission.
- Set `button.disabled = false` in `catch`.

### 2.3 Required states

- Every data region MUST implement three states: **loading** (`renderLoading`), **empty** (`renderEmpty`), and **error** (`renderError` with a retry callback).
- The mock adds 250 ms latency on purpose, so all three states are visible during development.

### 2.4 Tailwind classes (from `src/styles.css`)

| Class | Use |
|---|---|
| `btn-primary` | The single main action on a screen (blue), e.g. "Approve", "Save leave". **Max one per screen.** |
| `btn-secondary` | All other actions (white): "Cancel", "Pick another slot", week arrows |
| `btn-danger` | Removing or rejecting (red): "Reject", "Keep cancelled", "Withdraw leave" |
| `card` | White bordered box. One per page section |
| `input` | Form fields |
| `label` | Form field labels |
| `page-title` | The main heading at the top of each page |

- Write full Tailwind class names literally in source code. **Never build class names dynamically** (for example `'bg-' + colour` will not work). Use lookup maps of complete class strings, e.g. `{ high: 'bg-blue-700', low: 'bg-blue-100' }`.

### 2.5 Layout & accessibility

- `page-title` goes top-left. The primary action goes top-right. This applies to every page.
- Must work at 375 px width. **The page must never scroll horizontally**; only the timetable grid may.
- Use `<button>` for every clickable action, `<label for="...">` for every form field, and `alt` text on every image. Everything must be keyboard-operable.
- Modal forms use `<dialog>`.

### 2.6 Copy & interaction

- Use plain-language labels: "Mark leave", "Approve", "Pick another slot", "Keep cancelled". **Never** use "Create unavailability" or "Submit proposal".
- After every successful mutation, call `showToast(text, 'success')` stating the outcome. Example: `"Approved. DAA moved to Fri 10:00 and S3-A has been told."`
- Before every irreversible action (reject / keep cancelled, withdraw leave), ask for confirmation with `confirm()`. Example: `"Keep this class cancelled? Students will be told."`

---

## 3. Status → Colour Mapping

Always use `statusInfo(entry)` from `ui.js`. Do not hard-code this mapping in pages.

| `status` | Colour | Badge text |
|---|---|---|
| `scheduled` | White | *(none: a normal class)* |
| `pending` | **Amber** | `New time coming` |
| `cancelled` | **Red**, struck through | `Cancelled` |
| `moved_away` | **Grey**, struck through | `Moved to Fri 10:00` |
| `moved_here` | **Green** | `Moved here from Mon 09:00` |
| `room_changed` | **Blue** | `Room changed: LAB-2 → LAB-4` |

---

## 4. Page-by-Page Feature Specs

Priority: **MUST** = demo-critical · **SHOULD** = expected.

### 4.1 Top bar: `src/lib/layout.js` — MUST

Shared by all pages; build once. Insert at the existing `TODO (Apoorvi)` markers.

**A. Search box**
- Trigger once input length is ≥ 2 characters. Debounce 300 ms after the last keystroke.
- Call `search(text)`. Render a dropdown where each result shows its `label` and `sublabel`.
- On click, route by `result.type`:

| `type` | Navigate to |
|---|---|
| `faculty` | `timetable.html?faculty={id}` |
| `batch` | `timetable.html?batch={id}` |
| `space` | `timetable.html?room={id}` |
| `subject` | `timetable.html?batch={id}`, where `{id}` is the first batch of the subject's semester (resolve via `listBatches()`) |

**B. Notifications panel**
- Clicking the bell opens a panel populated by `listNotifications()`.
- Unread items are bold.
- Clicking an item calls `markNotificationRead(id)`, then navigates to the target in the item's `ref`.
- A "Mark all as read" button calls `markAllNotificationsRead()`, then `refreshBell()`.

**C. Live updates** (nice-to-have)
```js
subscribeToEvents({ notification: (n) => { showToast(n.title); refreshBell(); } });
```
To test in mock mode, run `mockEmit('notification')` in the browser console.

**Acceptance**
- [ ] Typing `ma` shows 6 results (Dr. Manish Tiwari, Machine Learning, …). Clicking one opens the correct timetable.
- [ ] Logged in as Riya, the bell panel lists 6 notifications. After "Mark all as read" the red unread count disappears.

---

### 4.2 Faculty: My week — `faculty.html` — MUST

Roles: `['faculty', 'hod']`

**A. Week grid**
- `getMyTimetable({ weekStart })` → `renderTimetableGrid(box, week, calendar, { show: 'batch' })`.
- Previous/next week arrows, same as `student.js`.

**B. "Mark leave" button** (`btn-primary`, top-right) opens a `<dialog>`:

| Field | Control |
|---|---|
| From | date input |
| To | date input |
| Scope | radio: **Whole day** \| **Only some periods**. When "some" is selected, show checkboxes P1–P7 |
| Reason | text input |
| Actions | `Cancel` (`btn-secondary`), `Save leave` (`btn-primary`) |

On save:
```js
const result = await createUnavailability({
  kind: 'faculty_leave',
  target_id: user.faculty_id,
  start_date: from.value,                    // "2026-10-29"
  end_date: to.value,
  periods: wholeDay ? null : selectedPeriods, // e.g. [2, 3]; null = whole day
  reason: reason.value,
});
// result: { unavailability, affected, proposals }
```
- **Success:** show `"Saved. {result.affected.length} classes were cancelled and sent to the HOD for new slots"`, followed by a list of `result.affected`.
- **`VALIDATION` error:** render each `err.fields[i].message` in red under its field (e.g. `{ field: 'reason', message: 'Please give a short reason' }`).

**C. "My leave" list**
- Data: `listUnavailability()`. One `card` per item showing the dates, the reason, and `"{affected_count} classes affected, {pending_count} waiting for the HOD"`.
- Show the `Withdraw` button (`btn-danger`) **only while `pending_count === affected_count`** (nothing decided yet).
- Withdraw flow: `confirm()` → `withdrawUnavailability(id)` → toast → reload the list.

**Acceptance** (as Dr. Anil Sharma)
- [ ] The week shows the Thursday classes in amber.
- [ ] "Save leave" shows the 3 cancelled classes. Saving with an empty reason shows an error under the Reason field.
- [ ] The leave list shows the Thursday leave, and Withdraw asks for confirmation first.

---

### 4.3 HOD: Dashboard — `hod.html` — MUST

Roles: `['hod']`

**A. Header:** a greeting using `user.name` (e.g. "Good morning, Dr. Jain") as `page-title`, with the primary action top-right (see D).

**B. Stat cards** (4 cards) from `getAnalyticsSummary()`:

| Card label | Field | Notes |
|---|---|---|
| Classes this week | `classes_total` | |
| Waiting for you | `pending_approvals` | Amber highlight; links to `approvals.html` |
| Moved | `moved` | |
| Cancelled | `cancelled` | |

**C. "Waiting for you" list**
- Data: `listProposals({ status: 'pending' })`.
- Each row shows: subject, batch, original day and time, reason.
- Each row also shows `"Suggested: {day} {time}, {room}"`, taken from the option where `option.rank === proposal.recommended_rank`.
- A `Review` button opens `approvals.html?id={proposal.id}`.

**D. "Mark absence / close a room" button** (`btn-primary`)
- Opens the same dialog as §4.2.B, with one extra **What** selector that sets `kind` and fills a target dropdown:

| What | `kind` | Target dropdown source |
|---|---|---|
| Teacher on leave | `faculty_leave` | `listFaculty()` |
| Room closed | `room_closure` | `listSpaces()` |
| Batch event | `batch_event` | `listBatches()` |

- `target_id` is the selected dropdown id. Submit with `createUnavailability(...)`.

**E. Latest activity**
- Data: `listActivity({ limit: 5 })` (the 5 newest rows).
- Include a link to `reports.html`.

**Acceptance** (as Dr. Rakesh Jain)
- [ ] The cards show `144 / 3 / 3 / 1`.
- [ ] 3 pending classes are listed, each with its suggestion.
- [ ] A student or faculty user opening `hod.html` is redirected (already handled by `requireLogin`).

---

### 4.4 HOD: Approvals — `approvals.html` — MUST (demo-critical; highest polish)

Roles: `['hod']`

**Layout:** two panes, with the proposal list on the left and the selected proposal on the right. The panes stack vertically on mobile.

**A. Left pane: proposal list**
- Tabs: `Waiting` (shows a count) | `Approved` | `Rejected`, each mapped to `listProposals({ status: 'pending' | 'approved' | 'rejected' })`.
- Each item shows: subject, batch, original time.

**B. Selection logic**
- If `new URLSearchParams(location.search).get('id')` is set, open that proposal (`getProposal(id)`).
- Otherwise open the first pending proposal.

**C. Right pane: proposal detail**
- **Top:** the class as planned (`original`: subject · batch · day date time · room) and the `reason`.
- **Option cards** (one per option, with the recommended option first):
  - Day, date, time, and room.
  - A `Recommended` badge on the option where `rank === recommended_rank`.
  - A score bar showing `score` out of 100.
  - "Why this slot?" chips, one per `breakdown[].label`.
  - `warnings[]` rendered in amber.
  - An `Approve this slot` button. Under the one-primary rule, make it `btn-primary` on the recommended card only.
- **Footer actions:** `Pick another slot` (`btn-secondary`) and `Keep cancelled` (`btn-danger`).

**D. Actions**

| Action | Flow |
|---|---|
| Approve option | `approveProposal(p.id, { version: p.version, option_rank: opt.rank })` → success toast → refresh list → open the next pending proposal |
| Pick another slot | Inline form with date, period, and room (`listSpaces()`). On **every change**, call `checkProposalSlot(p.id, { date, period, space_id })` → returns `{ ok, clashes, score }`. If `ok`, show `"✓ Free, score {score}"`; otherwise show `clashes` in red. Enable Approve only when `ok`, then send `approveProposal(p.id, { version: p.version, custom: { date, period, space_id } })` |
| Keep cancelled (reject) | Prompt for an optional note → `confirm()` → `rejectProposal(p.id, { version: p.version, note })` → success toast |

**E. Errors (all actions)**
- `STALE`: tell the user someone else changed this proposal, then reload it.
- `CLASH`: the slot is now taken; render `err.clashes`.

**Acceptance** (proposal 5 in the mock)
- [ ] The recommended option is first. Approving it shows a toast and advances to the next waiting proposal.
- [ ] "Pick another slot" with Fri 30 Oct, period 1, R-103 shows 3 clashes in red.
- [ ] "Keep cancelled" asks for confirmation, then shows a toast.
- Note: the mock does not persist. After a reload, an approved proposal shows as pending again. This is expected.

---

## 5. API Reference (`src/api.js`)

Call the **function**. The HTTP route is listed for reference only and must never be called directly.

| Function | HTTP (reference) | Returns | Used by |
|---|---|---|---|
| `login(email, password)` / `logout()` / `getCurrentUser()` | `POST /api/auth/login` | User `{ id, name, role, faculty_id, batch_id }` | Login, top bar |
| `getCalendar()` | `GET /api/calendar` | Days, period times, lunch, `today`, `now_period`, `current_week_start` | Every grid, Rooms |
| `listFaculty()` | `GET /api/faculty` | `Faculty[]` | Dropdowns |
| `listBatches()` | `GET /api/batches` | `Batch[]` | Dropdowns, search (subject → batch) |
| `listSubjects()` | `GET /api/subjects` | `Subject[]` | Dropdowns |
| `listSpaces()` | `GET /api/spaces` | `Space[]` (rooms + labs) | Dropdowns |
| `getMyTimetable({ weekStart })` | `GET /api/timetable/me` | Logged-in user's `TimetableWeek` | Student, Faculty |
| `getTimetable({ weekStart, batchId \| facultyId \| spaceId })` | `GET /api/timetable` | Any `TimetableWeek` (max one id) | Timetables |
| `getRoomAvailability({ date, period })` | `GET /api/availability/rooms` | Free/busy/closed per room | Rooms |
| `search(text)` | `GET /api/search?q=` | `[{ type, id, label, sublabel }]` | Top bar |
| `createUnavailability(body)` | `POST /api/unavailability` | `{ unavailability, affected, proposals }` | Faculty, HOD |
| `listUnavailability()` | `GET /api/unavailability` | Leave list | Faculty |
| `withdrawUnavailability(id)` | `DELETE /api/unavailability/{id}` | Withdrawn record (only while nothing decided) | Faculty |
| `listProposals({ status })` | `GET /api/proposals` | `Proposal[]`, `status`: `pending` \| `approved` \| `rejected` | HOD, Approvals |
| `getProposal(id)` | `GET /api/proposals/{id}` | `Proposal` with options | Approvals |
| `checkProposalSlot(id, { date, period, space_id })` | `POST /api/proposals/{id}/check` | `{ ok, clashes, score }` | Approvals |
| `approveProposal(id, { version, option_rank })` or `(id, { version, custom: { date, period, space_id } })` | `POST /api/proposals/{id}/approve` | `Proposal` | Approvals |
| `rejectProposal(id, { version, note })` | `POST /api/proposals/{id}/reject` | `Proposal` (class stays cancelled) | Approvals |
| `listNotifications()` | `GET /api/notifications` | `{ items, total, unread }` | Top bar |
| `markNotificationRead(id)` | `POST /api/notifications/{id}/read` | `Notification` | Top bar |
| `markAllNotificationsRead()` | `POST /api/notifications/read-all` | `{ updated }` | Top bar |
| `subscribeToEvents(handlers)` | `GET /api/notifications/stream` (SSE) | Unsubscribe fn; handlers: `notification`, `timetable_changed`, `proposal_updated` | Top bar |
| `mockEmit(type)` | — (mock only) | Fires a fake event | Testing |
| `getAnalyticsSummary()` | `GET /api/analytics/summary` | Dashboard card numbers | HOD |
| `getAnalyticsTrends()` | `GET /api/analytics/trends` | `{ weeks, room_utilisation, heatmap, by_faculty }` | Reports |
| `listActivity({ limit, offset })` | `GET /api/activity` | `{ items, total }` (newest first) | HOD, Reports |

**Out of scope** (What-if and Settings pages, owned by Vedant): `runWhatIf`, `getRankingSettings`, `updateRankingSettings`, `importTimetable`, `resetDemo`, `listOutbox`.

---

## 6. Test Fixtures

**Demo accounts** (password `demo1234`)

| Role | Email | Use for |
|---|---|---|
| HOD | `rakesh.jain@example.com` | Dashboard, Approvals, Reports |
| Faculty | `anil.sharma@example.com` | My week, Mark leave (on leave Thursday) |
| Student | `riya.patel@example.com` | My timetable (two Thursday classes cancelled) |

**Mock behaviour**
- 250 ms artificial latency on every call.
- Timetable data exists only for the week starting `2026-10-26`; other weeks return empty, and the page must render the empty state.
- Room availability exists only for Thu 29 Oct and is returned for any date.
- Mutations are not persisted; a reload resets state.
- `createUnavailability` always returns the Dr. Sharma example.
