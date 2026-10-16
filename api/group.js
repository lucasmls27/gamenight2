// API dos grupos do GameNight (Vercel Function + Upstash Redis via REST).
//
//   GET  /api/group?code=ABC123&since=7   -> estado do grupo (ou { same: true } se a versão não mudou)
//   POST /api/group { action: 'create', pin, state }       -> cria grupo, devolve { code, version }
//   POST /api/group { action: 'verify', code, pin }        -> confere o PIN
//   PUT  /api/group { code, pin, version, state }          -> salva se a versão bater (senão 409 + estado atual)
//
// Variáveis de ambiente (criadas pela integração Upstash da Vercel):
//   KV_REST_API_URL / KV_REST_API_TOKEN  ou  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// Sem elas (desenvolvimento local), usa memória.

import crypto from 'node:crypto';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I
const CODE_RE = /^[A-Z0-9]{6}$/;
const PIN_RE = /^\d{4,8}$/;
const MAX_STATE_BYTES = 400_000;
const MAX_FAILS = 10;
const LOCK_SECONDS = 15 * 60;

const key = (code, part) => `gn:${code}:${part}`;

// salva o estado só se a versão atual for a esperada; devolve [1, novaVersao] ou [0, versaoAtual]
const CAS_SCRIPT = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v ~= tonumber(ARGV[1]) then return {0, v} end
redis.call('SET', KEYS[2], ARGV[2])
return {1, redis.call('INCR', KEYS[1])}`;

/* ---------- acesso ao Redis ---------- */

const mem = globalThis.__gnMem || (globalThis.__gnMem = new Map());

async function redis(...cmd) {
  // na Vercel sem banco, a memória some entre chamadas: melhor falhar do que perder dados
  if (!REDIS_URL && process.env.VERCEL) throw new Error('banco_nao_configurado');
  if (!REDIS_URL) return memRedis(cmd);
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function memRedis([op, ...a]) {
  switch (op) {
    case 'GET': return mem.get(a[0]) ?? null;
    case 'MGET': return a.map(k => mem.get(k) ?? null);
    case 'SET':
      if (a[2] === 'NX' && mem.has(a[0])) return null;
      mem.set(a[0], String(a[1]));
      return 'OK';
    case 'INCR': { const v = Number(mem.get(a[0]) || 0) + 1; mem.set(a[0], String(v)); return v; }
    case 'DEL': mem.delete(a[0]); return 1;
    case 'EXPIRE': return 1;
    case 'EVAL': { // só o CAS_SCRIPT
      const [, , verKey, stateKey, expected, value] = a;
      const v = Number(mem.get(verKey) || 0);
      if (v !== Number(expected)) return [0, v];
      mem.set(stateKey, value);
      mem.set(verKey, String(v + 1));
      return [1, v + 1];
    }
    default: throw new Error('op ' + op);
  }
}

/* ---------- utilidades ---------- */

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function newCode() {
  const bytes = crypto.randomBytes(6);
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
}

const hashPin = (salt, pin) => crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');

function validState(state) {
  if (state === null) return true;
  if (typeof state !== 'object' || Array.isArray(state)) return false;
  return JSON.stringify(state).length <= MAX_STATE_BYTES;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

// devolve null se o PIN confere, ou uma Response de erro
async function checkPin(code, pin) {
  if (!CODE_RE.test(code)) return json({ error: 'codigo_invalido' }, 400);
  const [metaRaw, failsRaw] = await redis('MGET', key(code, 'meta'), key(code, 'fails'));
  if (!metaRaw) return json({ error: 'nao_encontrado' }, 404);
  if (Number(failsRaw || 0) >= MAX_FAILS) return json({ error: 'bloqueado' }, 429);
  const meta = JSON.parse(metaRaw);
  const ok = PIN_RE.test(String(pin)) && crypto.timingSafeEqual(
    Buffer.from(hashPin(meta.salt, String(pin)), 'hex'),
    Buffer.from(meta.pinHash, 'hex'),
  );
  if (!ok) {
    await redis('INCR', key(code, 'fails'));
    await redis('EXPIRE', key(code, 'fails'), LOCK_SECONDS);
    return json({ error: 'pin_invalido' }, 401);
  }
  if (failsRaw) await redis('DEL', key(code, 'fails'));
  return null;
}

/* ---------- rotas ---------- */

async function getGroup(request) {
  const params = new URL(request.url).searchParams;
  const code = cleanCode(params.get('code'));
  if (!CODE_RE.test(code)) return json({ error: 'codigo_invalido' }, 400);
  const [meta, state, ver] = await redis('MGET', key(code, 'meta'), key(code, 'state'), key(code, 'ver'));
  if (!meta) return json({ error: 'nao_encontrado' }, 404);
  const version = Number(ver || 0);
  if (params.get('since') !== null && Number(params.get('since')) === version) return json({ code, version, same: true });
  return json({ code, version, state: state ? JSON.parse(state) : null });
}

async function postGroup(request) {
  const body = await readBody(request);

  if (body.action === 'create') {
    const pin = String(body.pin || '');
    if (!PIN_RE.test(pin)) return json({ error: 'pin_invalido' }, 400);
    const state = body.state ?? null;
    if (!validState(state)) return json({ error: 'estado_invalido' }, 400);
    const salt = crypto.randomBytes(16).toString('hex');
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      const meta = JSON.stringify({ salt, pinHash: hashPin(salt, pin), createdAt: Date.now() });
      if (await redis('SET', key(code, 'meta'), meta, 'NX')) {
        await redis('SET', key(code, 'state'), JSON.stringify(state));
        await redis('SET', key(code, 'ver'), '1');
        return json({ code, version: 1 }, 201);
      }
    }
    return json({ error: 'tente_de_novo' }, 503);
  }

  if (body.action === 'verify') {
    const err = await checkPin(cleanCode(body.code), body.pin);
    return err || json({ ok: true });
  }

  return json({ error: 'acao_invalida' }, 400);
}

async function putGroup(request) {
  const body = await readBody(request);
  const code = cleanCode(body.code);
  const err = await checkPin(code, body.pin);
  if (err) return err;
  if (!validState(body.state)) return json({ error: 'estado_invalido' }, 400);

  const [saved, version] = await redis('EVAL', CAS_SCRIPT, '2', key(code, 'ver'), key(code, 'state'),
    String(Number(body.version) || 0), JSON.stringify(body.state));
  if (saved) return json({ version: Number(version) });

  // alguém salvou antes: devolve o estado atual para o app se atualizar
  const state = await redis('GET', key(code, 'state'));
  return json({ error: 'conflito', version: Number(version), state: state ? JSON.parse(state) : null }, 409);
}

const safe = fn => async request => {
  try {
    return await fn(request);
  } catch (e) {
    const noDb = e.message === 'banco_nao_configurado';
    return json({ error: noDb ? 'banco_nao_configurado' : 'erro_servidor' }, noDb ? 503 : 500);
  }
};

export const GET = safe(getGroup);
export const POST = safe(postGroup);
export const PUT = safe(putGroup);
