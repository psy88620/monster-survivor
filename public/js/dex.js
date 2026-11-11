// Bestiary: which monsters you have met and caught, kept in this browser between runs.
const KEY = 'monster-survivor.dex';
let data = { seen: {}, caught: {}, kills: {}, bosses: {} };
try { data = { seen: {}, caught: {}, kills: {}, bosses: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* private mode: start empty */ }
let dirty = false;
const save = () => { if (!dirty) return; dirty = false; try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ } };
setInterval(save, 3000);

export const dex = {
  see(key) { if (!data.seen[key]) { data.seen[key] = 1; dirty = true; } },
  catch(key) { this.see(key); if (data.caught[key]) return false; data.caught[key] = 1; dirty = true; save(); return true; },   // true: a new species
  kill(key) { data.kills[key] = (data.kills[key] || 0) + 1; dirty = true; },
  beat(name) { if (!data.bosses[name]) { data.bosses[name] = 1; dirty = true; save(); } },
  kills: (key) => data.kills[key] || 0,
  beaten: (name) => !!data.bosses[name],
  seen: (key) => !!data.seen[key],
  caught: (key) => !!data.caught[key],
};
