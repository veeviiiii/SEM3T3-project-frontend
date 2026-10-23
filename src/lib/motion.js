// Small animations shared by every page, made with Motion (https://motion.dev).
// They are all short, only move and fade things (cheap for the computer), and do nothing at all
// for people who asked their computer for less motion.
import { animate, inView, stagger } from 'motion';
import { prefersReducedMotion } from './ui.js';

const SPRING = { type: 'spring', stiffness: 420, damping: 34 };
const pillMovers = new Set(); // one "move the pill" function per tab group

/** Called once by renderHeader() on every page. */
export function setupMotion() {
  if (prefersReducedMotion()) return;
  setupReveal();
  setupPills();
  setupNavPill();
  setupSpotlight();
  setupTilt();
}

// ------------------------------------------------------------------ scroll reveal

/**
 * Cards fade in (with a soft blur, like Magic UI's "blur fade") the first time they scroll into view.
 * Until then styles.css keeps them transparent, but only while <html> has .motion-reveal,
 * so the page is never left blank if this code does not run.
 */
function setupReveal() {
  document.documentElement.classList.add('motion-reveal');
  const watched = new WeakSet();
  const watch = (card) => {
    if (watched.has(card)) return;
    watched.add(card);
    const stop = inView(
      card,
      () => {
        stop(); // only the first time
        card.dataset.shown = 'true';
        animate(card, { opacity: [0, 1], y: [14, 0], filter: ['blur(4px)', 'blur(0px)'] }, { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] });
      },
      { margin: '0px 0px -8% 0px' },
    );
  };
  const main = document.querySelector('main');
  if (!main) return;
  main.querySelectorAll('.card').forEach(watch);
  // Cards that a page draws later (after its data arrives) are watched too.
  new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches('.card')) watch(node);
        node.querySelectorAll('.card').forEach(watch);
      }
    }
  }).observe(main, { childList: true, subtree: true });
}

// ------------------------------------------------------------------ sliding tab pill

/**
 * Tab groups marked data-pill (Waiting / Approved / Rejected, All / Rooms / Labs...) get one coloured
 * pill that slides to the chosen tab with a spring, instead of the colour jumping from tab to tab.
 * The chosen tab is the button with aria-pressed="true", or the label after a checked radio button.
 * (Without motion, the tabs keep their own plain highlight; .has-pill hides it, see styles.css.)
 */
function setupPills() {
  document.querySelectorAll('[data-pill]').forEach((group) => {
    const pill = document.createElement('span');
    pill.className = 'tab-pill';
    pill.setAttribute('aria-hidden', 'true');
    group.prepend(pill);
    group.classList.add('has-pill');
    let shown = false;

    const move = () => {
      const active = group.querySelector('[aria-pressed="true"], input:checked + *');
      if (!active) {
        pill.style.opacity = '0';
        return;
      }
      const box = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
      // The first time, jump straight to the tab; after that, slide.
      animate(pill, { ...box, opacity: 1 }, shown ? SPRING : { duration: 0 });
      shown = true;
    };

    group.addEventListener('click', () => requestAnimationFrame(move));
    group.addEventListener('change', move);
    new MutationObserver(move).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    new ResizeObserver(() => {
      shown = false;
      move();
    }).observe(group);
    // The page script may pick the starting tab right after renderHeader(), so look again a moment later.
    requestAnimationFrame(move);
    pillMovers.add(move);
  });
}

/** Call after a page picks a tab from code (setting a radio's .checked sends no event), so the pill follows. */
export function refreshPills() {
  pillMovers.forEach((move) => move());
}

// ------------------------------------------------------------------ menu highlight between pages

/**
 * The highlight behind the current menu item (.nav-pill) glides from the item you clicked on the old page.
 * The old page remembers how high the highlight was; the new page starts it there and slides it home.
 * It moves inside the menu, behind the words, so the item you clicked never disappears.
 */
function setupNavPill() {
  const KEY = 'nav-pill-from';
  const pill = document.querySelector('#sidebar .nav-pill');
  if (!pill) return;

  document.getElementById('sidebar').addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    // A Ctrl/Shift click opens another tab, so this page stays and there is nothing to slide.
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    try {
      sessionStorage.setItem(KEY, String(pill.getBoundingClientRect().top));
    } catch {
      // Storage blocked: the next page just shows its highlight without sliding.
    }
  });

  let from = null;
  try {
    from = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
  if (from === null) return;
  const now = pill.getBoundingClientRect();
  // Start inside this part of the menu (Settings sits in a separate part at the bottom), so the pill
  // never slides over the profile card or makes the menu scroll.
  const area = pill.parentElement.parentElement.getBoundingClientRect();
  const start = Math.min(Math.max(Number(from), area.top), area.bottom - now.height);
  if (Number.isFinite(start) && start !== now.top) animate(pill, { y: [start - now.top, 0] }, SPRING);
}

// ------------------------------------------------------------------ spotlight on cards

/** A soft light follows the mouse over cards (Magic UI's "magic card"). styles.css draws it from --mx / --my. */
function setupSpotlight() {
  let frame = 0;
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const card = event.target instanceof Element ? event.target.closest('.card, .lift') : null;
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    });
  });
}

// ------------------------------------------------------------------ tilt

/** Elements marked data-tilt lean a little towards the mouse, and spring back when it leaves. */
function setupTilt() {
  const MAX = 5; // degrees
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const el = event.target instanceof Element ? event.target.closest('[data-tilt]') : null;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5; // -0.5 .. 0.5
    const y = (event.clientY - box.top) / box.height - 0.5;
    animate(el, { rotateX: -y * MAX * 2, rotateY: x * MAX * 2, transformPerspective: 800 }, { type: 'spring', stiffness: 260, damping: 22 });
  });
  document.addEventListener(
    'pointerout',
    (event) => {
      const el = event.target instanceof Element ? event.target.closest('[data-tilt]') : null;
      if (el && !el.contains(event.relatedTarget)) animate(el, { rotateX: 0, rotateY: 0 }, { type: 'spring', stiffness: 200, damping: 18 });
    },
    true,
  );
}

// ------------------------------------------------------------------ one-off helpers for the pages

/** Counts a number up from 0 (Magic UI's "number ticker"). Without motion it just shows the number. */
export function tickNumber(el, to) {
  const end = Number(to);
  if (prefersReducedMotion() || !Number.isFinite(end) || end <= 0) {
    el.textContent = to;
    return;
  }
  animate(0, end, { duration: 1.1, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => (el.textContent = Math.round(v)) });
}

/** A list (search results...) fades in one item after the other. */
export function staggerIn(elements, { y = 6 } = {}) {
  if (prefersReducedMotion() || !elements.length) return;
  animate(elements, { opacity: [0, 1], y: [y, 0] }, { duration: 0.22, delay: stagger(0.03) });
}

/** A new week slides in from the side you moved to: direction 1 = later week (from the right), -1 = earlier. */
export function slideIn(el, direction) {
  if (prefersReducedMotion() || !el || !direction) return;
  animate(el, { opacity: [0, 1], x: [28 * direction, 0] }, { duration: 0.3, ease: [0.2, 0.7, 0.2, 1] });
}

/** A little shake, to say "something new" (the bell, when a notification arrives). */
export function shake(el) {
  if (prefersReducedMotion() || !el) return;
  animate(el, { rotate: [0, -14, 12, -8, 5, 0] }, { duration: 0.5 });
}
