'use strict';

const LS_KEY = 'gamenight:v2';        // dados no modo "só neste aparelho"
const GROUP_KEY = 'gamenight:group';  // { code, pin, version, dirty }
const PREF_KEY = 'gamenight:prefs';   // { muted, local }
const MAX_PLAYERS = 20;
const PALETTE = [
  '#ff2a6d', '#05d9e8', '#3cff7a', '#ffe14d', '#ff77a8', '#ffa300', '#b98cff', '#ffccaa', '#29adff', '#a8e72e',
  '#ff6c24', '#3fe0d0', '#e04fff', '#ffffff', '#00b543', '#ff9d81', '#c2c3c7', '#f5d76e', '#7ec8ff', '#ff4f4f',
];
// cores fixas por nome (palavra inteira, sem acento/maiúscula). Ficam reservadas para essas pessoas.
const FIXED_COLORS = { lucas: '#29adff' };
const RESERVED_COLORS = new Set(Object.values(FIXED_COLORS));
const TEAM_COLORS = ['#ff2a6d', '#05d9e8', '#3cff7a', '#ffe14d', '#b98cff', '#ffa300', '#ff77a8', '#29adff', '#a8e72e', '#ffffff'];
const ICONS = ['🎲', '🃏', '♟️', '🎯', '🎮', '🕹️', '👾', '🧩', '🎤', '🏓', '⚽', '🎳', '🍺', '💣', '🀄', '🏆'];
const TYPES = {
  vitoria: { label: 'VENCEU', desc: 'Botão "Venceu" em cada um. Cada toque = 1 vitória na noite.', card: 'Venceu = 1★' },
  pontos: { label: 'PONTOS', desc: 'Botão "Acertou" (+1). Ao finalizar, quem fez mais ganha 1 vitória.', card: '+1 por acerto' },
  vidas: { label: 'VIDAS', desc: 'Todos começam com X vidas. Último com vidas ganha 1 vitória.', card: 'Eliminação ♥' },
  timer: { label: 'TIMER', desc: 'Contagem regressiva + "Acertou". Ao finalizar, o vencedor ganha 1 vitória.', card: 'Timer ⏱' },
};
const FORMATS = { solo: 'CADA UM POR SI', duplas: 'DUPLAS', grupos: 'GRUPOS' };
const LIMITS = { lives: [1, 20], seconds: [10, 600], groups: [2, 10] };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const fmtClock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const ymd = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ================= estado ================= */

const defaultState = () => ({
  players: [], night: null, sessions: [], active: null,
  customGames: [], settings: {}, lastSummary: null,
});

const readJSON = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const prefs = readJSON(PREF_KEY, {});
let group = readJSON(GROUP_KEY, null);
const cacheKey = () => (group ? `gamenight:g:${group.code}` : LS_KEY);

let state = load();
if (prefs.muted === undefined) prefs.muted = !!state.muted;
delete state.muted;
applyFixedColors();
const ui = { tab: 'jogos' };

function load() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch {}
  return defaultState();
}

function fixedColor(name) {
  const words = norm(name).split(/[^a-z0-9]+/);
  const key = Object.keys(FIXED_COLORS).find(k => words.includes(k));
  return key ? FIXED_COLORS[key] : null;
}

function freeColor(used) {
  const pool = PALETTE.filter(c => !RESERVED_COLORS.has(c));
  return pool.find(c => !used.has(c)) || pool[used.size % pool.length];
}

// aplica as cores fixas e tira cores reservadas de quem não é dono delas
function applyFixedColors() {
  const used = new Set();
  state.players.forEach(p => {
    const fixed = fixedColor(p.name);
    if (fixed) p.color = fixed;
    else if (RESERVED_COLORS.has(p.color) || used.has(p.color)) p.color = freeColor(new Set([...used, ...state.players.map(x => x.color)]));
    used.add(p.color);
  });
}

function save() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch {}
  if (group && canEdit()) schedulePush();
}

const allGames = () => [
  ...(window.PRESET_GAMES || []).map(g => ({ ...g, preset: true })),
  ...state.customGames,
].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
const findGame = id => allGames().find(g => g.id === id);
const playerById = id => state.players.find(p => p.id === id);
const activePlayers = () => state.players.filter(p => !p.out);
const gameSetting = (g, k, def) => state.settings[g.id]?.[k] ?? g[k] ?? def;

function setGameSetting(gameId, k, v) {
  state.settings[gameId] = { ...state.settings[gameId], [k]: v };
}

// vitórias de um jogo tipo "vitoria": cada ponto vale 1 vitória para cada membro
function awardsFromScore(comps, score) {
  const out = {};
  for (const c of comps) {
    const n = score[c.id] || 0;
    if (n) c.members.forEach(pid => (out[pid] = (out[pid] || 0) + n));
  }
  return out;
}

// Ranking da noite: soma das vitórias individuais (inclui o jogo "vitoria" em andamento)
function standings() {
  const map = new Map(state.players.map(p => [p.id, { ...p, wins: 0, played: 0 }]));
  const add = awards => {
    for (const [pid, n] of Object.entries(awards)) {
      const s = map.get(pid);
      if (s) s.wins += n;
    }
  };
  for (const s of state.sessions) {
    add(s.awards);
    s.players.forEach(pid => map.get(pid) && map.get(pid).played++);
  }
  const a = state.active;
  if (a?.type === 'vitoria') add(awardsFromScore(a.comps, a.data.score));
  const list = [...map.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  return list.map((s, i) => {
    if (!prev || s.wins !== prev.wins) rank = i + 1;
    prev = s;
    return { ...s, rank };
  });
}

// posição de cada competidor pelo placar (empates dividem a posição)
function rankMap(comps, score) {
  const sorted = [...comps].sort((a, b) => (score[b.id] || 0) - (score[a.id] || 0));
  const out = {};
  let rank = 0, prev = null;
  sorted.forEach((c, i) => {
    const v = score[c.id] || 0;
    if (prev === null || v !== prev) rank = i + 1;
    prev = v;
    out[c.id] = rank;
  });
  return out;
}

const leadersOf = (comps, score) => {
  const max = Math.max(0, ...comps.map(c => score[c.id] || 0));
  return max ? comps.filter(c => (score[c.id] || 0) === max) : [];
};

/* ================= som, vibração, tela ================= */

let actx;
function audio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state !== 'running') actx.resume();
  } catch {}
  return actx;
}

function tone(freqs, step, dur, gain) {
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = f;
    g.gain.setValueAtTime(gain, t0 + i * step);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + i * step + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * step);
    o.stop(t0 + i * step + dur + 0.01);
  });
}

function blip(type = 'ok') {
  if (prefs.muted) return;
  try { navigator.vibrate?.(type === 'win' ? [30, 40, 30] : type === 'err' ? [60, 30, 60] : 12); } catch {}
  const seq = { ok: [660, 880], add: [523, 784], del: [330, 220], win: [523, 659, 784, 1046], err: [200, 140] }[type] || [660];
  try { tone(seq, 0.08, 0.075, 0.05); } catch {}
}

// No iOS o Web Audio respeita a chave de silencioso. Durante o alarme pedimos sessão "playback"
// (Safari 16.4+) e depois voltamos ao padrão, para os bipes não pausarem a música de outros apps.
let sessionTimer;
function loudSession(ms) {
  try {
    if (!navigator.audioSession) return;
    navigator.audioSession.type = 'playback';
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => { try { navigator.audioSession.type = 'auto'; } catch {} }, ms);
  } catch {}
}

// WAV de ~2s com bipes quadrados alternados, tocado por <audio> (mais confiável no iOS)
function alarmWavUrl() {
  const rate = 22050, secs = 2, n = rate * secs;
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((ch, i) => buf.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, 'data'); buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate, seg = Math.floor(t / 0.2), inSeg = t - seg * 0.2;
    const f = seg % 2 ? 880 : 1320;
    const v = inSeg < 0.18 ? (Math.sin(2 * Math.PI * f * t) >= 0 ? 0.7 : -0.7) : 0;
    buf.setInt16(44 + i * 2, v * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

let alarmEl = null;
// precisa ser chamado dentro de um toque (ex.: botão VAI!) para o iOS liberar o play depois
function unlockAlarm() {
  try {
    if (!alarmEl) {
      alarmEl = new Audio(alarmWavUrl());
      alarmEl.preload = 'auto';
    }
    if (!alarmEl.paused) return; // já está tocando (ex.: teste), então já foi liberado
    alarmEl.muted = true;
    const p = alarmEl.play();
    const reset = () => { alarmEl.pause(); alarmEl.currentTime = 0; alarmEl.muted = false; };
    p?.then ? p.then(reset).catch(() => (alarmEl.muted = false)) : reset();
  } catch {}
}

// alarme alto de ~2s (toca mesmo com o som de interface desligado)
function alarm() {
  loudSession(2500);
  let played = false;
  try {
    if (alarmEl) {
      alarmEl.muted = false;
      alarmEl.currentTime = 0;
      const p = alarmEl.play();
      played = true;
      p?.catch?.(() => tone(Array.from({ length: 10 }, (_, i) => (i % 2 ? 880 : 1320)), 0.2, 0.18, 0.5));
    }
  } catch {}
  if (!played) {
    try { tone(Array.from({ length: 10 }, (_, i) => (i % 2 ? 880 : 1320)), 0.2, 0.18, 0.5); } catch {}
  }
  try { navigator.vibrate?.([400, 100, 400, 100, 400, 100, 400]); } catch {}
  document.body.classList.add('alarm');
  setTimeout(() => document.body.classList.remove('alarm'), 2000);
}

let wakeLock = null, wakePending = false, wakeWanted = false;
async function keepAwake(on) {
  wakeWanted = on;
  try {
    if (on && !wakeLock && !wakePending && navigator.wakeLock) {
      wakePending = true;
      const lock = await navigator.wakeLock.request('screen');
      wakePending = false;
      if (!wakeWanted) return lock.release(); // o jogo acabou enquanto o pedido estava pendente
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } else if (!on && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch {
    wakePending = false;
  }
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  if (kind === 'err') blip('err');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
}

/* ================= render ================= */

const app = $('#app');

function render() {
  document.body.classList.toggle('readonly', !canEdit());
  renderTopbar();
  if (!group && !prefs.local) renderGate();
  else state.night ? renderNight() : renderSetup();
  if (!canEdit()) app.insertAdjacentHTML('afterbegin', '<button class="viewer-bar" data-act="askPin">👁 MODO ESPECTADOR · toque para editar com PIN</button>');
  syncTimer();
}

function renderTopbar() {
  $('#nightInfo').innerHTML = `
    ${state.night ? `<span class="live"><span class="live-label">NOITE ATIVA · desde </span>${fmtTime(state.night.startedAt)}</span>` : ''}
    ${group ? `<span class="sync" id="syncDot" data-s="${syncStatus}" title="Sincronização"></span>` : ''}
    <button class="icon-btn" data-act="dataSheet" title="${group ? 'Grupo' : 'Dados'}">${group ? '👥' : '💾'}</button>
    <button class="icon-btn" data-act="toggleMute" title="Som">${prefs.muted ? '🔇' : '🔊'}</button>`;
}

function playerChip(p) {
  return `<li class="chip" style="--c:${p.color}"><span class="dot"></span>${esc(p.name)}
    <button data-act="removePlayer" data-id="${p.id}" aria-label="Remover ${esc(p.name)}">✕</button></li>`;
}

function playersEditor() {
  const n = state.players.length, full = n >= MAX_PLAYERS;
  return `
    <form class="add-row" data-form="addPlayer">
      <input id="playerName" maxlength="16" placeholder="NOME DO JOGADOR" autocomplete="off" ${full ? 'disabled' : ''}>
      <button class="btn btn-cyan" ${full ? 'disabled' : ''}>+ ADD</button>
    </form>
    <div class="counter ${full ? 'full' : ''}">${n}/${MAX_PLAYERS} PLAYERS</div>
    <ul class="player-chips">${state.players.map(playerChip).join('') || '<li class="empty">Nenhum jogador ainda...</li>'}</ul>`;
}

function renderSetup() {
  const s = state.lastSummary;
  app.innerHTML = `
    <section class="panel setup">
      ${group ? '' : '<button class="btn btn-ghost btn-small back-btn" data-act="goOnline">◀ VOLTAR</button>'}
      <h2 class="blink-title">PRESS START</h2>
      <p class="sub">${group ? '' : '📱 Modo só neste aparelho · '}Quem joga hoje? De 1 a ${MAX_PLAYERS} jogadores.</p>
      <div id="playersEditor">${playersEditor()}</div>
      <button class="btn btn-big btn-pink" data-act="startNight" ${state.players.length ? '' : 'disabled'}>▶ COMEÇAR NOITE</button>
    </section>
    ${s ? `
    <section class="panel last-night">
      <div>
        <h2>ÚLTIMA NOITE</h2>
        <div class="muted">${fmtDate(s.endedAt)}</div>
        ${s.ranking[0]?.wins ? `<div>♛ <span style="color:${s.ranking[0].color}">${esc(s.ranking[0].name)}</span> · ${plural(s.ranking[0].wins, 'vitória', 'vitórias')}</div>` : ''}
      </div>
      <button class="btn btn-yellow btn-small" data-act="showSummary">📸 VER RANKING</button>
    </section>` : ''}`;
}

function renderNight() {
  const st = standings();
  const max = Math.max(1, ...st.map(s => s.wins));
  const a = state.active;
  const tabs = [
    ['placar', '🏆', 'RANKING'],
    ['jogos', a ? a.icon : '🎮', a ? 'AO VIVO' : 'JOGOS'],
    ['partidas', '📜', 'PARTIDAS'],
  ];

  app.innerHTML = `
    <div class="grid" data-tab="${ui.tab}">
      <section class="panel score tab-placar">
        <h2>🏆 RANKING DA NOITE</h2>
        <p class="sub small">★ = vitórias · toque num jogador para opções</p>
        <ol class="board">${st.map(s => `
          <li class="row ${s.rank <= 3 && s.wins > 0 ? 'r' + s.rank : ''} ${s.out ? 'out' : ''}" style="--c:${s.color}"
              role="button" tabindex="0" data-act="playerMenu" data-id="${s.id}">
            <span class="pos">${s.rank}º</span><span class="dot"></span>
            <span class="name">${esc(s.name)}${s.out ? ' <em class="tag-out">💤 FORA</em>' : ''}</span>
            <span class="played" title="Partidas jogadas">${s.played}P</span>
            <span class="pts">★${s.wins}</span>
            <span class="bar" style="width:${(s.wins / max) * 100}%"></span>
          </li>`).join('')}
        </ol>
        <div class="score-actions">
          <button class="btn btn-ghost btn-small" data-act="editPlayers">👥 JOGADORES (${state.players.length})</button>
          <button class="btn btn-red btn-small" data-act="endNight">⏹ ENCERRAR NOITE</button>
        </div>
      </section>

      <section class="panel tab-jogos">${a ? liveHtml(a) : gamesHtml()}</section>

      <section class="panel tab-partidas">
        <h2>📜 PARTIDAS (${state.sessions.length})</h2>
        ${historyHtml()}
      </section>
    </div>
    <nav class="tabbar">${tabs.map(([k, icon, label]) => `
      <button class="tab ${ui.tab === k ? 'on' : ''} ${k === 'jogos' && a ? 'is-live' : ''}" data-act="tab" data-tab="${k}">
        <span class="ti">${icon}</span>${label}${k === 'partidas' && state.sessions.length ? `<b>${state.sessions.length}</b>` : ''}
      </button>`).join('')}
    </nav>`;
}

function gamesHtml() {
  const counts = {};
  state.sessions.forEach(s => (counts[s.gameId] = (counts[s.gameId] || 0) + 1));
  return `
    <h2>🎮 ESCOLHA O JOGO</h2>
    <div class="game-grid">
      ${allGames().map(g => `
        <div class="game-card" role="button" tabindex="0" data-act="setupGame" data-id="${g.id}">
          ${counts[g.id] ? `<span class="badge">x${counts[g.id]}</span>` : ''}
          ${g.preset ? '' : `<button class="icon-btn del" data-act="delGame" data-id="${g.id}" aria-label="Excluir jogo">✕</button>`}
          <span class="gi">${g.icon}</span>
          <span class="gn">${esc(g.name)}</span>
          <span class="gs">${TYPES[g.type].card}</span>
        </div>`).join('')}
      <button class="game-card new" data-act="newGame"><span class="gi">+</span><span class="gn">CRIAR JOGO</span></button>
    </div>`;
}

const compName = c => `<span style="color:${c.color}">${esc(c.name)}</span>`;

function sessionResult(s) {
  if (s.type === 'vitoria') {
    const items = s.comps.filter(c => s.score[c.id]).sort((a, b) => s.score[b.id] - s.score[a.id])
      .map(c => `<span style="color:${c.color}">${esc(c.name)} ★${s.score[c.id]}</span>`);
    return items.join('') || '<span class="muted">ninguém venceu</span>';
  }
  const w = s.comps.filter(c => s.winners.includes(c.id));
  return (w.length ? `<span>🏆</span>${w.map(c => compName(c) + (c.sub ? ` <span class="muted">(${esc(c.sub)})</span>` : '')).join('')}` : '<span class="muted">ninguém venceu</span>')
    + (s.detail ? `<span class="muted">${esc(s.detail)}</span>` : '');
}

function historyHtml() {
  if (!state.sessions.length) return '<p class="empty">Nenhuma partida ainda. Escolha um jogo!</p>';
  return `<ul class="hist">${[...state.sessions].reverse().map(s => `
    <li>
      <div class="hh"><span class="gname">${s.icon} ${esc(s.gameName)}</span><time>${fmtTime(s.ts)}</time>
        <button class="icon-btn" data-act="delSession" data-id="${s.id}" aria-label="Apagar partida">✕</button></div>
      <div class="hf">${FORMATS[s.format]}</div>
      <div class="hr">${sessionResult(s)}</div>
    </li>`).join('')}</ul>`;
}

/* ---------- jogo ao vivo ---------- */

function liveHtml(a) {
  const body = { vitoria: bodyScore, pontos: bodyScore, vidas: bodyLives, timer: bodyTimer }[a.type](a);
  return `
    <div class="lg-head">
      <span class="lg-icon">${a.icon}</span>
      <div><h2>${esc(a.gameName)}</h2><span class="tag">${FORMATS[a.format]}</span></div>
    </div>
    ${a.rules ? `<p class="rules">${esc(a.rules)}</p>` : ''}
    ${body}
    <div class="lg-actions">
      <button class="btn btn-ghost" data-act="cancelGame">✕ CANCELAR</button>
      <button class="btn btn-yellow" data-act="finishGame">🏁 FINALIZAR</button>
    </div>`;
}

function leaderHtml(a, unit) {
  const score = a.data.score;
  const l = leadersOf(a.comps, score);
  if (!l.length) return '<div class="leader muted">Ninguém pontuou ainda</div>';
  return `<div class="leader">👑 ${l.map(compName).join(' · ')} <b>${score[l[0].id]} ${unit}</b></div>`;
}

function scoreList(a, { act, label, turn } = {}) {
  const score = a.data.score, ranks = rankMap(a.comps, score);
  return `<div class="cc-list">${a.comps.map((c, i) => {
    const v = score[c.id] || 0;
    return `
      <div class="cc ${turn === i ? 'turn' : ''}" style="--c:${c.color}" ${turn !== undefined ? `role="button" tabindex="0" data-act="setTurn" data-i="${i}"` : ''}>
        <span class="cc-pos r${ranks[c.id]}">${v > 0 ? ranks[c.id] + 'º' : '–'}</span>
        <span class="cc-name">${esc(c.name)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span>
        <span class="cc-score">${v}</span>
        ${act ? `<button class="btn btn-green cc-btn" data-act="${act}" data-cid="${c.id}">${label}</button>` : ''}
      </div>`;
  }).join('')}</div>`;
}

function bodyScore(a) {
  const isWin = a.type === 'vitoria';
  return `
    ${leaderHtml(a, isWin ? '★' : 'PTS')}
    ${scoreList(a, { act: 'addPoint', label: isWin ? 'VENCEU ★' : 'ACERTOU +1' })}
    <div class="undo-row"><button class="btn btn-ghost btn-small" data-act="undoPoint" ${a.data.log.length ? '' : 'disabled'}>↶ DESFAZER ÚLTIMO</button></div>`;
}

function hearts(hp, max) {
  if (max > 10) return `<span class="hearts"><b>♥</b> ×${hp}</span>`;
  return `<span class="hearts">${'<b>♥</b>'.repeat(hp)}${'<i>♥</i>'.repeat(max - hp)}</span>`;
}

function bodyLives(a) {
  const d = a.data;
  const alive = a.comps.filter(c => d.hp[c.id] > 0).length;
  return `
    <div class="round-head"><span>RODADA ${d.round}</span><span>${alive} VIVO${alive === 1 ? '' : 'S'}</span></div>
    <p class="hint">Marque quem tomou ponto e toque em PRÓXIMA RODADA.</p>
    <div class="cc-list">${a.comps.map(c => {
      const hp = d.hp[c.id], dead = hp <= 0, marked = d.marked.includes(c.id);
      return `
        <div class="cc lives ${dead ? 'dead' : ''} ${marked ? 'marked' : ''}" style="--c:${c.color}">
          <span class="cc-name">${esc(c.name)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span>
          ${dead ? '<span class="dead-tag">💀 ELIMINADO</span>' : hearts(hp, d.lives)}
          ${dead ? '' : `<button class="btn ${marked ? 'btn-red' : 'btn-ghost'} cc-btn" data-act="markHit" data-cid="${c.id}">${marked ? '−1 ♥ MARCADO' : 'TOMOU PONTO'}</button>`}
        </div>`;
    }).join('')}</div>
    <button class="btn btn-big btn-pink full" data-act="nextRound">PRÓXIMA RODADA ▶</button>
    <div class="undo-row"><button class="btn btn-ghost btn-small" data-act="undoRound" ${d.history.length ? '' : 'disabled'}>↶ DESFAZER RODADA</button></div>`;
}

function timerRemaining(d) {
  return d.endsAt ? Math.max(0, Math.ceil((d.endsAt - Date.now()) / 1000)) : d.seconds;
}

function bodyTimer(a) {
  const d = a.data, running = !!d.endsAt, cur = a.comps[d.turn];
  return `
    <div class="timer ${running ? 'run' : ''}" id="timerBox">
      <div class="t-turn">
        <button class="icon-btn" data-act="turn" data-d="-1" ${running ? 'disabled' : ''} aria-label="Anterior">◀</button>
        <div><small>VEZ DE</small><b style="color:${cur.color}">${esc(cur.name)}</b></div>
        <button class="icon-btn" data-act="turn" data-d="1" ${running ? 'disabled' : ''} aria-label="Próximo">▶</button>
      </div>
      <div class="t-digits" id="timerDigits">${fmtClock(timerRemaining(d))}</div>
      <div class="t-adjust ${running ? 'hidden' : ''}">
        <button class="btn btn-ghost btn-small" data-act="adjTime" data-d="-10">−10s</button>
        <span>TEMPO ${d.seconds}s</span>
        <button class="btn btn-ghost btn-small" data-act="adjTime" data-d="10">+10s</button>
      </div>
      <button class="btn btn-ghost btn-small ${running ? 'hidden' : ''}" data-act="testAlarm">🔊 TESTAR ALARME</button>
      <div class="t-main">
        ${running
          ? '<button class="btn btn-ghost" data-act="timerStop">⏹ PARAR</button>'
          : '<button class="btn btn-green btn-big" data-act="timerGo">▶ VAI!</button>'}
        <button class="btn btn-yellow btn-big" data-act="timerHit">✔ ACERTOU!</button>
      </div>
    </div>
    ${leaderHtml(a, 'PTS')}
    ${scoreList(a, { turn: d.turn })}
    <div class="undo-row"><button class="btn btn-ghost btn-small" data-act="undoPoint" ${d.log.length ? '' : 'disabled'}>↶ DESFAZER ACERTO</button></div>`;
}

let timerInt = null;
function syncTimer() {
  clearInterval(timerInt);
  timerInt = null;
  const a = state.active;
  keepAwake(!!a);
  if (a?.type === 'timer' && a.data.endsAt) {
    timerInt = setInterval(tickTimer, 200);
    tickTimer();
  }
}

function tickTimer() {
  const a = state.active;
  if (!a || a.type !== 'timer' || !a.data.endsAt) return syncTimer();
  const rem = timerRemaining(a.data);
  const el = $('#timerDigits');
  if (el) {
    el.textContent = fmtClock(rem);
    $('#timerBox')?.classList.toggle('urgent', rem <= 10);
  }
  if (rem <= 0 && canEdit()) {
    a.data.endsAt = null;
    a.data.turn = (a.data.turn + 1) % a.comps.length;
    save();
    alarm();
    toast('⏰ TEMPO ESGOTADO!', 'err');
    render();
  }
}

/* ================= modal ================= */

let pendingConfirm = null;
let draft = null;   // configuração antes de iniciar um jogo
let fin = null;     // seleção de vencedores ao finalizar

function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  const first = $('#modalBox input:not([type=radio]), #modalBox .pick, #modalBox .btn');
  if (first && window.matchMedia('(hover: hover)').matches) first.focus();
}

// re-render do conteúdo mantendo a rolagem
function setModal(html) {
  const box = $('#modalBox'), top = box.scrollTop;
  box.innerHTML = html;
  box.scrollTop = top;
}

function closeModal() {
  $('#modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  $('#modalBox').innerHTML = '';
  draft = null;
  fin = null;
  pendingConfirm = null;
}

function confirmBox(msg, onYes, yesLabel = 'SIM') {
  openModal(`
    <h2>⚠ ATENÇÃO</h2>
    <p class="confirm-msg">${msg}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-act="closeModal">CANCELAR</button>
      <button class="btn btn-red" data-act="confirmYes">${yesLabel}</button>
    </div>`);
  pendingConfirm = onYes;
}

/* ---------- configurar e iniciar jogo ---------- */

function setupGame(gameId) {
  const game = findGame(gameId);
  if (!game) return;
  draft = {
    game, format: 'solo', groups: 2, teams: [], sel: null,
    lives: gameSetting(game, 'lives', 3),
    seconds: gameSetting(game, 'seconds', 60),
  };
  rebuildTeams();
  openModal(setupSheetHtml());
  blip('ok');
}

function rebuildTeams(random = false) {
  const ids = activePlayers().map(p => p.id);
  const list = random ? shuffle(ids) : ids;
  const n = list.length;
  const k = draft.format === 'duplas' ? Math.ceil(n / 2) : clamp(draft.groups, [2, maxGroups()]);
  draft.teams = Array.from({ length: Math.max(1, k) }, () => []);
  if (draft.format === 'duplas') list.forEach((id, i) => draft.teams[Math.floor(i / 2)].push(id));
  else list.forEach((id, i) => draft.teams[i % k].push(id));
  draft.sel = null;
}

const maxGroups = () => Math.max(2, Math.min(LIMITS.groups[1], activePlayers().length));

const teamLabel = i => (draft.format === 'duplas' ? `DUPLA ${i + 1}` : `GRUPO ${String.fromCharCode(65 + i)}`);

function stepperHtml(k, value, label, step = 1, suffix = '') {
  return `
    <div class="opt">
      <span class="lbl">${label}</span>
      <div class="stepper">
        <button class="btn btn-ghost" data-act="draftStep" data-k="${k}" data-d="${-step}">−</button>
        <span class="sv">${value}${suffix}</span>
        <button class="btn btn-ghost" data-act="draftStep" data-k="${k}" data-d="${step}">+</button>
      </div>
    </div>`;
}

function setupSheetHtml() {
  const d = draft, g = d.game;
  const playing = activePlayers();
  const teamsHtml = d.format === 'solo' ? '' : `
    ${d.format === 'grupos' ? stepperHtml('groups', d.teams.length, 'QUANTOS GRUPOS') : ''}
    <div class="opt-head"><span class="lbl">MONTE OS TIMES</span>
      <button class="btn btn-cyan btn-small" data-act="shuffleTeams">🎲 SORTEAR</button></div>
    <p class="hint">Toque em 2 jogadores para trocá-los, ou num jogador e depois num time para movê-lo.</p>
    <div class="teams">${d.teams.map((t, i) => `
      <div class="team" style="--c:${TEAM_COLORS[i % TEAM_COLORS.length]}" data-act="dropTeam" data-i="${i}">
        <div class="team-h">${teamLabel(i)}</div>
        ${t.map(pid => {
          const p = playerById(pid);
          return `<button class="tchip ${d.sel === pid ? 'sel' : ''}" style="--pc:${p.color}" data-act="selPlayer" data-id="${pid}">${esc(p.name)}</button>`;
        }).join('') || '<span class="muted">vazio</span>'}
      </div>`).join('')}
    </div>`;

  return `
    <h2>${g.icon} ${esc(g.name)}</h2>
    <p class="sub">${TYPES[g.type].desc}</p>
    ${g.rules ? `<p class="rules">${esc(g.rules)}</p>` : ''}

    <div class="opt-head"><span class="lbl">QUEM JOGA (${playing.length}/${state.players.length})</span></div>
    <div class="who">${state.players.map(p => `
      <button class="who-chip ${p.out ? 'off' : ''}" style="--c:${p.color}" data-act="toggleOut" data-id="${p.id}">
        ${p.out ? '💤' : '✔'} ${esc(p.name)}</button>`).join('')}
    </div>
    <p class="hint small">Desmarcado = "não vai jogar" até você marcar de novo.</p>

    <div class="opt-head"><span class="lbl">FORMATO</span></div>
    <div class="seg-btns">${Object.entries(FORMATS).map(([k, v]) => `
      <button class="${d.format === k ? 'on' : ''}" data-act="draftFormat" data-f="${k}">${v}</button>`).join('')}
    </div>
    ${teamsHtml}

    ${g.type === 'vidas' ? stepperHtml('lives', d.lives, 'VIDAS INICIAIS ♥') : ''}
    ${g.type === 'timer' ? stepperHtml('seconds', d.seconds, 'TEMPO DO TIMER', 10, 's') : ''}

    <div class="modal-actions">
      <button class="btn btn-ghost" data-act="closeModal">VOLTAR</button>
      <button class="btn btn-green" data-act="startGame">▶ COMEÇAR</button>
    </div>`;
}

function buildComps() {
  const d = draft;
  if (d.format === 'solo') {
    return activePlayers().map(p => ({ id: 'p_' + p.id, name: p.name, sub: '', color: p.color, members: [p.id] }));
  }
  return d.teams.map((t, i) => {
    const names = t.map(pid => playerById(pid).name);
    return {
      id: 't' + i,
      name: d.format === 'duplas' ? names.join(' & ') : `GRUPO ${String.fromCharCode(65 + i)}`,
      sub: d.format === 'grupos' ? names.join(', ') : '',
      color: TEAM_COLORS[i % TEAM_COLORS.length],
      members: [...t],
    };
  });
}

function startGame() {
  const d = draft, g = d.game;
  if (!activePlayers().length) return toast('Ninguém vai jogar?', 'err');
  if (d.format !== 'solo' && d.teams.some(t => !t.length)) return toast('Tem time vazio!', 'err');
  const comps = buildComps();
  if (g.type === 'vidas' && comps.length < 2) return toast('Precisa de pelo menos 2 competidores', 'err');

  let data;
  if (g.type === 'vidas') {
    data = { lives: d.lives, hp: Object.fromEntries(comps.map(c => [c.id, d.lives])), marked: [], history: [], round: 1 };
    setGameSetting(g.id, 'lives', d.lives);
  } else if (g.type === 'timer') {
    data = { seconds: d.seconds, endsAt: null, turn: 0, score: {}, log: [] };
    setGameSetting(g.id, 'seconds', d.seconds);
  } else {
    data = { score: {}, log: [] };
  }
  state.active = {
    id: uid(), gameId: g.id, gameName: g.name, icon: g.icon, rules: g.rules || '',
    type: g.type, format: d.format, comps, startedAt: Date.now(), data,
  };
  ui.tab = 'jogos';
  save();
  closeModal();
  render();
  window.scrollTo(0, 0);
  audio();
  blip('win');
  toast(`${g.icon} VALENDO!`);
}

/* ---------- finalizar jogo ---------- */

function openFinish(suggest, msg = '') {
  const a = state.active;
  fin = new Set(suggest);
  openModal(finishSheetHtml(a, msg));
}

function finishSheetHtml(a, msg) {
  return `
    <h2>🏁 FIM DE ${esc(a.gameName)}</h2>
    ${msg ? `<p class="confirm-msg">${esc(msg)}</p>` : ''}
    <p class="hint">Quem venceu? Cada vencedor ganha 1 vitória${a.format === 'solo' ? '' : ' (todos do time)'}.
      Sem ninguém marcado = ninguém venceu.</p>
    <div class="pick-list">${a.comps.map(c => `
      <button class="pick ${fin.has(c.id) ? 'on' : ''}" style="--c:${c.color}" data-act="finPick" data-cid="${c.id}">
        <span class="pos">${fin.has(c.id) ? '♛' : '–'}</span><span class="name">${esc(c.name)}</span><span></span>
      </button>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-act="closeModal">VOLTAR AO JOGO</button>
      <button class="btn btn-green" data-act="confirmFinish">✔ CONFIRMAR</button>
    </div>`;
}

function scoreDetail(a) {
  const vals = a.comps.map(c => a.data.score[c.id] || 0).sort((x, y) => y - x);
  return `placar ${vals.join(' × ')}`;
}

function finalizeGame(winners) {
  const a = state.active;
  let awards = {}, detail = '';
  if (a.type === 'vitoria') {
    awards = awardsFromScore(a.comps, a.data.score);
  } else {
    winners.forEach(cid => a.comps.find(c => c.id === cid).members.forEach(pid => (awards[pid] = (awards[pid] || 0) + 1)));
    detail = a.type === 'vidas' ? plural(a.data.round - 1, 'rodada', 'rodadas') : scoreDetail(a);
  }
  state.sessions.push({
    id: uid(), gameId: a.gameId, gameName: a.gameName, icon: a.icon, type: a.type, format: a.format,
    ts: Date.now(), comps: a.comps, players: a.comps.flatMap(c => c.members),
    winners, score: a.data.score || {}, detail, awards,
  });
  state.active = null;
  ui.tab = 'placar';
  save();
  closeModal();
  render();
  window.scrollTo(0, 0);
  blip('win');
  toast(Object.keys(awards).length ? '🏆 VITÓRIAS SOMADAS!' : 'JOGO ENCERRADO');
}

/* ---------- criar jogo ---------- */

function openNewGame() {
  openModal(`
    <h2>+ NOVO JOGO</h2>
    <form class="form" data-form="createGame">
      <label class="field"><span class="lbl">NOME</span><input name="name" maxlength="20" required placeholder="EX: BOZÓ"></label>
      <div class="field"><span class="lbl">ÍCONE</span>
        <div class="icon-pick">${ICONS.map((ic, i) => `<label><input type="radio" name="icon" value="${ic}" ${i ? '' : 'checked'}><span>${ic}</span></label>`).join('')}</div>
      </div>
      <div class="field"><span class="lbl">COMO FUNCIONA</span>
        <div class="type-pick">${Object.entries(TYPES).map(([k, t], i) => `
          <label><input type="radio" name="type" value="${k}" ${i ? '' : 'checked'}>
            <span><b>${t.label}</b>${t.desc}</span></label>`).join('')}
        </div>
      </div>
      <label class="field"><span class="lbl">REGRAS (OPCIONAL)</span><textarea name="rules" maxlength="200" placeholder="Lembrete rápido das regras..."></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="closeModal">CANCELAR</button>
        <button class="btn btn-green">✔ CRIAR</button>
      </div>
    </form>`);
}

function createGame(form) {
  const f = new FormData(form);
  const name = String(f.get('name')).trim().toUpperCase();
  if (!name) return toast('Dê um nome ao jogo!', 'err');
  if (allGames().some(g => g.name.toUpperCase() === name)) return toast('Já existe um jogo com esse nome', 'err');
  const rules = String(f.get('rules') || '').trim();
  state.customGames.push({ id: 'c_' + uid(), name, icon: f.get('icon'), type: f.get('type'), ...(rules && { rules }) });
  save();
  closeModal();
  render();
  blip('add');
  toast('JOGO CRIADO!');
}

/* ---------- jogadores ---------- */

const inActiveGame = pid => state.active?.comps.some(c => c.members.includes(pid));

function addPlayer(name) {
  name = name.trim();
  if (!name) return;
  if (state.players.length >= MAX_PLAYERS) return toast(`Máximo de ${MAX_PLAYERS} jogadores`, 'err');
  if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return toast('Esse nome já está na lista', 'err');
  const color = fixedColor(name) || freeColor(new Set(state.players.map(p => p.color)));
  state.players.push({ id: uid(), name, color, out: false });
  save();
  blip('add');
  refreshPlayers();
}

function removePlayer(id) {
  const p = playerById(id);
  if (!p) return;
  if (inActiveGame(id)) return toast(`${p.name} está no jogo em andamento`, 'err');
  if (state.night && state.players.length <= 1) return toast('A noite precisa de pelo menos 1 jogador', 'err');
  const doRemove = () => {
    state.players = state.players.filter(x => x.id !== id);
    save();
    blip('del');
    refreshPlayers();
  };
  const hasWins = state.sessions.some(s => id in s.awards);
  if (hasWins) {
    confirmBox(`Remover <b>${esc(p.name)}</b>? As vitórias dele(a) nesta noite somem do ranking.`, doRemove, 'REMOVER');
  } else {
    if ($('[data-act=toggleOut]')) closeModal();
    doRemove();
  }
}

function refreshPlayers() {
  const ed = $('#playersEditor');
  if (ed) {
    ed.innerHTML = playersEditor();
    $('#playerName', ed)?.focus();
  }
  if (!state.night) {
    const start = $('[data-act=startNight]');
    if (start) start.disabled = !state.players.length;
  } else {
    renderNight();
  }
}

function openPlayersModal() {
  openModal(`
    <h2>👥 JOGADORES</h2>
    <div id="playersEditor">${playersEditor()}</div>
    <div class="modal-actions"><button class="btn btn-green" data-act="closeModal">✔ PRONTO</button></div>`);
}

function openPlayerMenu(id) {
  const p = playerById(id), s = standings().find(x => x.id === id);
  openModal(`
    <h2 style="color:${p.color}">${esc(p.name)}</h2>
    <p class="sub">★ ${plural(s.wins, 'vitória', 'vitórias')} · ${plural(s.played, 'partida', 'partidas')}</p>
    <div class="menu">
      <button class="btn ${p.out ? 'btn-green' : 'btn-ghost'}" data-act="toggleOut" data-id="${id}">
        ${p.out ? '✅ VAI JOGAR' : '💤 NÃO VAI JOGAR'}</button>
      <button class="btn btn-red" data-act="removePlayer" data-id="${id}">✕ REMOVER DA NOITE</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" data-act="closeModal">FECHAR</button></div>`);
}

/* ---------- encerrar noite ---------- */

function endNight() {
  if (state.active) {
    ui.tab = 'jogos';
    renderNight();
    return toast('Finalize ou cancele o jogo em andamento', 'err');
  }
  const msg = state.sessions.length
    ? 'Encerrar a noite? O top 3 será revelado e o ranking será zerado.'
    : 'Nenhuma partida foi registrada. Encerrar mesmo assim?';
  confirmBox(msg, () => {
    const games = {};
    state.sessions.forEach(s => {
      games[s.gameId] = games[s.gameId] || { name: s.gameName, icon: s.icon, count: 0 };
      games[s.gameId].count++;
    });
    state.lastSummary = {
      startedAt: state.night.startedAt,
      endedAt: Date.now(),
      totalMatches: state.sessions.length,
      ranking: standings().map(({ name, color, wins, played, rank }) => ({ name, color, wins, played, rank })),
      games: Object.values(games).sort((a, b) => b.count - a.count),
    };
    state.sessions = [];
    state.night = null;
    state.players.forEach(p => (p.out = false));
    save();
    render();
    blip('win');
    showSummary();
  }, 'ENCERRAR');
}

let summaryBlob = null;

async function showSummary() {
  const s = state.lastSummary;
  if (!s) return;
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
  openModal(`
    <h2>★ FIM DE JOGO ★</h2>
    <img class="summary-img" id="summaryImg" alt="Ranking da noite">
    <div class="modal-actions">
      <button class="btn btn-ghost" data-act="closeModal">FECHAR</button>
      ${canShare ? '<button class="btn btn-cyan" data-act="shareImg">↗ ENVIAR</button>' : ''}
      <button class="btn btn-yellow" data-act="downloadImg">⬇ BAIXAR</button>
    </div>`);
  summaryBlob = null;
  const canvas = await buildImage(s);
  summaryBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const img = $('#summaryImg');
  if (img) img.src = URL.createObjectURL(summaryBlob);
}

const imageName = () => `gamenight-${ymd(state.lastSummary.endedAt)}.png`;

function downloadImg() {
  if (!summaryBlob) return toast('Gerando imagem...');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(summaryBlob);
  a.download = imageName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  blip('ok');
}

async function shareImg() {
  if (!summaryBlob) return toast('Gerando imagem...');
  try {
    await navigator.share({ files: [new File([summaryBlob], imageName(), { type: 'image/png' })], title: 'GameNight' });
  } catch {}
}

/* ================= imagem do ranking (canvas) ================= */

const PX = '"Press Start 2P", monospace';
const VT = 'VT323, "Apple Color Emoji", "Segoe UI Emoji", monospace';

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

function pixelFrame(ctx, x, y, w, h, color, t = 8) {
  ctx.fillStyle = color;
  ctx.fillRect(x + t, y, w - 2 * t, t);
  ctx.fillRect(x + t, y + h - t, w - 2 * t, t);
  ctx.fillRect(x, y + t, t, h - 2 * t);
  ctx.fillRect(x + w - t, y + t, t, h - 2 * t);
}

function drawCrown(ctx, cx, y, s = 8) {
  const shape = ['1...1...1', '11.111.11', '111111111', '111111111', '.1111111.'];
  const w = shape[0].length * s;
  shape.forEach((row, r) => [...row].forEach((c, i) => {
    if (c !== '1') return;
    ctx.fillStyle = r === 2 && i % 3 === 1 ? '#ff2a6d' : '#ffd700';
    ctx.fillRect(cx - w / 2 + i * s, y + r * s, s, s);
  }));
}

async function buildImage(s) {
  try {
    await Promise.all([document.fonts.load(`40px ${PX}`), document.fonts.load('40px VT323')]);
  } catch {}

  const W = 1080;
  const rest = s.ranking.slice(Math.min(3, s.ranking.filter(p => p.wins > 0).length));
  const gamesH = Math.max(1, s.games.length) * 60;
  const restH = rest.length ? 110 + Math.ceil(rest.length / 2) * 50 : 0;
  const H = 890 + restH + 110 + gamesH + 150;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');

  x.fillStyle = '#0d0221';
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,42,109,.10)';
  for (let i = 0; i < W; i += 40) x.fillRect(i, 0, 2, H);
  for (let j = 0; j < H; j += 40) x.fillRect(0, j, W, 2);
  pixelFrame(x, 24, 24, W - 48, H - 48, '#ff2a6d');
  pixelFrame(x, 40, 40, W - 80, H - 80, '#05d9e8', 4);

  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  x.font = `68px ${PX}`;
  x.fillStyle = '#ff2a6d';
  x.fillText('GAMENIGHT', W / 2 + 6, 156);
  x.fillStyle = '#05d9e8';
  x.fillText('GAMENIGHT', W / 2, 150);
  x.font = `40px ${VT}`;
  x.fillStyle = '#e6f7ff';
  x.fillText(fmtDate(s.endedAt).toUpperCase(), W / 2, 210);
  x.font = `16px ${PX}`;
  x.fillStyle = '#ffe14d';
  x.fillText('★ RANKING DA NOITE ★', W / 2, 270);

  const top = s.ranking.filter(p => p.wins > 0).slice(0, 3);
  const baseY = 830, bw = 260;
  if (!top.length) {
    x.font = `24px ${PX}`;
    x.fillStyle = '#8b7fc0';
    x.fillText('NINGUÉM VENCEU HOJE', W / 2, 600);
  }
  const slots = [
    { i: 1, cx: W / 2 - 290, h: 190, col: '#c9d1d9' },
    { i: 0, cx: W / 2, h: 270, col: '#ffd700' },
    { i: 2, cx: W / 2 + 290, h: 140, col: '#e08a3c' },
  ];
  slots.forEach(({ i, cx, h, col }) => {
    const p = top[i];
    if (!p) return;
    const yTop = baseY - h;
    x.fillStyle = col;
    x.fillRect(cx - bw / 2, yTop, bw, h);
    x.fillStyle = 'rgba(255,255,255,.35)';
    x.fillRect(cx - bw / 2, yTop, bw, 10);
    x.fillStyle = 'rgba(0,0,0,.25)';
    x.fillRect(cx + bw / 2 - 10, yTop + 10, 10, h - 10);
    x.fillStyle = '#0d0221';
    x.font = `60px ${PX}`;
    x.fillText(`${p.rank}`, cx, yTop + 100);

    x.fillStyle = '#000';
    x.fillRect(cx - 28, yTop - 180, 64, 64);
    x.fillStyle = p.color;
    x.fillRect(cx - 32, yTop - 184, 64, 64);
    x.fillStyle = '#0d0221';
    x.fillRect(cx - 18, yTop - 166, 10, 14);
    x.fillRect(cx + 8, yTop - 166, 10, 14);
    x.fillRect(cx - 14, yTop - 140, 28, 6);

    if (i === 0) drawCrown(x, cx, yTop - 236);

    x.font = `24px ${PX}`;
    x.fillStyle = p.color;
    x.fillText(fitText(x, p.name.toUpperCase(), bw + 20), cx, yTop - 76);
    x.font = `40px ${VT}`;
    x.fillStyle = '#ffffff';
    x.fillText(`★ ${plural(p.wins, 'VITÓRIA', 'VITÓRIAS')}`, cx, yTop - 28);
  });
  x.fillStyle = '#3d1f8c';
  x.fillRect(80, baseY, W - 160, 12);

  let y = 890;

  if (rest.length) {
    y += 60;
    x.font = `16px ${PX}`;
    x.fillStyle = '#ffe14d';
    x.fillText('DEMAIS COLOCAÇÕES', W / 2, y);
    y += 50;
    const colW = (W - 200) / 2;
    rest.forEach((p, k) => {
      const col = k % 2, row = Math.floor(k / 2);
      const px = 100 + col * colW, py = y + row * 50;
      x.textAlign = 'left';
      x.font = `36px ${VT}`;
      x.fillStyle = '#8b7fc0';
      x.fillText(p.wins > 0 ? `${p.rank}º` : '–', px, py);
      x.fillStyle = p.color;
      x.fillRect(px + 60, py - 22, 18, 18);
      x.fillStyle = '#e6f7ff';
      x.fillText(fitText(x, p.name, colW - 200), px + 92, py);
      x.textAlign = 'right';
      x.fillStyle = '#05d9e8';
      x.fillText(`★${p.wins}`, px + colW - 40, py);
    });
    x.textAlign = 'center';
    y += Math.ceil(rest.length / 2) * 50;
  }

  y += 60;
  x.font = `16px ${PX}`;
  x.fillStyle = '#ffe14d';
  x.fillText('JOGOS JOGADOS', W / 2, y);
  y += 56;
  x.font = `40px ${VT}`;
  if (!s.games.length) {
    x.fillStyle = '#8b7fc0';
    x.fillText('Nenhuma partida registrada', W / 2, y);
  }
  s.games.forEach((g, k) => {
    const py = y + k * 60;
    x.textAlign = 'left';
    x.fillStyle = '#e6f7ff';
    x.fillText(fitText(x, `${g.icon}  ${g.name}`, W - 520), 200, py);
    x.textAlign = 'right';
    x.fillStyle = '#3cff7a';
    x.fillText(`x${g.count}`, W - 200, py);
  });
  x.textAlign = 'center';

  x.font = `34px ${VT}`;
  x.fillStyle = '#8b7fc0';
  x.fillText(`${s.totalMatches} PARTIDA${s.totalMatches === 1 ? '' : 'S'} · ${fmtTime(s.startedAt)} – ${fmtTime(s.endedAt)}`, W / 2, H - 80);

  return c;
}

/* ================= grupo online (Vercel + Upstash) ================= */

const API = '/api/group';
const POLL_MS = 5000;
const EDIT_ACTS = new Set([
  'startNight', 'removePlayer', 'toggleOut', 'setupGame', 'newGame', 'delGame', 'startGame', 'addPoint', 'undoPoint',
  'timerGo', 'timerStop', 'timerHit', 'turn', 'setTurn', 'adjTime', 'markHit', 'nextRound', 'undoRound',
  'finishGame', 'cancelGame', 'delSession', 'endNight', 'editPlayers', 'wipeData', 'importData',
]);
document.head.insertAdjacentHTML('beforeend',
  `<style>${[...EDIT_ACTS].map(a => `body.readonly [data-act="${a}"]`).join(',')}{opacity:.35;filter:grayscale(1)}</style>`);

const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtCode = c => `${c.slice(0, 3)}-${c.slice(3)}`;
const canEdit = () => !group || !!group.pin;
const busy = () => !!(draft || fin || pendingConfirm);

let syncStatus = 'ok';            // ok | pending | offline
let dirty = !!group?.dirty;       // há mudanças locais ainda não enviadas
let pushing = false, pushTimer = null, pollTimer = null;

function saveGroup() {
  try {
    if (group) localStorage.setItem(GROUP_KEY, JSON.stringify({ ...group, dirty }));
    else localStorage.removeItem(GROUP_KEY);
  } catch {}
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
}
function setSync(s) {
  syncStatus = s;
  const el = $('#syncDot');
  if (el) el.dataset.s = s;
}

async function api(method, body, query = '') {
  const r = await fetch(API + query, {
    method, cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}

// substitui o estado local pelo do servidor
function adopt(remote) {
  group.version = remote.version;
  state = { ...defaultState(), ...(remote.state || {}) };
  applyFixedColors();
  try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch {}
  saveGroup();
  render();
}

async function pull({ force = false } = {}) {
  if (!group || (!force && (dirty || pushing || busy()))) return;
  try {
    const { ok, status, data } = await api('GET', null, `?code=${group.code}&since=${force ? -1 : group.version}`);
    if (status === 404) {
      toast('Esse grupo não existe mais', 'err');
      return leaveGroup();
    }
    if (!ok) throw new Error();
    if (!data.same && (force || !(dirty || pushing || busy()))) adopt(data);
    if (!dirty) setSync('ok');
  } catch {
    if (!dirty) setSync('offline');
  }
}

function schedulePush() {
  dirty = true;
  saveGroup();
  setSync('pending');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 400);
}

async function push() {
  clearTimeout(pushTimer);
  if (!group?.pin || !dirty || pushing) return;
  pushing = true;
  const sent = JSON.stringify(state);
  let retryIn = 300;
  try {
    const { ok, status, data } = await api('PUT', { code: group.code, pin: group.pin, version: group.version, state: JSON.parse(sent) });
    if (ok) {
      group.version = data.version;
      if (JSON.stringify(state) === sent) dirty = false;
      saveGroup();
      if (!dirty) setSync('ok');
    } else if (status === 409) {
      // outro aparelho com PIN salvou antes: fica valendo o do servidor
      dirty = false;
      closeModal();
      adopt(data);
      toast('Outro aparelho mudou o grupo. Atualizei aqui.', 'err');
    } else if (status === 401 || status === 429 || status === 404) {
      dirty = false;
      group.pin = null;
      saveGroup();
      toast(status === 429 ? 'Muitas tentativas de PIN. Espere 15 min' : 'PIN não confere mais. Agora você é espectador', 'err');
      pull({ force: true });
    } else {
      throw new Error();
    }
  } catch {
    retryIn = POLL_MS;
    setSync('offline');
  } finally {
    pushing = false;
    if (dirty) pushTimer = setTimeout(push, retryIn);
  }
}

function startSync() {
  clearInterval(pollTimer);
  if (!group) return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') dirty ? push() : pull();
  }, POLL_MS);
  dirty ? push() : pull();
}

async function joinGroup(code) {
  code = cleanCode(code);
  if (code.length !== 6) return toast('O código tem 6 letras/números', 'err');
  let res;
  try { res = await api('GET', null, `?code=${code}&since=-1`); } catch { return toast('Sem conexão com o servidor', 'err'); }
  if (res.status === 404) return toast('Grupo não encontrado', 'err');
  if (!res.ok) return toast('Sem conexão com o servidor', 'err');
  group = { code, pin: null, version: res.data.version };
  dirty = false;
  prefs.local = false;
  savePrefs();
  closeModal();
  ui.tab = 'placar';
  adopt(res.data);
  startSync();
  blip('win');
  toast(`👁 VOCÊ ENTROU NO GRUPO ${fmtCode(code)}`);
}

function leaveGroup() {
  clearInterval(pollTimer);
  clearTimeout(pushTimer);
  group = null;
  dirty = false;
  saveGroup();
  prefs.local = false;
  savePrefs();
  state = load();
  applyFixedColors();
  closeModal();
  render();
}

function openCreateGroupSheet() {
  const hasData = state.players.length > 0 || state.sessions.length > 0;
  openModal(`
    <h2>+ CRIAR GRUPO</h2>
    <p class="sub">Você recebe um código para mandar pra galera. Quem tiver o código vê tudo ao vivo; para <b>editar</b> precisa do PIN.</p>
    <form class="form" data-form="createGroup">
      <label class="field"><span class="lbl">PIN DE ORGANIZADOR (4 A 8 NÚMEROS)</span>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" required></label>
      <label class="field"><span class="lbl">REPITA O PIN</span>
        <input name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" required></label>
      ${hasData ? `<label class="check"><input type="checkbox" name="keep" checked> Levar os dados deste aparelho (${plural(state.players.length, 'jogador', 'jogadores')})</label>` : ''}
      <p class="hint small">Guarde o PIN: não dá para recuperar.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="closeModal">CANCELAR</button>
        <button class="btn btn-green" id="createGroupBtn">✔ CRIAR</button>
      </div>
    </form>`);
}

async function createGroup(form) {
  const f = new FormData(form);
  const pin = String(f.get('pin') || ''), pin2 = String(f.get('pin2') || '');
  if (!/^\d{4,8}$/.test(pin)) return toast('O PIN precisa ter de 4 a 8 números', 'err');
  if (pin !== pin2) return toast('Os PINs não batem', 'err');
  const initial = f.get('keep') ? state : defaultState();
  const btn = $('#createGroupBtn');
  if (btn) btn.disabled = true;
  let res;
  try { res = await api('POST', { action: 'create', pin, state: initial }); } catch { res = { ok: false }; }
  if (btn) btn.disabled = false;
  if (!res.ok) return toast(res.data?.error === 'banco_nao_configurado' ? 'Servidor sem banco de dados. Ligue o Upstash na Vercel' : 'Não deu para criar o grupo. Sem conexão?', 'err');
  group = { code: res.data.code, pin, version: res.data.version };
  dirty = false;
  prefs.local = false;
  savePrefs();
  state = { ...defaultState(), ...initial };
  try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch {}
  saveGroup();
  closeModal();
  render();
  startSync();
  blip('win');
  openGroupSheet();
}

function openPinSheet() {
  if (!group) return;
  openModal(`
    <h2>🔓 MODO ORGANIZADOR</h2>
    <p class="sub">Digite o PIN do grupo <b>${fmtCode(group.code)}</b> para registrar jogos e pontos neste aparelho.</p>
    <form class="form" data-form="unlock">
      <input id="unlockPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="PIN" autocomplete="current-password">
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="closeModal">SÓ ASSISTIR</button>
        <button class="btn btn-green">🔓 ENTRAR</button>
      </div>
    </form>`);
}

async function unlock(pin) {
  let res;
  try { res = await api('POST', { action: 'verify', code: group.code, pin }); } catch { res = { status: 0 }; }
  if (res.ok) {
    group.pin = pin;
    saveGroup();
    closeModal();
    render();
    blip('win');
    return toast('🔓 MODO ORGANIZADOR');
  }
  toast(res.status === 401 ? 'PIN errado' : res.status === 429 ? 'Muitas tentativas. Espere 15 min' : 'Sem conexão com o servidor', 'err');
}

function openGroupSheet() {
  const url = `${location.origin}${location.pathname}#g=${group.code}`;
  openModal(`
    <h2>👥 GRUPO</h2>
    <div class="group-code">${fmtCode(group.code)}</div>
    <p class="sub">Mande o código ou o link pra galera. Quem tiver vê tudo ao vivo; para editar precisa do PIN.</p>
    <textarea id="exportCode" class="code" readonly rows="2">${esc(url)}</textarea>
    <div class="data-btns">
      ${navigator.share ? '<button class="btn btn-cyan" data-act="shareData">↗ COMPARTILHAR</button>' : ''}
      <button class="btn btn-cyan" data-act="copyData">📋 COPIAR LINK</button>
    </div>

    <div class="opt-head"><span class="lbl">NESTE APARELHO VOCÊ É</span></div>
    ${group.pin
      ? '<div class="role on">🔓 ORGANIZADOR · pode editar</div><div class="data-btns"><button class="btn btn-ghost" data-act="lockEdit">🔒 VIRAR ESPECTADOR</button></div>'
      : '<div class="role">👁 ESPECTADOR · só visualiza</div><div class="data-btns"><button class="btn btn-yellow" data-act="askPin">🔓 DIGITAR PIN</button></div>'}

    <div class="opt-head"><span class="lbl">MAIS OPÇÕES</span></div>
    <div class="data-btns">
      <button class="btn btn-ghost" data-act="leaveGroup">🚪 SAIR DO GRUPO</button>
      ${group.pin ? '<button class="btn btn-red" data-act="wipeData">🗑 LIMPAR DADOS DO GRUPO</button>' : ''}
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" data-act="closeModal">FECHAR</button></div>`);
}

function renderGate() {
  app.innerHTML = `
    <section class="panel setup">
      <h2 class="blink-title">PRESS START</h2>
      <p class="sub">Entre no grupo da galera para ver o ranking ao vivo, ou crie um grupo novo.</p>
      <form class="add-row" data-form="joinGroup">
        <input id="joinCode" maxlength="7" placeholder="CÓDIGO" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button class="btn btn-cyan">ENTRAR</button>
      </form>
      <div class="or">— OU —</div>
      <button class="btn btn-big btn-pink" data-act="createGroupSheet">+ CRIAR GRUPO</button>
      <div class="gate-local">
        <p class="sub small">Sem grupo? Os dados ficam só neste celular.</p>
        <button class="btn btn-ghost btn-small" data-act="useLocal">📱 USAR SÓ NESTE APARELHO</button>
      </div>
    </section>`;
}

// abriu um link com #g=CODIGO ?
function checkGroupLink() {
  const m = location.hash.match(/^#g=([A-Za-z0-9-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const code = cleanCode(m[1]);
  if (group?.code === code) return;
  if (group || state.players.length) {
    confirmBox(`Entrar no grupo <b>${fmtCode(code)}</b>?${group ? ' Você sai do grupo atual neste aparelho.' : ''}`, () => joinGroup(code), 'ENTRAR');
  } else {
    joinGroup(code);
  }
}

/* ================= compartilhar dados entre aparelhos ================= */

const SHARE_KEYS = ['players', 'night', 'sessions', 'active', 'customGames', 'settings', 'lastSummary'];
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function streamBytes(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// "z" = gzip + base64url; "r" = só base64url (navegadores sem CompressionStream)
async function encodeData() {
  const data = Object.fromEntries(SHARE_KEYS.map(k => [k, state[k]]));
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ts: Date.now(), data }));
  if (window.CompressionStream) return 'z' + b64url(await streamBytes(bytes, new CompressionStream('gzip')));
  return 'r' + b64url(bytes);
}

async function decodeData(code) {
  const raw = unb64url(code.slice(1));
  const bytes = code[0] === 'z' ? await streamBytes(raw, new DecompressionStream('gzip')) : raw;
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (!payload?.data || !Array.isArray(payload.data.players)) throw new Error('inválido');
  return payload;
}

// aceita o link inteiro ou só o código
const extractCode = text => {
  const t = text.trim();
  const m = t.match(/#import=([A-Za-z0-9_-]+)/);
  return m ? m[1] : /^[zr][A-Za-z0-9_-]+$/.test(t) ? t : null;
};

const shareUrl = code => `${location.origin}${location.pathname}#import=${code}`;

function legacyCopy(el) {
  try {
    el.removeAttribute('readonly');
    el.focus();
    el.select();
    el.setSelectionRange(0, el.value.length);
    const ok = document.execCommand('copy');
    el.setAttribute('readonly', '');
    el.blur();
    return ok;
  } catch {
    return false;
  }
}

async function openDataSheet() {
  openModal(`
    <h2>💾 DADOS</h2>
    <div class="data-btns"><button class="btn btn-pink" data-act="goOnline">👥 CRIAR OU ENTRAR EM GRUPO ONLINE</button></div>
    <p class="sub">Ou leve jogadores, partidas e ranking para outro aparelho por link — ou do Safari para o app da tela de início.</p>

    <div class="opt-head"><span class="lbl">ENVIAR DESTE APARELHO</span></div>
    <textarea id="exportCode" class="code" readonly rows="3">Gerando...</textarea>
    <div class="data-btns">
      ${navigator.share ? '<button class="btn btn-cyan" data-act="shareData">↗ COMPARTILHAR</button>' : ''}
      <button class="btn btn-cyan" data-act="copyData">📋 COPIAR LINK</button>
    </div>

    <div class="opt-head"><span class="lbl">RECEBER NESTE APARELHO</span></div>
    <p class="hint small">Abra o link recebido, ou cole o link/código aqui. Os dados deste aparelho serão substituídos.</p>
    <textarea id="importCode" class="code" rows="3" placeholder="Cole aqui o link ou código"></textarea>
    <div class="data-btns"><button class="btn btn-yellow" data-act="importData">⬇ IMPORTAR</button></div>

    <div class="opt-head"><span class="lbl">ZERAR ESTE APARELHO</span></div>
    <div class="data-btns"><button class="btn btn-red" data-act="wipeData">🗑 LIMPAR TODOS OS DADOS</button></div>

    <div class="modal-actions"><button class="btn btn-ghost" data-act="closeModal">FECHAR</button></div>`);
  try {
    const url = shareUrl(await encodeData());
    const el = $('#exportCode');
    if (el) el.value = url;
  } catch {
    toast('Não deu para gerar o link', 'err');
  }
}

function askImport(payload) {
  const d = payload.data;
  const when = new Date(payload.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  confirmBox(`Importar dados de ${when}? <br>${plural(d.players.length, 'jogador', 'jogadores')} · ${plural((d.sessions || []).length, 'partida', 'partidas')}${d.active ? ' · jogo em andamento' : ''}.<br><br>Os dados deste aparelho serão <b>substituídos</b>.`, () => {
    state = { ...defaultState(), ...Object.fromEntries(SHARE_KEYS.map(k => [k, d[k] ?? defaultState()[k]])) };
    applyFixedColors();
    ui.tab = state.active ? 'jogos' : 'placar';
    save();
    render();
    blip('win');
    toast('DADOS IMPORTADOS!');
  }, 'IMPORTAR');
}

async function importFromText(text) {
  const code = extractCode(text);
  if (!code) return toast('Link ou código inválido', 'err');
  try {
    askImport(await decodeData(code));
  } catch {
    toast('Link ou código inválido', 'err');
  }
}

// abriu um link com #import=... ?
async function checkImportLink() {
  if (!location.hash.startsWith('#import=')) return;
  const text = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  await importFromText(text);
}

/* ================= eventos ================= */

const live = () => state.active;
const commit = (sound = 'ok') => { save(); renderNight(); syncTimer(); blip(sound); };

const actions = {
  toggleMute() { prefs.muted = !prefs.muted; savePrefs(); renderTopbar(); },
  tab({ tab }) {
    ui.tab = tab;
    renderNight();
    window.scrollTo(0, 0);
    blip('ok');
  },
  startNight() {
    if (!state.players.length) return;
    state.night = { startedAt: Date.now() };
    state.sessions = [];
    state.active = null;
    ui.tab = 'jogos';
    save();
    render();
    blip('win');
    toast('READY? GO!');
  },

  // jogadores
  editPlayers: () => openPlayersModal(),
  removePlayer: ({ id }) => removePlayer(id),
  playerMenu: ({ id }) => openPlayerMenu(id),
  toggleOut({ id }) {
    const p = playerById(id);
    if (!p) return;
    if (!p.out && inActiveGame(id)) return toast(`${p.name} está no jogo em andamento`, 'err');
    p.out = !p.out;
    save();
    blip(p.out ? 'del' : 'add');
    if (draft) {
      if (draft.format === 'solo') rebuildTeams();
      else if (p.out) draft.teams.forEach(t => { const k = t.indexOf(id); if (k >= 0) t.splice(k, 1); });
      else {
        // entra no time com menos gente (duplas: abre dupla nova se todas estiverem cheias)
        const open = draft.teams.filter(t => draft.format !== 'duplas' || t.length < 2);
        if (!open.length) draft.teams.push([]);
        const pool = open.length ? open : [draft.teams[draft.teams.length - 1]];
        pool.reduce((m, t) => (t.length < m.length ? t : m)).push(id);
      }
      if (draft.format === 'duplas') draft.teams = draft.teams.filter(t => t.length);
      draft.sel = null;
      setModal(setupSheetHtml());
    } else {
      closeModal();
      render();
      toast(p.out ? `💤 ${p.name} não vai jogar` : `✅ ${p.name} vai jogar`);
    }
  },

  // configurar jogo
  setupGame: ({ id }) => setupGame(id),
  newGame: () => openNewGame(),
  delGame({ id }) {
    const g = findGame(id);
    confirmBox(`Excluir o jogo <b>${esc(g.name)}</b>? Partidas já registradas continuam valendo.`, () => {
      state.customGames = state.customGames.filter(x => x.id !== id);
      save(); render(); blip('del');
    }, 'EXCLUIR');
  },
  draftFormat({ f }) {
    draft.format = f;
    rebuildTeams();
    setModal(setupSheetHtml());
    blip('ok');
  },
  draftStep({ k, d }) {
    if (k === 'groups') {
      draft.groups = clamp(draft.teams.length + Number(d), [2, maxGroups()]);
      rebuildTeams();
    } else {
      draft[k] = clamp(draft[k] + Number(d), LIMITS[k]);
    }
    setModal(setupSheetHtml());
    blip('ok');
  },
  shuffleTeams() {
    rebuildTeams(true);
    setModal(setupSheetHtml());
    blip('win');
  },
  selPlayer({ id }) {
    const sel = draft.sel;
    if (!sel || sel === id) {
      draft.sel = sel === id ? null : id;
    } else {
      // troca os dois jogadores de lugar
      const ta = draft.teams.find(t => t.includes(sel)), tb = draft.teams.find(t => t.includes(id));
      ta[ta.indexOf(sel)] = id;
      tb[tb.indexOf(id)] = sel;
      draft.sel = null;
    }
    setModal(setupSheetHtml());
    blip('add');
  },
  dropTeam({ i }) {
    const sel = draft.sel;
    if (!sel) return;
    draft.teams.forEach(t => { const k = t.indexOf(sel); if (k >= 0) t.splice(k, 1); });
    draft.teams[i].push(sel);
    draft.sel = null;
    setModal(setupSheetHtml());
    blip('add');
  },
  startGame: () => startGame(),

  // pontos / vitória / timer
  addPoint({ cid }) {
    const a = live(), c = a.comps.find(x => x.id === cid);
    a.data.score[cid] = (a.data.score[cid] || 0) + 1;
    a.data.log.push(cid);
    commit(a.type === 'vitoria' ? 'win' : 'add');
    toast(a.type === 'vitoria' ? `★ ${c.name} VENCEU!` : `✔ ${c.name} +1`);
  },
  undoPoint() {
    const a = live(), cid = a.data.log.pop();
    if (!cid) return;
    a.data.score[cid] = Math.max(0, (a.data.score[cid] || 0) - 1);
    commit('del');
  },

  // timer
  timerGo() {
    const d = live().data;
    if (d.endsAt) return;
    audio();
    unlockAlarm();
    d.endsAt = Date.now() + d.seconds * 1000;
    commit('ok');
  },
  testAlarm() {
    loudSession(2500);
    try {
      if (!alarmEl) alarmEl = new Audio(alarmWavUrl());
      alarmEl.muted = false;
      alarmEl.currentTime = 0;
      alarmEl.play()?.catch?.(() => toast('O navegador bloqueou o som', 'err'));
    } catch {}
  },
  timerStop() {
    live().data.endsAt = null;
    commit('del');
  },
  timerHit() {
    const a = live(), d = a.data, c = a.comps[d.turn];
    d.score[c.id] = (d.score[c.id] || 0) + 1;
    d.log.push(c.id);
    d.endsAt = null;
    d.turn = (d.turn + 1) % a.comps.length;
    commit('win');
    toast(`✔ ${c.name} +1`);
  },
  turn({ d }) {
    const a = live();
    if (a.data.endsAt) return;
    a.data.turn = (a.data.turn + Number(d) + a.comps.length) % a.comps.length;
    commit('ok');
  },
  setTurn({ i }) {
    const a = live();
    if (a.data.endsAt) return toast('Espere o tempo acabar ou pare o timer', 'err');
    a.data.turn = Number(i);
    commit('ok');
  },
  adjTime({ d }) {
    const a = live();
    if (a.data.endsAt) return;
    a.data.seconds = clamp(a.data.seconds + Number(d), LIMITS.seconds);
    setGameSetting(a.gameId, 'seconds', a.data.seconds);
    commit('ok');
  },

  // vidas
  markHit({ cid }) {
    const m = live().data.marked, i = m.indexOf(cid);
    i >= 0 ? m.splice(i, 1) : m.push(cid);
    commit(i >= 0 ? 'ok' : 'del');
  },
  nextRound() {
    const a = live(), d = a.data;
    if (!d.marked.length) return toast('Marque quem tomou ponto!', 'err');
    d.history.push({ ...d.hp });
    const elim = [];
    d.marked.forEach(cid => {
      d.hp[cid] = Math.max(0, d.hp[cid] - 1);
      if (d.hp[cid] === 0) elim.push(a.comps.find(c => c.id === cid).name);
    });
    d.marked = [];
    d.round++;
    const alive = a.comps.filter(c => d.hp[c.id] > 0);
    commit(elim.length ? 'err' : 'ok');
    if (elim.length) toast(`💀 ${elim.join(', ')} ${elim.length > 1 ? 'eliminados' : 'eliminado(a)'}!`);
    if (alive.length <= 1) {
      openFinish(alive.map(c => c.id), alive.length
        ? `${alive[0].name} é o último com vidas!`
        : 'Todos zeraram na mesma rodada... ninguém venceu!');
    }
  },
  undoRound() {
    const d = live().data, prev = d.history.pop();
    if (!prev) return;
    d.hp = prev;
    d.round--;
    d.marked = [];
    commit('del');
  },

  // finalizar / cancelar
  finishGame() {
    const a = live();
    if (a.type === 'vitoria') {
      const total = Object.values(a.data.score).reduce((s, v) => s + v, 0);
      return confirmBox(`Finalizar ${esc(a.gameName)}? ${plural(total, 'vitória já foi somada', 'vitórias já foram somadas')} ao ranking.`,
        () => finalizeGame([]), 'FINALIZAR');
    }
    if (a.type === 'vidas') {
      const best = Math.max(...a.comps.map(c => a.data.hp[c.id]));
      return openFinish(a.comps.filter(c => a.data.hp[c.id] === best && best > 0).map(c => c.id));
    }
    openFinish(leadersOf(a.comps, a.data.score).map(c => c.id));
  },
  finPick({ cid }) {
    fin.has(cid) ? fin.delete(cid) : fin.add(cid);
    setModal(finishSheetHtml(live(), ''));
    blip('add');
  },
  confirmFinish: () => finalizeGame([...fin]),
  cancelGame() {
    confirmBox(`Cancelar ${esc(live().gameName)}? Nada deste jogo será contado.`, () => {
      state.active = null;
      save(); render(); blip('del');
    }, 'CANCELAR JOGO');
  },

  delSession({ id }) {
    const s = state.sessions.find(x => x.id === id);
    confirmBox(`Apagar a partida de <b>${esc(s.gameName)}</b> das ${fmtTime(s.ts)}? As vitórias dela saem do ranking.`, () => {
      state.sessions = state.sessions.filter(x => x.id !== id);
      save(); render(); blip('del');
    }, 'APAGAR');
  },

  dataSheet: () => (group ? openGroupSheet() : openDataSheet()),
  askPin: () => openPinSheet(),
  lockEdit() {
    group.pin = null;
    saveGroup();
    closeModal();
    render();
    toast('👁 MODO ESPECTADOR');
  },
  leaveGroup() {
    confirmBox(`Sair do grupo <b>${fmtCode(group.code)}</b> neste aparelho? Os dados continuam no grupo; dá para voltar com o código.`, leaveGroup, 'SAIR');
  },
  createGroupSheet: () => openCreateGroupSheet(),
  useLocal() {
    prefs.local = true;
    savePrefs();
    render();
  },
  goOnline() {
    prefs.local = false;
    savePrefs();
    closeModal();
    render();
  },
  shareData() {
    const url = $('#exportCode')?.value;
    if (!url?.startsWith('http')) return toast('Gerando...');
    navigator.share({ title: 'GameNight', text: group ? 'Entra no grupo do GameNight' : 'Dados do GameNight', url }).catch(() => {});
  },
  copyData() {
    const el = $('#exportCode');
    if (!el?.value.startsWith('http')) return toast('Gerando...');
    const fallback = () => (legacyCopy(el) ? toast('📋 LINK COPIADO!') : toast('Selecione o texto e copie manualmente', 'err'));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(el.value).then(() => toast('📋 LINK COPIADO!'), fallback);
    else fallback();
  },
  importData: () => importFromText($('#importCode')?.value || ''),
  wipeData() {
    const msg = group
      ? `Apagar <b>tudo do grupo ${fmtCode(group.code)}</b> — para todo mundo?<br>Jogadores, noite atual, partidas, ranking, jogo em andamento, jogos criados e última noite.<br><br>Não dá para desfazer.`
      : `Apagar <b>tudo</b> deste aparelho?<br>Jogadores, noite atual, partidas, ranking, jogo em andamento, jogos criados e última noite.<br><br>Não dá para desfazer. Se quiser guardar, use <b>COPIAR LINK</b> antes.`;
    confirmBox(msg, () => {
      state = defaultState();
      ui.tab = 'jogos';
      save();
      render();
      window.scrollTo(0, 0);
      blip('del');
      toast('🗑 DADOS APAGADOS');
    }, 'APAGAR TUDO');
  },
  endNight: () => endNight(),
  showSummary: () => showSummary(),
  downloadImg: () => downloadImg(),
  shareImg: () => shareImg(),
  closeModal: () => closeModal(),
  confirmYes() {
    const fn = pendingConfirm;
    closeModal();
    fn?.();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  e.preventDefault();
  e.stopPropagation();
  if (EDIT_ACTS.has(el.dataset.act) && !canEdit()) return openPinSheet();
  actions[el.dataset.act]?.(el.dataset, el);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) return closeModal();
  const el = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && el.matches?.('[role=button][data-act]')) {
    e.preventDefault();
    el.click();
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  if (kind === 'joinGroup') return joinGroup($('#joinCode', form).value);
  if (kind === 'createGroup') return createGroup(form);
  if (kind === 'unlock') return unlock($('#unlockPin', form).value);
  if (!canEdit()) return openPinSheet();
  if (kind === 'addPlayer') {
    const inp = $('#playerName', form);
    const name = inp.value;
    inp.value = '';
    addPlayer(name);
  } else if (form.dataset.form === 'createGame') {
    createGame(form);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncTimer();
    dirty ? push() : pull();
  }
});
window.addEventListener('online', () => (dirty ? push() : pull()));

$('#modal').addEventListener('click', e => {
  if (e.target.id === 'modal') closeModal();
});

render();
startSync();
const checkLinks = () => { checkGroupLink(); checkImportLink(); };
checkLinks();
window.addEventListener('hashchange', checkLinks);
