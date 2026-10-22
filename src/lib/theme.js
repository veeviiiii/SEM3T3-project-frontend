// Light / dark mode. The choice is saved in this browser, so every page opens in the same mode.
// Each page's <head> has a tiny script that applies the saved choice before anything is drawn,
// so the page never flashes white first. With no saved choice, the computer's own setting is used.
import { prefersReducedMotion } from './ui.js';

const KEY = 'theme';
let switching = null; // the fade that is running now, if any
let wanted = null; // the mode being switched to while that fade runs (the colours change a moment later)

/** "dark" or "light": what the page shows (or is just switching to). */
export function currentTheme() {
  return wanted ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}

/** Switches the whole page, saves the choice, and tells the page (charts redraw on "themechange"). */
export function setTheme(theme) {
  const root = document.documentElement;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage is blocked (some private windows): the mode still changes, it is just not remembered */
  }

  function apply() {
    root.classList.add('theme-switching');
    root.classList.toggle('dark', theme === 'dark');
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }

  // Older browsers, and people who asked for less motion: switch at once.
  if (!document.startViewTransition || prefersReducedMotion()) {
    apply();
    root.classList.remove('theme-switching');
    return;
  }
  // Otherwise the browser takes a picture of the old colours and fades it into the new ones
  // (.theme-switching in styles.css). The graphics card does the fading, so it stays smooth.
  wanted = theme;
  const transition = document.startViewTransition(apply);
  switching = transition;
  transition.ready.catch(() => {}); // skipped (for example clicked twice quickly): not an error
  transition.finished.finally(() => {
    if (switching !== transition) return; // a newer switch has taken over
    root.classList.remove('theme-switching');
    wanted = null;
  });
}

/** Makes a button switch between light and dark. aria-pressed tells screen readers if dark mode is on. */
export function setupThemeToggle(button) {
  const show = () => button.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
  button.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    show();
  });
  show();
}

/**
 * The toggle button's two icons: the moon shows in light mode, the sun in dark mode.
 * They spin in only while the mode is being switched (.theme-switching), not every time a page opens.
 */
export function themeIcons(moon, sun) {
  return `<span class="block in-[.theme-switching]:animate-spin-in dark:hidden">${moon}</span><span class="hidden in-[.theme-switching]:animate-spin-in dark:block">${sun}</span>`;
}
