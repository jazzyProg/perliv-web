// Backend address. Change it here if the server moves; nothing else in the site needs editing.
window.PERLIV_API = 'https://perliv.tail1defb3.ts.net';
// theme before first paint (no light/dark flash)
try { const t = localStorage.getItem('perliv.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
