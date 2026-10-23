// Writes the example answers in public/mock/*.json (and public/sample_timetable.csv) from the demo engine,
// so they always match the timetables in public/mock/timetables.json. The app itself does not read these
// files (in mock mode it asks src/mock/engine.js); they are examples of each API answer for the backend team.
//
// Run after changing timetables.json or demo.json:   npm run mock:snapshot
import { readFileSync, writeFileSync } from 'node:fs';
import { createEngine } from '../src/mock/engine.js';

const dir = new URL('../public/mock/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
const write = (name, data) => writeFileSync(new URL(`${name}.json`, dir), `${JSON.stringify(data, null, 2)}\n`);
const makeError = (status, code, detail, body) => Object.assign(new Error(detail), { status, code, detail, ...(body ?? {}) });

const fresh = () => createEngine({ source: read('timetables'), demo: read('demo'), ranking: read('settings_ranking'), makeError });
const engine = fresh();
const users = {
  hod: read('login_hod').user,
  faculty: read('login_faculty').user,
  student: read('login_student').user,
};
const calendar = engine.calendar();

write('calendar', calendar);
write('faculty', engine.faculty());
write('batches', engine.batches());
write('subjects', engine.subjects());
write('spaces', engine.spaces());
write('timetable_week', engine.week({ weekStart: calendar.current_week_start }));
write('availability_rooms', engine.roomAvailability(calendar.today));
write('clashes', engine.clashes());
write('review', engine.review());
write('unavailability', engine.unavailability(users.hod));
write('proposals', engine.proposals());
write('notifications_hod', engine.notifications(users.hod));
write('notifications_faculty', engine.notifications(users.faculty));
write('notifications_student', engine.notifications(users.student));
write('activity', engine.activity());
write('outbox', engine.outbox());
write('analytics_summary', engine.summary());
write('analytics_trends', engine.trends());
write('sse_examples', {
  notification: engine.liveExample('notification', users.hod),
  timetable_changed: engine.liveExample('timetable_changed', users.hod),
  proposal_updated: engine.liveExample('proposal_updated', users.hod),
});

// Examples of the answers to actions, each on a fresh copy so they do not change the files above.
const pending = engine.proposals({ status: 'pending' })[0];
const p = pending.original;
write('proposal_check_ok', engine.checkSlot(pending.id, { date: pending.options[0].date, period: pending.options[0].period, space_id: pending.options[0].space?.id ?? null }));
write('proposal_check_clash', engine.checkSlot(pending.id, { date: '2026-10-30', period: 1, space_id: p.space?.id ?? null }));
write('proposal_approve', fresh().approve(users.hod, pending.id, { version: pending.version, option_rank: 1 }));
write('proposal_approve_request', { version: pending.version, option_rank: 1, custom: null, note: null });
const leave = engine.unavailability(users.faculty)[0];
write('unavailability_withdraw', fresh().withdrawUnavailability(users.faculty, leave.id));
const request = { kind: 'faculty_leave', target_id: users.faculty.faculty_id, start_date: '2026-11-02', end_date: '2026-11-02', periods: null, reason: 'Attending a conference' };
write('unavailability_create_request', request);
write('unavailability_create', fresh().createUnavailability(users.faculty, request));
const whatif = { changes: [{ kind: 'faculty_leave', target_id: 20, start_date: '2026-10-30', end_date: '2026-10-30', periods: null, reason: 'What-if: medical leave' }] };
write('whatif_request', whatif);
write('whatif', { ...fresh().whatIf(users.hod, whatif.changes), runtime_ms: 3.8 });
write('search_ma', [...engine.faculty(), ...engine.subjects()]
  .filter((x) => x.name.toLowerCase().split(/[\s.,/]+/).some((w) => w.startsWith('ma')))
  .slice(0, 8)
  .map((x) => ('designation' in x
    ? { type: 'faculty', id: x.id, label: x.name, sublabel: x.designation }
    : { type: 'subject', id: x.id, label: x.name, sublabel: `${x.code} · ${x.batch_code}` })));
const csv = engine.sampleCsv();
writeFileSync(new URL('../sample_timetable.csv', dir), csv);
write('import_result', engine.checkImport(csv, true));
console.log(`Wrote the example files for ${engine.batches().length} batches and ${engine.week({ weekStart: calendar.current_week_start }).entries.length} classes this week.`);
