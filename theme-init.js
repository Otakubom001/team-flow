// Apply the saved preference before paint; Midnight is the default for new visitors.
try {
    document.documentElement.dataset.theme = localStorage.getItem('teamflow_theme') === 'light' ? 'light' : 'dark';
} catch (_) {
    document.documentElement.dataset.theme = 'dark';
}
