// The demo "server". In mock mode src/api.js asks this file instead of the real backend.
//
// It reads the timetables typed in from the department's signed sheets (public/mock/timetables.json)
// and does what the real server would do with them: lists batches, teachers, rooms and each week's
// classes, finds clashes, records leave and room closures, suggests new slots, keeps the HOD's
// decisions, and works out notifications, the activity log and the report numbers.
//
// The demo's starting story is in public/mock/demo.json. Whatever people then do (mark leave,
// approve, ...) is kept as a list of events in this browser, so it is still there after a reload;
// "Reset demo data" on the Settings page empties that list. The same file runs in Node for
// scripts/mock-snapshot.mjs, which writes the example JSON files from it.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_OF_INDEX = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_WORD = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDINAL = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', 5: 'Fifth', 6: 'Sixth', 7: 'Seventh', 8: 'Eighth', 9: 'Ninth', 10: 'Tenth' };
// The hours used to mark part of a day ("only some periods") and by the Rooms page: 9:00 to 19:00.
const HOURS = Array.from({ length: 10 }, (_, i) => ({ period: i + 1, start: `${String(9 + i).padStart(2, '0')}:00`, end: `${String(10 + i).padStart(2, '0')}:00` }));
// A class takes up its slot only in these states (a cancelled or moved-away class leaves it free).
const ACTIVE = new Set(['scheduled', 'moved_here', 'room_changed']);
// Room use is measured against Monday to Saturday, 9:00 to 17:00.
const OPEN_HOURS_PER_WEEK = 48;
const IMPORTED_AT = '2026-07-20T10:00:00+05:30';

// ------------------------------------------------------------------ small helpers (dates are "2026-10-29", times "09:00")

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const overlap = (a, b) => minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
const clone = (value) => JSON.parse(JSON.stringify(value));

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayOf = (date) => DAY_OF_INDEX[new Date(`${date}T00:00:00Z`).getUTCDay()];
const mondayOf = (date) => addDays(date, -DAYS.indexOf(dayOf(date)));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const nice = (date) => `${dayOf(date)} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const msAt = (date, time) => Date.parse(`${date}T${time}:00+05:30`);
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
/** A moment as the server writes it, in Indian time: "2026-10-28T10:30:00+05:30". */
const stamp = (ms) => `${new Date(ms + 330 * 60000).toISOString().slice(0, 19)}+05:30`;
const when = (from, to) => (from === to ? nice(from) : `${nice(from)} to ${nice(to)}`);
const span = (periods) => (periods ? periods.map((h) => `${HOURS[h - 1].start}-${HOURS[h - 1].end}`).join(', ') : 'full day');
const byTime = (a, b) => a.date.localeCompare(b.date) || minutes(a.start) - minutes(b.start) || a.batch.code.localeCompare(b.batch.code) || a.subject.code.localeCompare(b.subject.code);

function groupByDate(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

/** "Dr. Govind Maheshwari" -> "govind.maheshwari@example.com" (demo addresses, never real ones). */
function emailFor(name) {
  const words = name.split(' ').filter((w) => w && !w.endsWith('.') && !/^(dr|mr|ms|mrs)$/i.test(w));
  return `${words.join('.').toLowerCase()}@example.com`;
}

// ------------------------------------------------------------------ reading the sheets

// One grid cell as written on a sheet: "DS6A-107", "DS6A-102(Lab)", "DS6A-404 : HR", "DS6A-501 AB(Lab)",
// "DS5A-521/523 : VS/HG" (two electives at once) or "DS5B523:RS-L" (-L = the lab part).
const CELL = /^([A-Z0-9]{4})-?\s*(\d{3}(?:\/\d{3})*)\s*(?::\s*|\s+)?([A-Za-z]+(?:\/[A-Za-z]+)*)?$/;

function readCell(text) {
  let rest = text.trim();
  let lab = false;
  const labMark = rest.match(/\s*\(lab\)$/i);
  if (labMark) {
    lab = true;
    rest = rest.slice(0, labMark.index);
  } else if (rest.endsWith('-L')) {
    lab = true;
    rest = rest.slice(0, -2);
  }
  const m = rest.trim().match(CELL);
  if (!m) throw new Error(`timetables.json: cannot read the cell "${text}"`);
  return { codes: m[2].split('/').map((n) => `${m[1]}-${n}`), initials: m[3] ? m[3].split('/') : [], lab };
}

/** Turns timetables.json into teachers, batches, subjects, rooms and weekly sessions. Throws on any typo. */
export function buildCatalog(source) {
  const teachers = source.teachers.map((t) => ({ id: t.id, code: t.code, name: t.name, email: emailFor(t.name), is_hod: Boolean(t.is_hod), note: t.note ?? null }));
  const byName = new Map(teachers.map((t) => [t.name, t]));
  const teacher = (name, where) => {
    if (!name) return null;
    const t = byName.get(name);
    if (!t) throw new Error(`timetables.json: unknown teacher "${name}" (${where})`);
    return t;
  };
  const spaces = [];
  const batches = [];
  const subjects = [];
  const sessions = [];
  const review = teachers.filter((t) => t.note).map((t) => ({ batch: null, text: `${t.name}: ${t.note}` }));

  for (const b of source.batches) {
    let space = null;
    if (b.room) {
      space = spaces.find((s) => s.code === b.room.code);
      if (!space) {
        space = { id: spaces.length + 1, code: b.room.code, name: b.room.name, kind: 'room', capacity: null, floor: null };
        spaces.push(space);
      }
    }
    // Columns become numbered teaching slots (P1, P2, ...) and breaks. A break the sheet does not name
    // (an empty, unlabelled column) is simply left out, rather than given a made-up label.
    const slots = [];
    const breaks = [];
    const columnPeriod = b.columns.map((column) => {
      const [start, end] = column.split('-');
      if (b.breaks && column in b.breaks) {
        if (b.breaks[column]) breaks.push({ start, end, label: b.breaks[column] });
        return null;
      }
      slots.push({ period: slots.length + 1, start, end });
      return slots.length;
    });
    const classTeacher = teacher(b.class_teacher, `${b.code} class teacher`);
    const batch = {
      id: b.id,
      code: b.code,
      name: `${b.program}, ${ORDINAL[b.semester] ?? b.semester} Semester`,
      program: b.program,
      school: source.school,
      semester: b.semester,
      section: null,
      size: null,
      home_space_id: space?.id ?? null,
      class_teacher: classTeacher ? { id: classTeacher.id, name: classTeacher.name } : null,
      wef: b.wef,
      days: b.days,
      slots,
      breaks,
      sheet: b.sheet,
      // Classes the app moved away from the sheet's times to remove a clash.
      changes: [...(b.changes ?? [])],
      review: [...(b.review ?? [])],
    };
    batches.push(batch);

    const course = new Map();
    for (const c of b.courses) {
      const subject = {
        id: subjects.length + 1,
        code: c.code ?? c.title,
        name: c.title,
        kind: c.category === 'project' || c.category === 'viva' ? c.category : 'theory',
        semester: b.semester,
        batch_id: b.id,
        batch_code: b.code,
        credits: c.credits,
        category: c.category,
        faculty_id: teacher(c.teacher, `${b.code} ${c.title}`)?.id ?? null,
        note: c.note ?? null,
      };
      subjects.push(subject);
      if (c.code) course.set(c.code, subject);
    }
    const labs = new Map();
    const subjectFor = (code, lab, where) => {
      const base = course.get(code);
      if (!base) throw new Error(`timetables.json: ${where} uses ${code}, which is not in ${b.code}'s course list`);
      if (!lab) return base;
      if (!labs.has(code)) {
        const s = { ...base, id: subjects.length + 1, code: `${base.code} (Lab)`, name: `${base.name} (Lab)`, kind: 'lab' };
        subjects.push(s);
        labs.set(code, s);
      }
      return labs.get(code);
    };

    for (const [day, cells] of Object.entries(b.grid)) {
      if (!b.days.includes(day)) throw new Error(`timetables.json: ${b.code} has a ${day} row but ${day} is not in its days`);
      if (cells.length !== b.columns.length) throw new Error(`timetables.json: ${b.code} ${day} has ${cells.length} cells for ${b.columns.length} columns`);
      cells.forEach((cell, column) => {
        if (!cell) return;
        const where = `${b.code} ${day} ${b.columns[column]}`;
        const period = columnPeriod[column];
        if (period === null) throw new Error(`timetables.json: ${where} has a class in a break`);
        const { codes, initials, lab } = readCell(cell);
        const group = codes.length > 1 ? `${b.code} ${codes.join('/')}` : null;
        codes.forEach((raw, i) => {
          const code = b.aliases?.[raw] ?? raw;
          const subject = subjectFor(code, lab, where);
          const mark = initials[i] ?? initials[0];
          let who = subject.faculty_id ? teachers.find((t) => t.id === subject.faculty_id) : null;
          if (mark) {
            who = teacher(b.initials?.[mark.toUpperCase()], `${where}: initials ${mark} are not in ${b.code}'s initials list`);
            if (subject.faculty_id && who.id !== subject.faculty_id) {
              batch.review.push(`${code} on ${day} is marked ${mark} (${who.name}) but the course list gives another teacher.`);
            }
          }
          sessions.push({
            id: sessions.length + 1,
            batch_id: b.id,
            day,
            period,
            start: slots[period - 1].start,
            end: slots[period - 1].end,
            subject_id: subject.id,
            faculty_id: who?.id ?? null,
            space_id: space?.id ?? null,
            elective_group: group,
          });
        });
      });
    }
    for (const text of batch.review) review.push({ batch: { id: batch.id, code: batch.code }, text });
  }

  // What the faculty list shows about each teacher, worked out from their classes.
  for (const t of teachers) {
    const own = sessions.filter((s) => s.faculty_id === t.id);
    const led = batches.filter((b) => b.class_teacher?.id === t.id).map((b) => b.code);
    t.designation = t.is_hod ? 'Head of Department' : led.length ? `Class teacher, ${led.join(', ')}` : 'Faculty';
    t.weekly_load = own.length;
    t.preferred_periods = HOURS.filter((h) => own.some((s) => overlap(s, h))).map((h) => h.period);
    t.batches = [...new Set(own.map((s) => batches.find((b) => b.id === s.batch_id).code))];
  }
  return { teachers, batches, subjects, spaces, sessions, review, school: source.school, university: source.university, head: source.head };
}

// ------------------------------------------------------------------ the engine

/**
 * source  = timetables.json, demo = demo.json, ranking = settings_ranking.json (the default weights)
 * saved   = the events kept from earlier visits, onSave(events) is called whenever they change
 * makeError(status, code, detail, body) builds the error that is thrown (api.js passes its ApiError)
 */
export function createEngine({ source, demo, ranking, saved = [], onSave = () => {}, makeError }) {
  const cat = buildCatalog(source);
  const fail = (status, code, detail, body = null) => {
    throw makeError(status, code, detail, body);
  };
  const teacherById = new Map(cat.teachers.map((t) => [t.id, t]));
  const batchById = new Map(cat.batches.map((b) => [b.id, b]));
  const spaceById = new Map(cat.spaces.map((s) => [s.id, s]));
  const subjectById = new Map(cat.subjects.map((s) => [s.id, s]));
  const sessionsByDay = new Map(DAYS.map((d) => [d, cat.sessions.filter((s) => s.day === d)]));
  // The start times each teacher usually teaches at ("Teacher's preferred hours" in the ranking).
  const usualStarts = new Map(cat.teachers.map((t) => [t.id, new Set(cat.sessions.filter((s) => s.faculty_id === t.id).map((s) => s.start))]));
  const hod = cat.teachers.find((t) => t.is_hod);
  const students = demo.students.map((s) => ({ ...s, batch_id: cat.batches.find((b) => b.code === s.batch)?.id ?? null }));
  const NOW = Date.parse(demo.now);
  const TODAY = demo.now.slice(0, 10);
  const defaults = { weights: ranking.weights, k: ranking.k, max_batch_classes_per_day: ranking.max_batch_classes_per_day, min_notice_hours: ranking.min_notice_hours, search_weeks: ranking.search_weeks };
  const RULE_LABEL = Object.fromEntries((ranking.rules ?? []).map((r) => [r.rule, r.label]));

  const teacherRef = (id) => (id ? { id, code: teacherById.get(id).code, name: teacherById.get(id).name } : null);
  const spaceRef = (id) => (id ? { id, code: spaceById.get(id).code, kind: spaceById.get(id).kind } : null);
  const personFor = (name) => {
    const t = cat.teachers.find((x) => x.name === name);
    if (!t) throw new Error(`demo.json: unknown person "${name}"`);
    return { id: t.id, name: t.name, role: t.is_hod ? 'hod' : 'faculty', faculty_id: t.id, batch_id: null };
  };

  let state;
  let cache = new Map();
  let userEvents = Array.isArray(saved) ? [...saved] : [];
  let lastAt = NOW;

  function changed() {
    cache = new Map();
  }
  function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  }

  // ---------------------------------------------------------------- events: the demo story, then what people did

  function seedEvent(e) {
    const user = personFor(e.by);
    if (e.type === 'decision') {
      return { type: 'decision', at: e.at, user, proposal_id: e.proposal, action: e.action, option_rank: e.option_rank, custom: e.custom ?? null, note: e.note ?? null, version: null };
    }
    const target =
      e.kind === 'faculty_leave'
        ? personFor(e.target).id
        : e.kind === 'room_closure'
          ? cat.spaces.find((s) => s.code === e.target)?.id
          : cat.batches.find((b) => b.code === e.target)?.id;
    return { type: 'unavailability', at: e.at, user, body: { kind: e.kind, target_id: target, start_date: e.start_date, end_date: e.end_date, periods: e.periods, reason: e.reason } };
  }

  function apply(ev) {
    if (ev.type === 'unavailability') return addUnavailability(ev.body, ev.user, ev.at);
    if (ev.type === 'decision') return decide(ev);
    if (ev.type === 'withdraw') return withdraw(ev.id, ev.user, ev.at);
    if (ev.type === 'settings') return changeSettings(ev.patch, ev.user, ev.at);
    if (ev.type === 'read') {
      ev.ids.forEach((id) => state.reads.add(id));
      return null;
    }
    throw new Error(`Unknown demo event ${ev.type}`);
  }

  function replay() {
    state = { unavailability: [], proposals: [], reads: new Set(), settings: clone(defaults), settingsLog: [] };
    changed();
    demo.events.map(seedEvent).forEach(apply);
    lastAt = NOW;
    const kept = [];
    for (const ev of userEvents) {
      try {
        apply(ev);
        kept.push(ev);
        if (ev.at) lastAt = Math.max(lastAt, Date.parse(ev.at));
      } catch {
        // A change saved by an older version no longer fits the data: leave it out.
      }
    }
    if (kept.length !== userEvents.length) {
      userEvents = kept;
      onSave(userEvents);
    }
  }

  /** Runs a new event, and keeps it (in this browser) only if it worked. */
  function record(ev) {
    const result = apply(ev);
    userEvents.push(ev);
    if (ev.at) lastAt = Math.max(lastAt, Date.parse(ev.at));
    onSave(userEvents);
    return result;
  }

  /** The demo's clock stands still at demo.json's "now"; each new action is a minute after the last one. */
  const nextAt = () => stamp(lastAt + 60000);
  const userRef = (user) => ({ id: user.id, name: user.name, role: user.role, faculty_id: user.faculty_id ?? null, batch_id: user.batch_id ?? null });

  // ---------------------------------------------------------------- a week's classes, with every change applied

  function baseEntry(s, date) {
    const subject = subjectById.get(s.subject_id);
    const batch = batchById.get(s.batch_id);
    return {
      key: `${s.id}-${date}`,
      session_id: s.id,
      date,
      day: s.day,
      period: s.period,
      start: s.start,
      end: s.end,
      batch: { id: batch.id, code: batch.code },
      subject: { id: subject.id, code: subject.code, name: subject.name, kind: subject.kind },
      faculty: teacherRef(s.faculty_id),
      space: spaceRef(s.space_id),
      status: 'scheduled',
      reason: null,
      proposal_id: null,
      moved_to: null,
      moved_from: null,
      elective_group: s.elective_group,
    };
  }
  const slotOf = (e) => ({ date: e.date, day: e.day, period: e.period, start: e.start, end: e.end, space: e.space });

  /** Every class from `from` to `to` (inclusive), after leave, closures and decisions. Cached until something changes. */
  function entriesFor(from, to) {
    return cached(`entries|${from}|${to}`, () => {
      // Classes can be moved up to a few weeks, so look a little wider than asked.
      const lo = addDays(from, -28);
      const hi = addDays(to, 28);
      const map = new Map();
      for (let d = lo; d <= hi; d = addDays(d, 1)) {
        for (const s of sessionsByDay.get(dayOf(d))) {
          if (d < batchById.get(s.batch_id).wef) continue;
          const e = baseEntry(s, d);
          map.set(e.key, e);
        }
      }
      for (const p of state.proposals) {
        if (p.status === 'withdrawn') continue;
        const e = map.get(p.original.entry_key);
        if (!e) continue;
        e.reason = p.reason;
        e.proposal_id = p.id;
        if (p.status === 'pending') e.status = 'pending';
        else if (p.status === 'rejected') e.status = 'cancelled';
        else if (p.status === 'approved') {
          const slot = p.decision.slot;
          const from = slotOf(e);
          if (slot.date === e.date && slot.start === e.start && slot.end === e.end) {
            // Same time, another room.
            e.status = 'room_changed';
            e.moved_from = from;
            e.space = slot.space;
          } else {
            e.status = 'moved_away';
            e.moved_to = slot;
            map.set(`${e.key}-new`, {
              ...e,
              key: `${e.key}-new`,
              date: slot.date,
              day: slot.day,
              period: slot.period,
              start: slot.start,
              end: slot.end,
              space: slot.space,
              status: 'moved_here',
              moved_to: null,
              moved_from: from,
            });
          }
        }
      }
      return [...map.values()].filter((e) => e.date >= from && e.date <= to).sort(byTime);
    });
  }

  // ---------------------------------------------------------------- leave, closures and batch events

  const covers = (u, date, time) =>
    u.status === 'active' && date >= u.start_date && date <= u.end_date && (!u.periods || u.periods.some((h) => overlap(HOURS[h - 1], time)));

  /** Why a slot cannot be used: the batch, teacher or room already has a class, or is away or closed. */
  function slotProblems({ date, start, end, batchId, facultyId, spaceId, ignoreKey, group }, dayEntries) {
    const time = { start, end };
    const problems = [];
    const others = dayEntries.filter((e) => ACTIVE.has(e.status) && e.key !== ignoreKey && overlap(e, time));
    const batch = batchById.get(batchId);
    for (const e of others) {
      if (e.batch.id === batchId && !(group && e.elective_group === group)) {
        problems.push({ resource: 'batch', message: `${batch.code} already has ${e.subject.code} at ${e.start}-${e.end}` });
      }
    }
    if (facultyId) {
      const name = teacherById.get(facultyId).name;
      for (const e of others) {
        if (e.faculty?.id === facultyId) problems.push({ resource: 'faculty', message: `${name} is teaching ${e.subject.code} to ${e.batch.code} at ${e.start}-${e.end}` });
      }
    }
    if (spaceId) {
      const code = spaceById.get(spaceId).code;
      for (const e of others) {
        if (e.space?.id === spaceId) problems.push({ resource: 'space', message: `${code} is used by ${e.batch.code} (${e.subject.code}) at ${e.start}-${e.end}` });
      }
    }
    for (const u of state.unavailability) {
      if (!covers(u, date, time)) continue;
      if (u.kind === 'faculty_leave' && u.target.id === facultyId) problems.push({ resource: 'faculty', message: `${u.target.label} is on leave (${u.reason})` });
      if (u.kind === 'room_closure' && u.target.id === spaceId) problems.push({ resource: 'space', message: `${u.target.label} is closed (${u.reason})` });
      if (u.kind === 'batch_event' && u.target.id === batchId) problems.push({ resource: 'batch', message: `${u.target.label} is away (${u.reason})` });
    }
    return problems;
  }

  /** How good a new slot is, with the same six rules (and weights) as the Settings page. */
  function scoreSlot(date, slot, room, e, dayEntries) {
    const w = state.settings.weights;
    const parts = [];
    if (date === e.date && slot.start === e.start && slot.end === e.end) parts.push(['same_time', w.same_time]);
    if (mondayOf(date) === mondayOf(e.date)) parts.push(['same_week', w.same_week]);
    if ((room?.id ?? null) === (e.space?.id ?? null)) parts.push(['same_room', w.same_room]);
    if (e.faculty && usualStarts.get(e.faculty.id)?.has(slot.start)) parts.push(['preferred_hours', w.preferred_hours]);
    const load = dayEntries.filter((x) => ACTIVE.has(x.status) && x.batch.id === e.batch.id && x.key !== e.key).length + 1;
    if (load <= state.settings.max_batch_classes_per_day) parts.push(['batch_load', w.batch_load]);
    const soon = Math.max(0, 1 - Math.abs(daysBetween(e.date, date)) / 7);
    if (soon > 0) parts.push(['sooner', Math.round(w.sooner * soon * 100) / 100]);
    const max = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const total = parts.reduce((sum, [, points]) => sum + points, 0);
    return {
      score: Math.round((total / max) * 100),
      breakdown: parts.filter(([, points]) => points > 0).map(([rule, points]) => ({ rule, label: RULE_LABEL[rule] ?? rule, points })),
    };
  }

  /** The best free slots for a cancelled class, across every batch, teacher and room. */
  function findOptions(e, atStamp) {
    const s = state.settings;
    const batch = batchById.get(e.batch.id);
    const from = mondayOf(e.date);
    const to = addDays(from, 7 * s.search_weeks - 1);
    const byDate = groupByDate(entriesFor(from, to));
    const earliest = Date.parse(atStamp) + s.min_notice_hours * 3600000;
    const last = batch.slots[batch.slots.length - 1];
    const teachingDays = new Set(cat.sessions.filter((x) => x.batch_id === batch.id).map((x) => x.day));
    const found = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      // Only days the batch really has classes on (an empty Saturday row on a sheet is not a teaching day).
      // "Pick another slot" can still choose any day of the sheet.
      if (!teachingDays.has(dayOf(d)) || d < batch.wef) continue;
      const dayEntries = byDate.get(d) ?? [];
      for (const slot of batch.slots) {
        if (msAt(d, slot.start) < earliest) continue;
        const sameTime = d === e.date && slot.start === e.start && slot.end === e.end;
        const rooms = e.space ? [spaceById.get(e.space.id), ...cat.spaces.filter((r) => r.id !== e.space.id)] : [null];
        for (const room of rooms) {
          if (sameTime && (room?.id ?? null) === (e.space?.id ?? null)) continue;
          const where = { date: d, start: slot.start, end: slot.end, batchId: batch.id, facultyId: e.faculty?.id, spaceId: room?.id, ignoreKey: e.key, group: e.elective_group };
          if (slotProblems(where, dayEntries).length) continue;
          found.push({
            date: d,
            day: dayOf(d),
            period: slot.period,
            start: slot.start,
            end: slot.end,
            space: room ? spaceRef(room.id) : null,
            ...scoreSlot(d, slot, room, e, dayEntries),
            warnings: slot === last ? ['Last period of the day'] : [],
          });
        }
      }
    }
    const ownRoom = (o) => ((o.space?.id ?? null) === (e.space?.id ?? null) ? 0 : 1);
    found.sort(
      (a, b) =>
        b.score - a.score ||
        a.warnings.length - b.warnings.length ||
        a.date.localeCompare(b.date) ||
        minutes(a.start) - minutes(b.start) ||
        ownRoom(a) - ownRoom(b) ||
        (a.space?.id ?? 0) - (b.space?.id ?? 0),
    );
    // Keep the best room for each time, so the suggestions offer different times, not one time in many rooms.
    const seen = new Set();
    const best = found.filter((o) => {
      const key = `${o.date}|${o.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return best.slice(0, s.k).map((o, i) => ({ rank: i + 1, ...o }));
  }

  const originalOf = (e) => ({
    session_id: e.session_id,
    date: e.date,
    day: e.day,
    period: e.period,
    start: e.start,
    end: e.end,
    batch: e.batch,
    subject: e.subject,
    faculty: e.faculty,
    space: e.space,
    entry_key: e.key,
    elective_group: e.elective_group,
  });
  const asEntry = (o) => ({ ...o, key: o.entry_key });
  const reasonFor = (u) => `${u.target.label} ${{ faculty_leave: 'on leave', room_closure: 'closed', batch_event: 'away' }[u.kind]}`;
  const proposalsOf = (u) => state.proposals.filter((p) => p.unavailability_id === u.id && p.status !== 'withdrawn');
  const withCounts = (u) => {
    const ps = proposalsOf(u);
    return { ...u, affected_count: ps.length, pending_count: ps.filter((p) => p.status === 'pending').length };
  };

  function targetOf(kind, id) {
    if (kind === 'faculty_leave') return teacherById.has(id) ? { type: 'faculty', id, label: teacherById.get(id).name } : null;
    if (kind === 'room_closure') return spaceById.has(id) ? { type: 'space', id, label: spaceById.get(id).code } : null;
    if (kind === 'batch_event') return batchById.has(id) ? { type: 'batch', id, label: batchById.get(id).code } : null;
    return null;
  }

  function addUnavailability(body, user, atStamp) {
    if (user.role === 'student') fail(403, 'FORBIDDEN', 'Students cannot mark leave.');
    const kind = body?.kind;
    if (user.role === 'faculty' && (kind !== 'faculty_leave' || Number(body.target_id) !== user.faculty_id)) {
      fail(403, 'FORBIDDEN', 'Teachers can only mark their own leave.');
    }
    const fields = [];
    const target = targetOf(kind, Number(body?.target_id));
    if (!['faculty_leave', 'room_closure', 'batch_event'].includes(kind)) fields.push({ field: 'kind', message: 'Please choose what happened' });
    else if (!target) fields.push({ field: 'target_id', message: 'Please choose one' });
    if (!isDate(body?.start_date)) fields.push({ field: 'start_date', message: 'Please pick the first day' });
    else if (body.start_date < atStamp.slice(0, 10)) fields.push({ field: 'start_date', message: 'Leave cannot start in the past' });
    if (!isDate(body?.end_date)) fields.push({ field: 'end_date', message: 'Please pick the last day' });
    else if (isDate(body?.start_date) && body.end_date < body.start_date) fields.push({ field: 'end_date', message: '"To" must be on or after "From"' });
    const periods = body?.periods ?? null;
    if (periods !== null && (!Array.isArray(periods) || periods.length === 0 || periods.some((h) => !HOURS[h - 1]))) {
      fields.push({ field: 'periods', message: 'Tick at least one period, or choose Whole day' });
    }
    if (!String(body?.reason ?? '').trim()) fields.push({ field: 'reason', message: 'Please give a short reason' });
    if (fields.length) fail(400, 'VALIDATION', 'Please check the highlighted fields.', { fields });

    const u = {
      id: state.unavailability.length + 1,
      kind,
      target,
      start_date: body.start_date,
      end_date: body.end_date,
      periods: periods ? [...periods].sort((a, b) => a - b) : null,
      reason: String(body.reason).trim(),
      status: 'active',
      created_by: { id: user.id, name: user.name, role: user.role },
      created_at: atStamp,
    };
    state.unavailability.push(u);
    changed();

    const hit = (e) => (kind === 'faculty_leave' ? e.faculty?.id === target.id : kind === 'room_closure' ? e.space?.id === target.id : e.batch.id === target.id);
    const affected = entriesFor(u.start_date, u.end_date).filter(
      (e) => ACTIVE.has(e.status) && hit(e) && covers(u, e.date, e) && msAt(e.date, e.start) >= Date.parse(atStamp),
    );
    const proposals = [];
    for (const e of affected) {
      const p = {
        id: state.proposals.length + 1,
        status: 'pending',
        version: 1,
        unavailability_id: u.id,
        reason: reasonFor(u),
        original: originalOf(e),
        options: [],
        recommended_rank: null,
        decision: null,
        created_at: atStamp,
      };
      state.proposals.push(p);
      changed();
      p.options = findOptions(e, atStamp);
      p.recommended_rank = p.options.length ? 1 : null;
      proposals.push(p);
    }
    const keys = new Set(affected.map((e) => e.key));
    return {
      unavailability: withCounts(u),
      affected: entriesFor(u.start_date, u.end_date).filter((e) => keys.has(e.key)),
      proposals,
    };
  }

  function withdraw(id, user, atStamp) {
    const u = state.unavailability.find((x) => x.id === Number(id));
    if (!u) fail(404, 'NOT_FOUND', `Leave record ${id} was not found.`);
    if (user.role === 'faculty' && u.created_by.id !== user.id && !(u.target.type === 'faculty' && u.target.id === user.faculty_id)) {
      fail(403, 'FORBIDDEN', 'You can only withdraw your own leave.');
    }
    if (u.status !== 'active') fail(409, 'ALREADY_DECIDED', 'This leave was already withdrawn.');
    const ps = proposalsOf(u);
    if (ps.some((p) => p.status !== 'pending')) fail(409, 'ALREADY_DECIDED', 'The HOD has already decided on some of these classes, so the leave cannot be withdrawn.');
    u.status = 'withdrawn';
    u.withdrawn_at = atStamp;
    ps.forEach((p) => {
      p.status = 'withdrawn';
    });
    changed();
    const keys = new Set(ps.map((p) => p.original.entry_key));
    return { unavailability: withCounts(u), restored: entriesFor(u.start_date, u.end_date).filter((e) => keys.has(e.key)) };
  }

  // ---------------------------------------------------------------- proposals: check, approve, keep cancelled

  function findProposal(id) {
    const p = state.proposals.find((x) => x.id === Number(id) && x.status !== 'withdrawn');
    if (!p) fail(404, 'NOT_FOUND', `Proposal ${id} was not found.`);
    return p;
  }

  function checkSlot(p, slot, atStamp) {
    const batch = batchById.get(p.original.batch.id);
    const fields = [];
    const def = batch.slots.find((x) => x.period === Number(slot?.period));
    if (!isDate(slot?.date)) fields.push({ field: 'date', message: 'Please pick a date' });
    if (!def) fields.push({ field: 'period', message: `Please pick one of ${batch.code}'s periods` });
    const roomId = slot?.space_id === null || slot?.space_id === undefined || slot?.space_id === '' ? null : Number(slot.space_id);
    if (roomId !== null && !spaceById.has(roomId)) fields.push({ field: 'space_id', message: 'Please pick a room' });
    if (fields.length) fail(400, 'VALIDATION', 'Please check the highlighted fields.', { fields });

    const clashes = [];
    if (!batch.days.includes(dayOf(slot.date))) clashes.push({ resource: 'batch', message: `${batch.code} has no classes on ${DAY_WORD[dayOf(slot.date)]}s` });
    if (slot.date < batch.wef) clashes.push({ resource: 'batch', message: `${batch.code}'s timetable starts on ${nice(batch.wef)}` });
    if (msAt(slot.date, def.start) < Date.parse(atStamp)) clashes.push({ resource: 'time', message: 'This slot has already started.' });
    const dayEntries = entriesFor(slot.date, slot.date);
    const e = asEntry(p.original);
    clashes.push(
      ...slotProblems(
        { date: slot.date, start: def.start, end: def.end, batchId: batch.id, facultyId: e.faculty?.id, spaceId: roomId, ignoreKey: e.key, group: e.elective_group },
        dayEntries,
      ),
    );
    if (clashes.length) return { ok: false, clashes, score: null, breakdown: [] };
    const room = roomId ? spaceById.get(roomId) : null;
    return {
      ok: true,
      clashes: [],
      ...scoreSlot(slot.date, def, room, e, dayEntries),
      slot: { date: slot.date, day: dayOf(slot.date), period: def.period, start: def.start, end: def.end, space: room ? spaceRef(room.id) : null },
    };
  }

  function decide(ev) {
    const p = findProposal(ev.proposal_id);
    if (ev.user.role !== 'hod') fail(403, 'FORBIDDEN', 'Only the HOD can do this.');
    if (p.status !== 'pending') fail(409, 'ALREADY_DECIDED', 'A decision was already made for this class.');
    if (ev.version !== null && ev.version !== undefined && Number(ev.version) !== p.version) {
      fail(409, 'STALE', 'Someone else changed this proposal. Reload to see the latest version.');
    }
    const by = { id: ev.user.id, name: ev.user.name, role: ev.user.role };
    let decision;
    if (ev.action === 'approved') {
      let slot;
      let rank = null;
      if (ev.custom) {
        const check = checkSlot(p, ev.custom, ev.at);
        if (!check.ok) fail(409, 'CLASH', 'This slot is no longer free.', { clashes: check.clashes });
        slot = check.slot;
      } else {
        const opt = p.options.find((o) => o.rank === Number(ev.option_rank));
        if (!opt) fail(400, 'VALIDATION', `There is no option ${ev.option_rank}.`);
        const e = asEntry(p.original);
        const problems = slotProblems(
          { date: opt.date, start: opt.start, end: opt.end, batchId: e.batch.id, facultyId: e.faculty?.id, spaceId: opt.space?.id, ignoreKey: e.key, group: e.elective_group },
          entriesFor(opt.date, opt.date),
        );
        if (problems.length) fail(409, 'CLASH', 'This slot is no longer free.', { clashes: problems });
        slot = { date: opt.date, day: opt.day, period: opt.period, start: opt.start, end: opt.end, space: opt.space };
        rank = opt.rank;
      }
      decision = { action: 'approved', by, at: ev.at, custom: Boolean(ev.custom), rank, slot, note: ev.note ?? null };
    } else if (ev.action === 'rejected') {
      decision = { action: 'rejected', by, at: ev.at, custom: false, rank: null, slot: null, note: ev.note ?? null };
    } else {
      fail(400, 'VALIDATION', 'Unknown decision.');
    }
    p.status = ev.action;
    p.version += 1;
    p.decision = decision;
    changed();
    return p;
  }

  // ---------------------------------------------------------------- settings

  function changeSettings(patch, user, atStamp) {
    if (user.role !== 'hod') fail(403, 'FORBIDDEN', 'Only the HOD can do this.');
    const fields = [];
    if (patch.weights) {
      for (const key of Object.keys(defaults.weights)) {
        if (!(key in patch.weights)) fields.push({ field: `weights.${key}`, message: 'Send all six weights together' });
        else if (!(Number(patch.weights[key]) >= 0)) fields.push({ field: `weights.${key}`, message: 'Use a number from 0 up' });
      }
    }
    for (const key of ['k', 'max_batch_classes_per_day', 'min_notice_hours', 'search_weeks']) {
      if (key in patch && !(Number(patch[key]) >= (key === 'min_notice_hours' ? 0 : 1))) fields.push({ field: key, message: 'Please check this number' });
    }
    if (fields.length) fail(400, 'VALIDATION', 'Please check the highlighted fields.', { fields });
    const next = { ...state.settings };
    for (const key of ['k', 'max_batch_classes_per_day', 'min_notice_hours', 'search_weeks']) if (key in patch) next[key] = Number(patch[key]);
    if (patch.weights) next.weights = Object.fromEntries(Object.keys(defaults.weights).map((k) => [k, Number(patch.weights[k])]));
    state.settings = next;
    state.settingsLog.push({ at: atStamp, by: { id: user.id, name: user.name, role: user.role } });
    changed();
    return settingsOut();
  }
  const settingsOut = () => ({ ...clone(state.settings), rules: ranking.rules });

  // ---------------------------------------------------------------- clashes

  /** Two classes at the same time for one teacher, one room or one batch, in a given week. */
  function weekClashes(weekStart) {
    return cached(`clashes|${weekStart}`, () => {
      const entries = entriesFor(weekStart, addDays(weekStart, 6)).filter((e) => ACTIVE.has(e.status));
      const items = new Map();
      const course = (e) => `${e.batch.code} ${e.subject.code.replace(' (Lab)', '')}`;
      // Pairs of the same two courses on the same day are joined when their times touch (a 2-hour lab is one clash).
      const add = (type, who, a, b) => {
        const [x, y] = course(a) <= course(b) ? [a, b] : [b, a];
        const key = `${type}|${who}|${a.date}|${course(x)}|${course(y)}`;
        const start = minutes(a.start) < minutes(b.start) ? a.start : b.start;
        const end = minutes(a.end) > minutes(b.end) ? a.end : b.end;
        if (!items.has(key)) items.set(key, []);
        const near = items.get(key).find((it) => minutes(start) <= minutes(it.end) && minutes(it.start) <= minutes(end));
        const item = near ?? { type, who, date: a.date, day: a.day, start, end, classes: new Map() };
        if (!near) items.get(key).push(item);
        if (minutes(start) < minutes(item.start)) item.start = start;
        if (minutes(end) > minutes(item.end)) item.end = end;
        for (const e of [x, y]) item.classes.set(e.key, e);
      };
      for (const [, list] of groupByDate(entries)) {
        for (let i = 0; i < list.length; i += 1) {
          for (let j = i + 1; j < list.length; j += 1) {
            const a = list[i];
            const b = list[j];
            if (!overlap(a, b)) continue;
            if (a.faculty && a.faculty.id === b.faculty?.id) add('faculty', a.faculty.name, a, b);
            if (a.space && a.space.id === b.space?.id && a.batch.id !== b.batch.id) add('room', a.space.code, a, b);
            if (a.batch.id === b.batch.id && !(a.elective_group && a.elective_group === b.elective_group)) add('batch', a.batch.code, a, b);
          }
        }
      }
      const out = [...items.values()].flat().map((item, i) => {
        const classes = [...item.classes.values()].sort(byTime);
        const { start, end } = item;
        const what = [...new Set(classes.map((e) => `${e.batch.code} ${e.subject.code.replace(' (Lab)', '')}`))].join(' and ');
        const message =
          item.type === 'room'
            ? `${item.who} is booked twice on ${DAY_WORD[item.day]}: ${what}`
            : `${item.who} has two classes at once on ${DAY_WORD[item.day]}: ${what}`;
        return {
          id: i + 1,
          type: item.type,
          who: item.who,
          date: item.date,
          day: item.day,
          start,
          end,
          message,
          classes: classes.map((e) => ({ key: e.key, batch: e.batch, subject: e.subject, faculty: e.faculty, space: e.space, start: e.start, end: e.end })),
        };
      });
      out.sort((a, b) => a.date.localeCompare(b.date) || minutes(a.start) - minutes(b.start) || a.who.localeCompare(b.who));
      out.forEach((c, i) => {
        c.id = i + 1;
      });
      return out;
    });
  }

  // ---------------------------------------------------------------- notifications, emails and the activity log (worked out from the events)

  function history() {
    return cached('history', () => {
      const happenings = [];
      for (const u of state.unavailability) {
        happenings.push({ at: u.created_at, order: 0, id: u.id, u });
        if (u.status === 'withdrawn') happenings.push({ at: u.withdrawn_at, order: 2, id: u.id, u, withdrawn: true });
      }
      for (const p of state.proposals) if (p.decision) happenings.push({ at: p.decision.at, order: 1, id: p.id, p });
      for (const s of state.settingsLog) happenings.push({ at: s.at, order: 3, id: 0, settings: s });
      happenings.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order - b.order || a.id - b.id);

      const notices = [];
      const activity = [];
      const total = cat.sessions.length;
      activity.push({ at: IMPORTED_AT, actor: { id: hod.id, name: hod.name, role: 'hod' }, action: 'import.completed', summary: `Timetables added for ${cat.batches.length} batches (${total} classes a week)`, ref: { type: 'import', id: null, week_start: null } });

      const unavRef = (u) => ({ type: 'unavailability', id: u.id, week_start: null });
      const ttRef = (date) => ({ type: 'timetable', id: null, week_start: mondayOf(date) });
      const plus = (stampText, seconds) => stamp(Date.parse(stampText) + seconds * 1000);
      const notify = (audience, kind, title, body, at, ref) => {
        notices.push({ id: notices.length + 1, audience, kind, title, body, created_at: at, ref });
      };
      const log = (at, actor, action, summary, ref) => activity.push({ at, actor, action, summary, ref });
      const classLine = (o) => `${o.subject.code} (${o.batch.code}) ${nice(o.date)} ${o.start}`;

      for (const h of happenings) {
        const before = notices.length;
        if (h.settings) {
          log(h.at, h.settings.by, 'settings.updated', 'Ranking weights updated', { type: 'settings', id: null, week_start: null });
          continue;
        }
        if (h.u && !h.withdrawn) {
          const u = h.u;
          const ps = state.proposals.filter((p) => p.unavailability_id === u.id);
          const n = ps.length;
          const classesText = n === 1 ? '1 class was' : `${n} classes were`;
          const is = { faculty_leave: 'is on leave', room_closure: 'is closed', batch_event: 'is away' }[u.kind];
          const whenText = when(u.start_date, u.end_date);
          if (u.kind === 'faculty_leave') log(u.created_at, u.created_by, 'unavailability.created', `${u.target.label} marked leave for ${whenText} (${span(u.periods)})`, unavRef(u));
          else log(u.created_at, u.created_by, 'unavailability.created', `${u.target.label} ${u.kind === 'room_closure' ? 'closed' : 'away'} on ${whenText} (${span(u.periods)}): ${u.reason}`, unavRef(u));
          if (u.kind === 'faculty_leave' && u.created_by.role === 'faculty') {
            notify(`faculty:${u.target.id}`, 'leave_recorded', `Leave recorded for ${whenText}`, `Your leave for ${whenText} (${span(u.periods)}) is recorded. ${n ? `${classesText} cancelled and sent to the HOD for new slots.` : 'None of your classes fall in it.'}`, u.created_at, unavRef(u));
          }
          if (n) {
            log(u.created_at, null, 'classes.cancelled', `${n} ${n === 1 ? 'class' : 'classes'} cancelled: ${ps.map((p) => classLine(p.original)).join(', ')}`, unavRef(u));
            log(u.created_at, null, 'proposals.created', `${n} rescheduling ${n === 1 ? 'proposal' : 'proposals'} sent to the HOD`, unavRef(u));
            notify('hod', 'proposal_pending', `${n === 1 ? '1 class needs' : `${n} classes need`} a new slot`, `${u.target.label} ${is} on ${whenText} (${span(u.periods)}). Review the suggested slots.`, u.created_at, unavRef(u));
            for (const p of ps) {
              const o = p.original;
              const title = `${o.subject.name} on ${nice(o.date)} ${o.start} is cancelled`;
              const body = `${u.target.label} ${is}. A new time will be shared once the HOD decides.`;
              notify(`batch:${o.batch.id}`, 'class_cancelled', title, body, plus(u.created_at, 60), ttRef(o.date));
              if (o.faculty && !(u.kind === 'faculty_leave' && o.faculty.id === u.target.id)) notify(`faculty:${o.faculty.id}`, 'class_cancelled', title, body, plus(u.created_at, 60), ttRef(o.date));
            }
          }
          if (notices.length > before) log(plus(u.created_at, 60), null, 'notifications.sent', `Sent ${notices.length - before} alerts and ${notices.length - before} emails`, unavRef(u));
        } else if (h.withdrawn) {
          const u = h.u;
          const ps = state.proposals.filter((p) => p.unavailability_id === u.id);
          log(h.at, u.created_by, 'unavailability.withdrawn', `${u.target.label}: leave for ${when(u.start_date, u.end_date)} withdrawn`, unavRef(u));
          if (ps.length) notify('hod', 'leave_withdrawn', `Leave withdrawn: ${u.target.label}`, `${ps.length === 1 ? 'The class is' : `The ${ps.length} classes are`} back as planned.`, h.at, unavRef(u));
          for (const p of ps) {
            const o = p.original;
            notify(`batch:${o.batch.id}`, 'class_restored', `${o.subject.name} on ${nice(o.date)} ${o.start} is back on`, 'The leave was withdrawn, so the class happens as planned.', h.at, ttRef(o.date));
          }
          if (notices.length > before) log(plus(h.at, 30), null, 'notifications.sent', `Sent ${notices.length - before} alerts and ${notices.length - before} emails`, unavRef(u));
        } else if (h.p) {
          const p = h.p;
          const d = p.decision;
          const o = p.original;
          const ref = { type: 'proposal', id: p.id, week_start: null };
          let title;
          let body;
          if (d.action === 'approved') {
            const room = d.slot.space?.code;
            const sameTime = d.slot.date === o.date && d.slot.start === o.start;
            if (sameTime) {
              title = `${o.subject.name} at ${o.start} on ${nice(o.date)} moved to ${room}`;
              body = `${p.reason}. The class stays at the same time but is now in ${room}.`;
              log(d.at, d.by, 'proposal.approved', `Approved: ${classLine(o)} -> ${room}, same time`, ref);
            } else {
              title = `${o.subject.name} moved to ${nice(d.slot.date)} ${d.slot.start}`;
              body = `Your ${nice(o.date)} ${o.start} class${o.faculty ? ` with ${o.faculty.name}` : ''} is now on ${nice(d.slot.date)} at ${d.slot.start}${room ? ` in ${room}` : ''}.`;
              log(d.at, d.by, 'proposal.approved', `Approved: ${classLine(o)} -> ${nice(d.slot.date)} ${d.slot.start}${room ? ` in ${room}` : ''}`, ref);
            }
          } else {
            title = `${o.subject.name} on ${nice(o.date)} ${o.start} stays cancelled`;
            body = d.note || 'No new slot will be scheduled.';
            log(d.at, d.by, 'proposal.rejected', `Rejected: ${classLine(o)} stays cancelled`, ref);
          }
          const kind = d.action === 'approved' ? 'class_moved' : 'class_cancelled';
          if (o.faculty) notify(`faculty:${o.faculty.id}`, kind, title, body, d.at, ttRef(o.date));
          notify(`batch:${o.batch.id}`, kind, title, body, d.at, ttRef(o.date));
          log(plus(d.at, 30), null, 'notifications.sent', `Sent ${notices.length - before} alerts and ${notices.length - before} emails`, ref);
        }
      }
      activity.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      activity.forEach((a, i) => {
        a.id = i + 1;
      });
      return { notices, activity };
    });
  }

  const audienceOf = (user) => (user.role === 'hod' ? 'hod' : user.role === 'faculty' ? `faculty:${user.faculty_id}` : `batch:${user.batch_id}`);
  const newestFirst = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;

  function noticesFor(user) {
    return history()
      .notices.filter((n) => n.audience === audienceOf(user))
      .map(({ audience, ...n }) => ({ ...n, read: state.reads.has(n.id) }))
      .sort(newestFirst);
  }

  function recipients(audience) {
    if (audience === 'hod') return hod.email;
    if (audience.startsWith('faculty:')) return teacherById.get(Number(audience.slice(8))).email;
    const batch = batchById.get(Number(audience.slice(6)));
    const own = students.filter((s) => s.batch_id === batch.id).map((s) => s.email);
    return own.length ? own.join(', ') : `Students of ${batch.code}`;
  }

  // ---------------------------------------------------------------- reports

  function roomUse(weekStart) {
    const entries = entriesFor(weekStart, addDays(weekStart, 6)).filter((e) => ACTIVE.has(e.status) && e.space);
    return cat.spaces.map((space) => {
      const used = entries.filter((e) => e.space.id === space.id).reduce((sum, e) => sum + (minutes(e.end) - minutes(e.start)) / 60, 0);
      return { space: spaceRef(space.id), used: Math.round(used * 10) / 10, total: OPEN_HOURS_PER_WEEK, pct: Math.round((used / OPEN_HOURS_PER_WEEK) * 1000) / 10 };
    });
  }

  function weekCounts(weekStart) {
    const entries = entriesFor(weekStart, addDays(weekStart, 6));
    const planned = entries.filter((e) => e.status !== 'moved_here');
    const count = (status) => planned.filter((e) => e.status === status).length;
    return { total: planned.length, scheduled: count('scheduled'), pending: count('pending'), cancelled: count('cancelled'), moved: count('moved_away') + count('room_changed') };
  }

  function checkCsv(text) {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
    const header = (lines.shift() ?? '').split(',').map((h) => h.trim());
    const want = ['batch_code', 'subject_code', 'faculty_code', 'space_code', 'day', 'period'];
    if (want.some((h, i) => header[i] !== h)) {
      return { rows: lines.length, errors: [{ row: 1, message: `The first line must be: ${want.join(',')}` }], clashes: [] };
    }
    const errors = [];
    const rows = [];
    lines.forEach((line, i) => {
      const row = i + 2;
      const [batchCode, subjectCode, facultyCode, spaceCode, day, period] = line.split(',').map((x) => x.trim());
      const batch = cat.batches.find((b) => b.code === batchCode);
      if (!batch) return errors.push({ row, message: `Unknown batch '${batchCode}'` });
      const subject = cat.subjects.find((s) => s.batch_id === batch.id && s.code === subjectCode);
      if (!subject) return errors.push({ row, message: `${batch.code} has no subject '${subjectCode}'` });
      const faculty = facultyCode ? cat.teachers.find((t) => t.code === facultyCode) : null;
      if (facultyCode && !faculty) return errors.push({ row, message: `Unknown faculty code '${facultyCode}'` });
      const space = spaceCode ? cat.spaces.find((s) => s.code === spaceCode) : null;
      if (spaceCode && !space) return errors.push({ row, message: `Unknown room '${spaceCode}'` });
      if (!batch.days.includes(day)) return errors.push({ row, message: `${batch.code} has no classes on '${day}'` });
      const slot = batch.slots.find((s) => s.period === Number(period));
      if (!slot) return errors.push({ row, message: `Period must be between 1 and ${batch.slots.length} for ${batch.code}, got ${period}` });
      rows.push({ row, batch, subject, faculty, space, day, start: slot.start, end: slot.end });
    });
    const clashes = [];
    const elective = (s) => s.category.startsWith('elective');
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a.day !== b.day || !overlap(a, b)) continue;
        const at = `${a.day} ${a.start}`;
        if (a.faculty && a.faculty === b.faculty) clashes.push({ row: b.row, message: `${a.faculty.name} has two classes on ${at} (rows ${a.row} and ${b.row})` });
        if (a.space && a.space === b.space && a.batch !== b.batch) clashes.push({ row: b.row, message: `${a.space.code} is used by ${a.batch.code} and ${b.batch.code} on ${at}` });
        if (a.batch === b.batch && !(elective(a.subject) && elective(b.subject))) clashes.push({ row: b.row, message: `${a.batch.code} has two classes on ${at} (rows ${a.row} and ${b.row})` });
      }
    }
    return { rows: lines.length, errors, clashes };
  }

  replay();

  // ---------------------------------------------------------------- what api.js calls

  return {
    calendar: () => ({
      days: DAYS,
      periods: HOURS,
      breaks: [],
      timezone: 'Asia/Kolkata',
      today: TODAY,
      now: demo.now,
      now_period: HOURS.find((h) => minutes(h.start) <= minutes(demo.now.slice(11, 16)) && minutes(demo.now.slice(11, 16)) < minutes(h.end))?.period ?? 1,
      current_week_start: demo.current_week_start,
      demo_mode: true,
      school: cat.school,
      university: cat.university,
      head: cat.head,
    }),
    faculty: () => cat.teachers,
    batches: () => cat.batches,
    subjects: () => cat.subjects,
    spaces: () => cat.spaces,
    review: () => cat.review,

    week({ weekStart, batchId, facultyId, spaceId } = {}) {
      const ws = weekStart || demo.current_week_start;
      const we = addDays(ws, 6);
      const marks = new Map();
      for (const c of weekClashes(mondayOf(ws))) for (const x of c.classes) marks.set(x.key, c.message);
      const entries = entriesFor(ws, we)
        .filter((e) => (batchId == null || e.batch.id === Number(batchId)) && (facultyId == null || e.faculty?.id === Number(facultyId)) && (spaceId == null || e.space?.id === Number(spaceId)))
        .map((e) => (marks.has(e.key) && ACTIVE.has(e.status) ? { ...e, clash: marks.get(e.key) } : e));
      const batch = batchId != null ? batchById.get(Number(batchId)) : null;
      // The rows of the grid: one batch keeps the columns of its sheet; a teacher or room gets the times its classes use.
      const times = new Map((batch ? batch.slots : []).map((s) => [`${s.start}-${s.end}`, { start: s.start, end: s.end }]));
      for (const e of entries) times.set(`${e.start}-${e.end}`, { start: e.start, end: e.end });
      const slots = [...times.values()].sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end));
      const used = new Set(entries.map((e) => e.day));
      const days = batch ? batch.days : DAYS.filter((d) => used.has(d) || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(d));
      return {
        week_start: ws,
        week_end: we,
        filter: { batch_id: batchId ?? null, faculty_id: facultyId ?? null, space_id: spaceId ?? null },
        days,
        slots,
        breaks: batch ? batch.breaks : [],
        entries,
      };
    },

    roomAvailability(date, period) {
      const day = isDate(date) ? date : TODAY;
      const dayEntries = entriesFor(day, day).filter((e) => ACTIVE.has(e.status) && e.space);
      const hours = HOURS.filter((h) => !period || h.period === Number(period));
      return {
        date: day,
        day: dayOf(day),
        spaces: cat.spaces.map((space) => ({
          space,
          slots: hours.map((h) => {
            const closed = state.unavailability.find((u) => u.kind === 'room_closure' && u.target.id === space.id && covers(u, day, h));
            if (closed) return { period: h.period, status: 'closed', entry: null, note: closed.reason };
            const e = dayEntries.find((x) => x.space.id === space.id && overlap(x, h));
            return e ? { period: h.period, status: 'busy', entry: e, note: null } : { period: h.period, status: 'free', entry: null, note: null };
          }),
        })),
      };
    },

    unavailability(user, { from, to, mine } = {}) {
      if (user.role === 'student') fail(403, 'FORBIDDEN', 'Students cannot view leave records.');
      const own = (u) => u.created_by.id === user.id || (u.target.type === 'faculty' && u.target.id === user.faculty_id);
      return state.unavailability
        .filter((u) => (user.role === 'hod' && !mine ? true : own(u)) && (!from || u.end_date >= from) && (!to || u.start_date <= to))
        .map(withCounts)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    },
    createUnavailability: (user, body) => record({ type: 'unavailability', at: nextAt(), user: userRef(user), body: clone(body ?? {}) }),
    withdrawUnavailability: (user, id) => record({ type: 'withdraw', at: nextAt(), user: userRef(user), id: Number(id) }),

    proposals: ({ status, unavailabilityId } = {}) =>
      state.proposals
        .filter((p) => p.status !== 'withdrawn' && (!status || p.status === status) && (!unavailabilityId || p.unavailability_id === Number(unavailabilityId)))
        // Waiting ones in the order they came in, then decided ones newest first.
        .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || (a.status === 'pending' ? a.id - b.id : Date.parse(b.decision.at) - Date.parse(a.decision.at))),
    proposal: (id) => findProposal(id),
    checkSlot(id, slot) {
      const { slot: _slot, ...answer } = checkSlot(findProposal(id), slot, stamp(lastAt + 60000));
      return answer;
    },
    approve: (user, id, body) => record({ type: 'decision', at: nextAt(), user: userRef(user), proposal_id: Number(id), action: 'approved', option_rank: body.option_rank ?? null, custom: body.custom ?? null, note: body.note ?? null, version: body.version }),
    reject: (user, id, body) => record({ type: 'decision', at: nextAt(), user: userRef(user), proposal_id: Number(id), action: 'rejected', note: body.note ?? null, version: body.version }),

    whatIf(user, changes) {
      const started = Date.now();
      const saved = { unavailability: clone(state.unavailability), proposals: clone(state.proposals) };
      const atStamp = stamp(lastAt + 60000);
      try {
        const steps = (changes ?? []).map((change, index) => {
          const result = addUnavailability({ ...change, reason: change.reason || 'What-if' }, userRef(user), atStamp);
          const u = result.unavailability;
          return {
            index,
            change,
            label: `${u.target.label} ${{ faculty_leave: 'on leave', room_closure: 'closed', batch_event: 'away' }[u.kind]}, ${when(u.start_date, u.end_date)}`,
            affected: result.affected.map((e) => ({ ...e, proposal_id: 0 })),
            ids: result.proposals.map((p) => p.id),
          };
        });
        // Place the classes one after the other, so two of them never get the same slot.
        const plan = [];
        for (const step of steps) {
          for (const id of step.ids) {
            const p = state.proposals.find((x) => x.id === id);
            const best = findOptions(asEntry(p.original), atStamp)[0] ?? null;
            if (best) {
              p.status = 'approved';
              p.decision = { action: 'approved', by: userRef(user), at: atStamp, custom: false, rank: 1, slot: { date: best.date, day: best.day, period: best.period, start: best.start, end: best.end, space: best.space }, note: null };
              changed();
            }
            const { entry_key, elective_group, ...original } = p.original;
            plan.push({ original, option: best });
          }
        }
        const placed = plan.filter((x) => x.option).length;
        return {
          steps: steps.map(({ ids, ...step }) => step),
          plan,
          summary: { classes_affected: plan.length, classes_placed: placed, classes_unplaced: plan.length - placed },
          runtime_ms: Math.max(0.1, Math.round((Date.now() - started) * 10) / 10),
        };
      } finally {
        state.unavailability = saved.unavailability;
        state.proposals = saved.proposals;
        changed();
      }
    },

    notifications(user, { unreadOnly = false, limit = 20, offset = 0 } = {}) {
      const all = noticesFor(user);
      const items = all.filter((n) => !unreadOnly || !n.read);
      return { items: items.slice(offset, offset + limit), total: items.length, unread: all.filter((n) => !n.read).length };
    },
    markRead(user, id) {
      const n = noticesFor(user).find((x) => x.id === Number(id));
      if (!n) fail(404, 'NOT_FOUND', `Notification ${id} was not found.`);
      if (!n.read) record({ type: 'read', ids: [n.id] });
      return { ...n, read: true };
    },
    markAllRead(user) {
      const ids = noticesFor(user).filter((n) => !n.read).map((n) => n.id);
      if (ids.length) record({ type: 'read', ids });
      return { updated: ids.length };
    },
    liveExample(type, user) {
      if (type === 'notification') return noticesFor(user)[0] ?? null;
      const p = state.proposals.find((x) => x.status === 'pending') ?? state.proposals[0];
      if (type === 'proposal_updated') return p ? { id: p.id, status: p.status, version: p.version } : null;
      if (type === 'timetable_changed') {
        return p
          ? { week_start: mondayOf(p.original.date), batch_ids: [p.original.batch.id], faculty_ids: p.original.faculty ? [p.original.faculty.id] : [], space_ids: p.original.space ? [p.original.space.id] : [] }
          : null;
      }
      return null;
    },
    outbox({ limit = 50, offset = 0 } = {}) {
      const items = history()
        .notices.map((n) => ({
          id: n.id,
          to: recipients(n.audience),
          subject: n.title,
          body: `${n.body}\n\n- Smart Scheduling System (demo)`,
          created_at: stamp(Date.parse(n.created_at) + 20000),
          status: 'sent',
          delivered_to: 'test-inbox@example.com',
        }))
        .sort(newestFirst);
      return { items: items.slice(offset, offset + limit), total: items.length };
    },
    activity({ limit = 50, offset = 0 } = {}) {
      const items = [...history().activity].reverse();
      return { items: items.slice(offset, offset + limit), total: items.length };
    },

    summary({ weekStart } = {}) {
      const ws = weekStart || demo.current_week_start;
      const counts = weekCounts(ws);
      const use = roomUse(ws);
      const used = use.reduce((sum, r) => sum + r.used, 0);
      return {
        week_start: ws,
        classes_total: counts.total,
        scheduled: counts.scheduled,
        pending: counts.pending,
        cancelled: counts.cancelled,
        moved: counts.moved,
        active_unavailability: state.unavailability.filter((u) => u.status === 'active' && u.end_date >= ws && u.start_date <= addDays(ws, 6)).length,
        pending_approvals: state.proposals.filter((p) => p.status === 'pending').length,
        room_utilisation_pct: use.length ? Math.round((used / (use.length * OPEN_HOURS_PER_WEEK)) * 1000) / 10 : 0,
        clashes: weekClashes(ws).length,
      };
    },
    trends({ weeks = 8 } = {}) {
      const current = demo.current_week_start;
      const list = Array.from({ length: weeks }, (_, i) => addDays(current, -7 * (weeks - 1 - i))).map((ws) => {
        const c = weekCounts(ws);
        return { week_start: ws, cancelled: c.cancelled, moved: c.moved, pending: c.pending };
      });
      const byFaculty = new Map();
      for (const u of state.unavailability) {
        if (u.kind !== 'faculty_leave' || u.status !== 'active') continue;
        const row = byFaculty.get(u.target.id) ?? { faculty: teacherRef(u.target.id), leaves: 0, classes_affected: 0 };
        row.leaves += 1;
        row.classes_affected += proposalsOf(u).length;
        byFaculty.set(u.target.id, row);
      }
      const entries = entriesFor(current, addDays(current, 6)).filter((e) => ACTIVE.has(e.status));
      const used = new Set(entries.map((e) => e.day));
      return {
        weeks: list,
        by_faculty: [...byFaculty.values()].sort((a, b) => b.classes_affected - a.classes_affected),
        room_utilisation: roomUse(current),
        heatmap: DAYS.filter((d) => used.has(d)).flatMap((day) =>
          HOURS.map((h) => ({ day, period: h.period, start: h.start, classes: entries.filter((e) => e.day === day && overlap(e, h)).length })),
        ),
      };
    },
    clashes({ weekStart } = {}) {
      const ws = weekStart || demo.current_week_start;
      const items = weekClashes(ws);
      const count = (type) => items.filter((c) => c.type === type).length;
      return { week_start: ws, items, counts: { faculty: count('faculty'), room: count('room'), batch: count('batch') } };
    },

    ranking: () => settingsOut(),
    updateRanking: (user, patch) => record({ type: 'settings', at: nextAt(), user: userRef(user), patch: clone(patch ?? {}) }),
    checkImport(text, dryRun) {
      const result = checkCsv(text);
      if (!dryRun) {
        fail(409, 'NOT_AVAILABLE', result.errors.length || result.clashes.length
          ? 'Fix the problems in the file first.'
          : 'The demo keeps the timetables from the department\'s sheets, so importing is switched off. Your file passed the check.');
      }
      return { dry_run: true, rows: result.rows, imported: 0, errors: result.errors, clashes: result.clashes };
    },
    reset() {
      userEvents = [];
      onSave(userEvents);
      replay();
      return { ok: true, message: 'Demo data restored to the starting state' };
    },
    /** The sample CSV for the Settings page: every class of every batch, one per line. */
    sampleCsv() {
      const lines = ['batch_code,subject_code,faculty_code,space_code,day,period'];
      for (const s of cat.sessions) {
        const b = batchById.get(s.batch_id);
        lines.push([b.code, subjectById.get(s.subject_id).code, s.faculty_id ? teacherById.get(s.faculty_id).code : '', s.space_id ? spaceById.get(s.space_id).code : '', s.day, s.period].join(','));
      }
      return `${lines.join('\n')}\n`;
    },
  };
}
