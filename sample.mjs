import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await b.newPage();
const pts = { base: [470, 500], panel: [300, 420] };
for (const name of ['1-nothing-selected', '2-base-selected', '3-panel-selected']) {
  const data = await page.evaluate(async ([file, pts]) => {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = file; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const ctx = c.getContext('2d');
    const out = {};
    for (const [k, [x, y]] of Object.entries(pts)) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      out[k] = [d[0], d[1], d[2]];
    }
    return out;
  }, [`file:///tmp/claude-0/shot-${name}.png`, pts]);
  const fmt = ([r, g, b]) => {
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
    const l = (mx + mn) / 2;
    const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (mx !== mn) {
      const [R, G, B] = [r / 255, g / 255, b / 255];
      if (mx === R) h = ((G - B) / (mx - mn)) % 6;
      else if (mx === G) h = (B - R) / (mx - mn) + 2;
      else h = (R - G) / (mx - mn) + 4;
      h = (h * 60 + 360) % 360;
    }
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')} h=${h.toFixed(0).padStart(3)} s=${s.toFixed(2)} l=${l.toFixed(2)}`;
  };
  console.log(name.padEnd(20), 'base', fmt(data.base), '  panel', fmt(data.panel));
}
await b.close();
