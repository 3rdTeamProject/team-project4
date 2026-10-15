import { writeFileSync } from 'node:fs';

const out = new URL('../public/garden/assets/crops/', import.meta.url);
const leafFill = 'url(#leaf)';
const stem = (d, width = 13) => `<path d="${d}" fill="none" stroke="#368f25" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const leaf = (x, y, size, side, kind) => {
  const shape = kind === 'tomato'
    ? 'M0 0 Q-13-18-19-22 L-17-32 Q-29-29-32-37 Q-48-37-49-54 Q-59-65-79-59 Q-88-42-73-27 Q-66-15-48-16 Q-35-5-23-9 Q-12-2 0 0Z'
    : 'M0 0 Q-13-17-25-18 Q-56-45-77-52 Q-91-48-88-31 Q-82-7-55-9 Q-27-7 0 0Z';
  return `<g transform="translate(${x} ${y}) scale(${side * size} ${size})"><path d="${shape}" fill="${leafFill}"/><path d="M-3-2 Q-39-20-68-39" fill="none" stroke="#368f25" stroke-width="2.5" opacity=".42" stroke-linecap="round"/></g>`;
};
const flower = (x, y, color, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0-29 Q11-27 9-10 Q26-21 30-9 Q30 0 12 5 Q27 18 18 26 Q8 31 0 12 Q-8 31-18 26 Q-27 17-12 5 Q-30 0-30-9 Q-26-21-9-10 Q-11-27 0-29Z" fill="${color}"/><circle cy="0" r="7" fill="#e9ad15"/></g>`;
const tomato = (x, y, r) => `<g><circle cx="${x}" cy="${y}" r="${r}" fill="url(#tomato)"/><path d="M${x} ${y-r+4} l-9-6 7 2 2-8 3 8 8-2-7 6 4 5-8-3-8 3Z" fill="#307b24"/><ellipse cx="${x-r*.38}" cy="${y-r*.36}" rx="${r*.19}" ry="${r*.31}" transform="rotate(34 ${x-r*.38} ${y-r*.36})" fill="#ffad8d" opacity=".65"/></g>`;
const potato = (x, y, rx, ry) => `<g><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#potato)"/><circle cx="${x-rx*.38}" cy="${y-ry*.2}" r="3" fill="#bc852f"/><circle cx="${x+rx*.28}" cy="${y+ry*.28}" r="2.5" fill="#bc852f"/></g>`;

function plant(kind, stage) {
  if (stage === 1) return `${stem('M256 437V374', 20)}<ellipse cx="210" cy="362" rx="52" ry="28" transform="rotate(10 210 362)" fill="${leafFill}"/><ellipse cx="302" cy="362" rx="52" ry="28" transform="rotate(-10 302 362)" fill="${leafFill}"/>`;
  if (stage === 2) return `${stem('M256 438V273')}${stem('M256 354Q228 321 184 315', 10)}${stem('M256 354Q284 324 329 315', 10)}${leaf(256, 326, 1.0, 1, kind)}${leaf(245, 354, .88, 1, kind)}${leaf(268, 354, .88, -1, kind)}`;
  const body = `${stem('M256 439V170')}${stem('M255 355Q210 297 143 295', 10)}${stem('M256 354Q307 294 370 291', 10)}${stem('M255 270Q218 226 184 225', 9)}${stem('M258 269Q297 224 329 223', 9)}${leaf(256, 228, 1.04, 1, kind)}${leaf(211, 300, 1.1, 1, kind)}${leaf(300, 300, 1.1, -1, kind)}${leaf(219, 376, 1.0, 1, kind)}${leaf(295, 376, 1.0, -1, kind)}`;
  if (stage === 3) return body + (kind === 'tomato' ? `${flower(201, 312, '#ffda49', .82)}${flower(319, 340, '#ffda49', .7)}` : `${flower(208, 311, '#b78cdb', .9)}${flower(315, 335, '#b78cdb', .75)}`);
  return body + (kind === 'tomato'
    ? `${stem('M205 323Q186 335 179 349', 5)}${stem('M205 323Q225 340 230 356', 5)}${stem('M310 319Q326 333 335 351', 5)}${tomato(177, 372, 28)}${tomato(229, 377, 25)}${tomato(336, 375, 29)}${tomato(298, 396, 23)}`
    : `${flower(204, 308, '#b78cdb', .68)}${potato(194, 422, 33, 23)}${potato(255, 417, 39, 27)}${potato(320, 425, 32, 22)}`);
}

for (const kind of ['tomato', 'potato']) {
  for (let stage = 1; stage <= 4; stage++) {
    const art = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="leaf" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#94d864"/><stop offset="1" stop-color="#459e34"/></linearGradient><radialGradient id="tomato"><stop stop-color="#ff6b48"/><stop offset="1" stop-color="#e82c1e"/></radialGradient><radialGradient id="potato"><stop stop-color="#f6d781"/><stop offset="1" stop-color="#d8a34b"/></radialGradient></defs>${plant(kind, stage)}</svg>`;
    writeFileSync(new URL(`${kind}-${stage}.svg`, out), art);
  }
}
