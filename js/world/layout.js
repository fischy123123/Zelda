// The hand-authored map of Aurelia. Pure data — Terrain flattens build sites,
// World populates them, UI draws them on the map. Coordinates are world units;
// north is -Z. The playable valley spans roughly a 700-unit radius ring of
// impassable peaks.

export const WORLD = {
  seed: 'aurelia-v1',
  size: 1700,          // terrain mesh spans ±size/2
  playRadius: 700,     // soft gameplay boundary (rim mountains beyond)
  waterLevel: 0.0,
  dayLength: 600,      // seconds for a full day/night cycle
};

// Flattened build sites: terrain blends to height `h` inside radius `r`.
export const SITES = {
  village:  { x: 60,   z: -20,  r: 95,  h: 10.0, name: 'Brindlemere' },
  shrine:   { x: -150, z: -520, r: 46,  h: 15.0, name: 'The Hollow Shrine' },
  ruins:    { x: 380,  z: -330, r: 42,  h: 22.0, name: 'Skywatch Ruins' },
  lakeDock: { x: -285, z: 135,  r: 26,  h: 2.2,  name: 'Mirrowmere Shore' },
  camp1:    { x: 285,  z: -160, r: 26,  h: 12.0 },
  camp2:    { x: -270, z: -230, r: 24,  h: 13.0 },
  camp3:    { x: 430,  z: 150,  r: 26,  h: 12.0 },
  camp4:    { x: 120,  z: -470, r: 24,  h: 14.0 },
  camp5:    { x: -60,  z: 420,  r: 26,  h: 10.0 },
};

export const LAKE = { x: -430, z: 210, r: 215 };      // Mirrowmere
export const BADLANDS = { x: 430, z: 430, r: 300 };   // Cinder Flats (SE)
export const FOREST_BAND = { z: -260, depth: 420 };   // Elderwood (north band)

export const SPAWN = { x: 18, z: 30 };

// Dungeon interior is built far outside the overworld and reached by teleport.
export const DUNGEON_ORIGIN = { x: 3000, y: 0, z: 3000 };

// Named regions for the "region splash" UI, tested in order (first hit wins).
export const REGIONS = [
  { name: 'Brindlemere Village', test: (x, z) => dist(x, z, SITES.village) < SITES.village.r },
  { name: 'The Hollow Shrine',   test: (x, z) => dist(x, z, SITES.shrine) < SITES.shrine.r + 30 },
  { name: 'Skywatch Ruins',      test: (x, z) => dist(x, z, SITES.ruins) < SITES.ruins.r + 20 },
  { name: 'Mirrowmere',          test: (x, z) => dist(x, z, LAKE) < LAKE.r + 40 },
  { name: 'Cinder Flats',        test: (x, z) => dist(x, z, BADLANDS) < BADLANDS.r },
  { name: 'The Elderwood',       test: (x, z) => z < FOREST_BAND.z && z > FOREST_BAND.z - FOREST_BAND.depth && Math.abs(x) < 620 },
  { name: 'Aurel Fields',        test: () => true },
];

function dist(x, z, p) { const dx = x - p.x, dz = z - p.z; return Math.sqrt(dx * dx + dz * dz); }

export function regionAt(x, z) {
  for (const r of REGIONS) if (r.test(x, z)) return r.name;
  return 'Aurel Fields';
}
