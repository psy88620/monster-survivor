// Seeded dice for the simulation. In a LAN game every PC runs the same simulation from the same inputs,
// so every PC must roll the same numbers. Visual-only randomness (particles, sounds, dungeon decoration)
// keeps using Math.random, so a PC that draws more or fewer effects never falls out of step.
let s = 1;
export const seed = (n) => { s = n >>> 0; };
export const rngState = () => s >>> 0;   // for the out-of-step check
export function rand() {   // mulberry32
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
