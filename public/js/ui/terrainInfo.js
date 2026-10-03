// What a battlefield's special tiles and devices do — the briefing's 地图特性 list and the card a tap on such a tile opens
// (screens/game.js 'tileClick'). The texts follow the simulation (server/sim/content/devices.js, server/match/board.js)
// and read the stage's own numbers (data/stages.json `special` blocks, device stats); the official client has no such
// texts in its tables, so they are the remake's.
//
//   stageFeatures(stage)          [{ id, kind: 'terrain'|'device', name, text, optional? }] present on the stage
//   tileFeatures(stage, row, col) the features of one tile (its terrain, a device on it, the airflow it lies in)

const TERRAIN_BY_KEY = Object.freeze({ tile_infection: 'infection', tile_smog: 'smog', tile_deepsea: 'deepsea', tile_deepwater: 'deepsea', tile_mire: 'mire' });
/** Device roles worth a card (the rest: scenery or devices of stages out of the rotation). */
const DEVICE_ROLES = Object.freeze(['blower', 'crate', 'platform', 'turret']);
const DIR_NAME = Object.freeze({ UP: '向上', DOWN: '向下', LEFT: '向左', RIGHT: '向右' });

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v) => (v > 0 ? `+${v}` : `${v}`);
/** ASPD blackboard value: a fraction (|v| < 1) is ×100 ASPD (devices.js aspdOf). */
const aspd = (v) => Math.round(Math.abs(v) < 1 ? v * 100 : v);
const bbOf = (stage, key) => {
  const s = stage && stage.special && stage.special[key];
  return (s && typeof s === 'object' && (s.bb && typeof s.bb === 'object' ? s.bb : s)) || {};
};

/** The card of a terrain type on `stage` (null: unknown type). */
export function terrainFeature(type, stage) {
  if (type === 'infection') {
    const b = bbOf(stage, 'infection');
    return {
      id: 'infection', kind: 'terrain', name: '活性源石',
      text: `站在上面的单位（干员和地面敌人）攻击力 +${pct(num(b.atk, 0.2))}、攻击速度 ${signed(aspd(num(b.attack_speed, 20)))}，但每秒受到 ${num(b.damage, 70)} 点真实伤害。适合放有治疗照顾的输出位。`,
    };
  }
  if (type === 'smog') {
    return {
      id: 'smog', kind: 'terrain', name: '排气格栅',
      text: '站在上面的干员被烟雾遮挡，不会被敌人的远程攻击选中（如同隐匿）；被它阻挡的敌人仍然可以攻击它。',
    };
  }
  if (type === 'deepsea') {
    const b = bbOf(stage, 'deepsea');
    return {
      id: 'deepsea', kind: 'terrain', name: '深水',
      text: `地面敌人在上面每秒受到 ${num(b['sea_drown[enemy].damage'], 40)} 点真实伤害，攻击速度 ${signed(aspd(num(b['sea_drown[enemy].attack_speed'], -0.6)))}，移动速度降为 ${pct(num(b['sea_drown[enemy].move_speed'], 0.6))}。`,
    };
  }
  if (type === 'mire') {
    const b = bbOf(stage, 'mire');
    return {
      id: 'mire', kind: 'terrain', name: '沼泽',
      text: `进入时叠 1 层泥沼，之后每 ${num(b.intervalSec, 3)} 秒再叠 1 层（最多 ${num(b.maxStacks, 10)} 层），每层攻击速度 ${signed(aspd(num(b.aspdPerStack, -0.05)))}、移动速度 ${signed(Math.round(num(b.moveMulPerStack, -0.05) * 100))}%；离开即清除。干员和地面敌人都受影响。`,
    };
  }
  return null;
}

/** The card of a device (null: a role without one). */
export function deviceFeature(dev, stage) {
  const role = dev && dev.role;
  if (role === 'blower') {
    const b = Object.keys(bbOf(stage, 'blower')).length ? bbOf(stage, 'blower') : (dev.skill && dev.skill.bb) || {};
    const eq = num(b['blower_s_character[equal].atk'], 0.3);
    const op = num(b['blower_s_character[opposite].atk'], -0.3);
    const ve = num(b['blower_s_character[vertical].atk'], 0);
    const en = num(b['blower_s_enemy[equal].move_speed'], 0.5);
    const eo = num(b['blower_s_enemy[opposite].move_speed'], -0.5);
    return {
      id: 'blower', kind: 'device', name: '源石流发生装置',
      text: `沿风向${DIR_NAME[dev.dir] ? `（${DIR_NAME[dev.dir]}）` : ''}吹出源石流。站在源石流中的干员：朝向与风向相同时攻击力 ${signed(Math.round(eq * 100))}%，相反时 ${signed(Math.round(op * 100))}%${ve ? `，垂直时 ${signed(Math.round(ve * 100))}%` : '，垂直时不变'}（部署时用方向轮盘选择朝向）。敌人顺风移动速度 ${signed(Math.round(en * 100))}%，逆风 ${signed(Math.round(eo * 100))}%。`,
    };
  }
  if (role === 'crate') {
    const hp = num(dev.stats && dev.stats.maxHp, 100);
    return { id: 'crate', kind: 'device', name: dev.name || '阻隔工事', text: `路上的障碍物：敌人会尽量绕开它；被它挡住的敌人会攻击并摧毁它（${hp} 生命值）。` };
  }
  if (role === 'platform') {
    return { id: 'platform', kind: 'device', name: dev.name || '射击台', text: '敌人无法通过的高台，只能部署远程干员。' };
  }
  if (role === 'turret') {
    return {
      id: 'turret', kind: 'device', name: dev.name || '“双眼皮”',
      text: '自动用法术攻击射程内的敌人，命中附带脆弱；攻击速度和脆弱随你最高的盟约层数提升。默认不出现，由策略或机变卡开启。',
    };
  }
  return null;
}

/** Terrain type of the tile at (row, col), or null. */
function terrainAt(stage, row, col) {
  const line = Array.isArray(stage && stage.rows) ? stage.rows[row] : null;
  const ch = typeof line === 'string' ? line[col] : null;
  const key = ch && stage.tiles && stage.tiles[ch] ? stage.tiles[ch].tileKey : null;
  return key ? TERRAIN_BY_KEY[key] || null : null;
}

const isOn = (dev) => dev && dev.active !== false && !dev.hidden;
const samePos = (p, row, col) => Array.isArray(p) && p[0] === row && p[1] === col;

/** Every special tile type and device role on the stage, in reading order (devices that start off: optional). */
export function stageFeatures(stage) {
  if (!stage) return [];
  const out = [];
  const seen = new Set();
  const rows = Array.isArray(stage.rows) ? stage.rows : [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r] || '').length; c++) {
      const t = terrainAt(stage, r, c);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      const f = terrainFeature(t, stage);
      if (f) out.push(f);
    }
  }
  for (const dev of Array.isArray(stage.devices) ? stage.devices : []) {
    if (!DEVICE_ROLES.includes(dev && dev.role)) continue;
    const on = isOn(dev);
    const key = `d:${dev.role}`;
    const prev = out.find((f) => f.key === key);
    if (prev) { if (on) prev.optional = false; continue; }
    const f = deviceFeature(dev, stage);
    if (f) out.push({ ...f, key, optional: !on });
  }
  return out;
}

/** The features of one tile: its terrain, a device standing on it (also one that is off), the airflow over it. */
export function tileFeatures(stage, row, col) {
  if (!stage || !Number.isInteger(row) || !Number.isInteger(col)) return [];
  const out = [];
  const t = terrainAt(stage, row, col);
  if (t) { const f = terrainFeature(t, stage); if (f) out.push(f); }
  for (const dev of Array.isArray(stage.devices) ? stage.devices : []) {
    if (!DEVICE_ROLES.includes(dev && dev.role)) continue;
    const here = samePos(dev.pos, row, col);
    const inFlow = dev.role === 'blower' && isOn(dev) && Array.isArray(dev.rangeTiles) && dev.rangeTiles.some((p) => samePos(p, row, col));
    if (!here && !inFlow) continue;
    if (dev.role !== 'blower' && !isOn(dev)) continue; // a crate / platform / turret that is off is not on the board
    const f = deviceFeature(dev, stage);
    if (f && !out.some((x) => x.id === f.id)) out.push(here || dev.role !== 'blower' ? f : { ...f, name: `${f.name}（源石流范围）` });
  }
  return out;
}
