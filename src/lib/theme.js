// Light / dark mode. The choice is saved in this browser, so every page opens in the same mode.
// Each page's <head> has a tiny script that applies the saved choice before anything is drawn,
// so the page never flashes white first. With no saved choice, the computer's own setting is used.
const KEY = 'theme';

/** "dark" or "light": what the page shows right now. */
export function currentTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Switches the whole page, saves the choice, and tells the page (charts redraw on "themechange"). */
export function setTheme(theme) {
  const root = document.documentElement;
  // The colours fade for a moment instead of jumping (.theme-fade in styles.css).
  root.classList.add('theme-fade');
  root.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage is blocked (some private windows): the mode still changes, it is just not remembered */
  }
  setTimeout(() => root.classList.remove('theme-fade'), 400);
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
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
 * They spin in only while the mode is being switched (.theme-fade), not every time a page opens.
 */
export function themeIcons(moon, sun) {
  return `<span class="block in-[.theme-fade]:animate-spin-in dark:hidden">${moon}</span><span class="hidden in-[.theme-fade]:animate-spin-in dark:block">${sun}</span>`;
}
