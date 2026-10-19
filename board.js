const COLS = 30;
const ROWS = 16;

function oklchToSrgb(L, C, h) {
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  return linear.map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

function inGamut(rgb) {
  return rgb.every(v => v >= 0 && v <= 1);
}

function maxChroma(L, h) {
  let low = 0;
  let high = 0.4;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToSrgb(L, mid, h))) low = mid;
    else high = mid;
  }
  return low;
}

function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function buildBoard() {
  const colors = [];
  for (let row = 0; row < ROWS; row++) {
    const t = row / (ROWS - 1);
    const lightness = 0.93 - t * 0.6;
    const chromaCap = 0.06 + 0.2 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.85));
    for (let col = 0; col < COLS; col++) {
      const hue = (20 + col * 12) % 360;
      const chroma = Math.min(maxChroma(lightness, hue), chromaCap);
      colors.push(toHex(oklchToSrgb(lightness, chroma, hue)));
    }
  }
  return colors;
}

module.exports = { buildBoard, COLS, ROWS };
