'use strict';
window.GardenGrowth = {
  labels: ['심음', '새싹', '성장', '개화', '열매'],
  elapsed(plantedAt, today) {
    const days = Math.floor((Date.parse(today) - Date.parse(plantedAt)) / 86400000);
    return Number.isFinite(days) ? Math.max(0, days) : 0;
  },
  stage(plant, totalDays, today) {
    if (plant.harvestedAt) return 5;
    const elapsed = this.elapsed(plant.plantedAt, today);
    const age = elapsed + (plant.method === 'seedling' ? Math.ceil(totalDays * .3) : 0);
    if (age >= totalDays) return 5;
    if (age >= Math.ceil(totalDays * .65)) return 4;
    if (age >= Math.ceil(totalDays * .3)) return 3;
    if (age >= Math.ceil(totalDays * .1)) return 2;
    return 1;
  },
};
