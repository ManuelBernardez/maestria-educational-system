/* Apply the saved/system theme before stylesheets render to avoid a flash. */
(() => {
  try {
    const saved = sessionStorage.getItem('maestria-theme');
    const preferred = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = saved === 'dark' || saved === 'light' ? saved : preferred;
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
