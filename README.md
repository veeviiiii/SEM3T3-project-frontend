# Smart Scheduling: frontend

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and press one of the three demo buttons.

## Where things are

- `index.html` + `src/pages/login.js`: the login page (done)
- `student.html` + `src/pages/student.js`: the student page (**the example to copy**)
- `faculty.html`, `hod.html`, `approvals.html`, `timetable.html`, `rooms.html`, `reports.html`: empty shells to build
- `src/api.js`: the only file that talks to the server (from the contract; don't edit it)
- `src/lib/`: shared pieces (header, timetable grid, helpers)
- `public/mock/`: fake server answers used until the real backend is ready

## Switch to the real backend later

Create a file called `.env` in this folder:

```
VITE_USE_MOCK=false
VITE_API_BASE=http://localhost:8000
```

Stop and restart `npm run dev`.
