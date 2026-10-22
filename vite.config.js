import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Every page of the website. When you add a new page (for example whatif.html),
// add its name here too, or `npm run build` will leave it out.
const pages = ['index', 'student', 'faculty', 'hod', 'approvals', 'timetable', 'rooms', 'reports', 'whatif', 'settings'];

// `npm run build` drops blocking="render" from the page scripts, so put it back. It makes each page wait
// for its script before it is first shown, so the menu is already drawn when the page fades in.
const keepRenderBlocking = {
  name: 'keep-render-blocking',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => html.replace(/<script type="module" crossorigin/g, '<script type="module" blocking="render" crossorigin'),
  },
};

export default defineConfig({
  plugins: [tailwindcss(), keepRenderBlocking],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
    },
  },
});
