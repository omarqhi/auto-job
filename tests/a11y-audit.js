// Accessibility audit for the dashboard. Not a Node script: open http://localhost:5680, paste this into the browser console.
// Reports: low-contrast text, small click targets, tiny text, heading-level gaps, unlabeled controls.
(async () => {
  const parse = c => { const m = c.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  function bgOf(el) {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && (c[3] === undefined || c[3] > .5)) return c;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  }
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden],[aria-hidden="true"]'); };

  const contrast = [], tiny = [], seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || ['SCRIPT', 'STYLE', 'svg', 'path', 'circle'].includes(el.tagName)) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const s = getComputedStyle(el), fg = parse(s.color), bg = bgOf(el);
    const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const r = ratio(fg, bg), need = large ? 3 : 4.5;
    const label = (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()) + ' "' + el.textContent.trim().slice(0, 28) + '"';
    if (r < need) { const k = s.color + bg + need; if (!seen.has(k)) { seen.add(k); contrast.push(`${r.toFixed(2)}:1 (needs ${need}) ${label}`); } }
    if (size < 12) tiny.push(`${size}px ${label}`);
  }

  const small = [];
  for (const el of document.querySelectorAll('button, a, input, [role="tab"], [tabindex="0"], label.switch')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) small.push(`${Math.round(r.width)}x${Math.round(r.height)} ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().slice(0, 30)}"`);
  }

  const heads = [...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(h => Number(h.tagName[1]));
  const gaps = heads.filter((h, i) => i && h > heads[i - 1] + 1).length;

  const unlabeled = [...document.querySelectorAll('button, input, select, textarea')].filter(visible).filter(el => {
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.getAttribute('aria-labelledby') || el.title;
    return !name;
  }).map(el => el.outerHTML.slice(0, 80));

  return { contrast, small, tiny: [...new Set(tiny)].slice(0, 12), headingOrder: heads.join(' '), headingGaps: gaps, unlabeled };
})();
