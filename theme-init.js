// Apply the saved preference before paint; Midnight is the default for new visitors.
try {
    document.documentElement.dataset.theme = localStorage.getItem('teamflow_theme') === 'light' ? 'light' : 'dark';
} catch (_) {
    document.documentElement.dataset.theme = 'dark';
}
// Apply the last-used studio before paint so its theme never flashes. The app
// confirms the database supports studios before loading any non-default studio.
try {
    document.documentElement.dataset.studio = localStorage.getItem('teamflow_studio') === 'ladyploy' ? 'ladyploy' : 'enil';
} catch (_) {
    document.documentElement.dataset.studio = 'enil';
}
