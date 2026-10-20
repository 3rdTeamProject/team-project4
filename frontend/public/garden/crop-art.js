'use strict';
// Shared vector illustrations, using the app palette at every size.
window.CropArt = (() => {
  const cropBounds = {"zucchini-1": "178 337 159 106", "lettuce-2": "106 254 300 189", "pepper-4": "66 3 387 440", "pepper-2": "165 219 185 224", "zucchini-4": "26 69 461 374", "eggplant-4": "29 28 442 415", "cucumber-3": "91 28 331 415", "cucumber-2": "125 220 262 223", "cucumber-1": "178 337 159 106", "pepper-1": "178 337 159 106", "pepper-3": "76 45 357 398", "eggplant-3": "65 73 398 370", "eggplant-2": "104 162 305 280", "lettuce-1": "178 337 159 106", "eggplant-1": "178 337 159 106", "zucchini-2": "95 260 323 183", "lettuce-3": "54 216 405 227", "lettuce-4": "37 146 438 297", "zucchini-3": "31 160 452 283", "cucumber-4": "68 0 369 444"};
  const leaf = (x,y,angle=0,size=1) => `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${size})"><path d="M0 0C-25-1-35-20-26-35C-8-36 5-17 0 0Z" fill="var(--color-green-main)"/><path d="M0 0-22-28" stroke="var(--color-green-dark)" stroke-width="2" stroke-linecap="round"/><path d="m-10-12-11-2m7-5-1-8" stroke="var(--color-green-dark)" stroke-width="1" opacity=".45"/></g>`;
  const foliage = `<path d="M80 139V52" stroke="var(--color-green-dark)" stroke-width="4" stroke-linecap="round"/>${leaf(80,109,-28,.85)}${leaf(80,93,90,.9)}${leaf(80,75,-16,.7)}${leaf(80,58,90,.65)}`;
  const tomato = `<g transform="translate(42 78)"><path d="M0 0C-26-15-33 22-17 33C-1 45 22 27 19 10C17-2 8-6 0 0Z" fill="var(--color-red-dot)"/><path d="m0 1-12-6 9 1 2-10 4 9 11-3-8 8 7 6-13-3-7 5Z" fill="var(--color-green-dark)"/><path d="M-19 10c-4 8-1 14 3 17" fill="none" stroke="var(--color-card)" stroke-width="4" stroke-linecap="round" opacity=".45"/></g><g transform="translate(105 65) scale(.8)"><path d="M0 0C-26-15-33 22-17 33C-1 45 22 27 19 10C17-2 8-6 0 0Z" fill="var(--color-red-dot)"/><path d="m0 1-12-6 9 1 2-10 4 9 11-3-8 8 7 6-13-3-7 5Z" fill="var(--color-green-dark)"/></g>`;
  const cucumber = `<g transform="rotate(17 107 94)"><path d="M103 56c-11 0-15 12-14 29l3 36c2 16 18 16 24 4 6-13 1-38-2-56-1-9-5-13-11-13Z" fill="var(--color-green-dark)"/><path d="M100 65c-4 15 0 38 3 54" fill="none" stroke="var(--color-green-leaf)" stroke-width="5" stroke-linecap="round"/>${[0,1,2,3].map(i=>`<circle cx="111" cy="${77+i*13}" r="1.6" fill="var(--color-green-main)"/>`).join('')}</g>`;
  const pepper = `<path d="M109 64c16 3 24 20 14 43-8 18-20 23-32 21 14-12 18-28 10-44-5-11-3-18 8-20Z" fill="var(--color-red-dot)"/><path d="m104 69 2-11 8-5 2 12 9 9-14-2Z" fill="var(--color-green-dark)"/><path d="M115 79c6 13 1 27-5 33" fill="none" stroke="var(--color-card)" stroke-width="3" opacity=".4" stroke-linecap="round"/>`;
  const eggplant = `<path d="M107 70c-7 4-4 14-11 22-17 17-9 39 8 42 24 4 32-17 25-34-4-10-9-27-22-30Z" fill="var(--color-text)"/><path d="m103 77 0-13 7-9 3 12 11 11-11-3-6 10Z" fill="var(--color-green-dark)"/><path d="M102 94c-10 14-7 23-1 29" fill="none" stroke="var(--color-card)" stroke-width="5" opacity=".4" stroke-linecap="round"/>`;
  const zucchini = `<g transform="rotate(-20 100 110)"><path d="M83 80c-3 15-5 43 1 53 5 7 22 9 29 1 7-9 4-40-2-53Z" fill="var(--color-green-main)"/><path d="M91 84v43m12-43 3 45" stroke="var(--color-green-dark)" stroke-width="3" opacity=".5" stroke-linecap="round"/><path d="m89 80-1-11 15 1 2 10Z" fill="var(--color-green-dark)"/><path d="m98 134-6 8 10-3 6 4-2-9Z" fill="var(--color-point-chip)"/></g>`;
  const lettuce = `<g stroke="var(--color-green-dark)" stroke-width="1.5"><path d="M81 142C42 139 19 114 32 95c-9-13 2-28 14-24-1-20 21-24 31-9 10-17 30-8 29 6 19-8 31 9 24 23 18 19 1 46-49 51Z" fill="var(--color-green-main)"/><path d="M79 139c-29-13-38-32-28-43-4-13 11-22 22-13 0-17 24-20 29-1 19 1 23 26 6 37Z" fill="var(--color-green-leaf)"/><path d="M79 139V93m0 32-18-20m18 15 20-23" fill="none" stroke-linecap="round"/></g>`;
  const mature = {tomato,cucumber,pepper,eggplant,zucchini,lettuce};
  // Ignore transparent margins so these PNGs use the same visual scale as other crops.
  const originalBounds = {
    'tomato-1': '175 334 165 112',
    'tomato-2': '248 322 761 681',
    'tomato-3': '82 118 1116 1034',
    'tomato-4': '58 87 1149 1043',
  };
  function svg(kind,stage=5,preview=false) {
    if(stage===1) {
      return '<svg class="plant-art vector-crop" viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-20 32 53)"><path d="M23 18h18v23l-6 5-3 12-3-12-6-5Z" fill="var(--color-point-chip)" stroke="var(--color-point-text)" stroke-width="2" stroke-linejoin="round"/><path d="M27 12h10v6H27z" fill="var(--color-point-chip)" stroke="var(--color-point-text)" stroke-width="2"/><rect x="26" y="25" width="12" height="13" rx="2" fill="var(--color-green-main)"/><path d="M32 27c-3 4-4 7 0 9 4-2 3-5 0-9Z" fill="var(--color-card)"/></g><ellipse cx="32" cy="55" rx="27" ry="6" fill="var(--color-soil)"/></svg>';
    }
    const key=`${kind}-${stage-1}`;
    if(kind==='tomato') {
      const size=stage===2?512:1254;
      return `<svg class="plant-art vector-crop original-crop crop-${kind}" viewBox="${originalBounds[key]}" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><image href="assets/crops/${key}.png" width="${size}" height="${size}"/></svg>`;
    }
    if(cropBounds[key]) {
      return `<svg class="plant-art vector-crop original-crop crop-${kind}" viewBox="${cropBounds[key]}" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><image href="assets/crops/${key}.png" width="512" height="512"/></svg>`;
    }
    const young = `<path d="M80 140V108" stroke="var(--color-green-dark)" stroke-width="4" stroke-linecap="round"/>${leaf(80,116,-24,.55)}${leaf(80,112,92,.55)}`;
    const body=stage===1?young:kind==='lettuce'?lettuce:foliage+(stage>=3?mature[kind]:'');
    const scale=stage===2?.72:stage===3?.88:1;
    return `<svg class="plant-art vector-crop crop-${kind}" viewBox="0 0 160 160" fill="none" aria-hidden="true"><g transform="translate(${80*(1-scale)} ${142*(1-scale)}) scale(${scale})">${body}</g></svg>`;
  }
  return {svg};
})();
