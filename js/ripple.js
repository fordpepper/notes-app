// Material ripple: a soft circle that grows from the touch point on buttons and list rows.
const TARGET = 'button:not(:disabled), .row, .hit, .folderlist button, summary';
addEventListener('pointerdown', e => {
  if (e.button || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = e.target.closest?.(TARGET);
  if (!el || el.matches('.noripple, .swatches *, #lightbox *')) return;
  const r = el.getBoundingClientRect(), d = Math.hypot(Math.max(e.clientX - r.left, r.right - e.clientX), Math.max(e.clientY - r.top, r.bottom - e.clientY)) * 2;
  const s = document.createElement('span');
  s.className = 'ripple'; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  el.append(s);
  s.addEventListener('animationend', () => s.remove(), { once: true });
}, { passive: true, capture: true });
