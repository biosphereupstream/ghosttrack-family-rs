import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

// --- Rust WebAssembly Engine Loader ---
let wasmExports = null;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

function getRustWasm() {
  if (wasmExports) return wasmExports;

  const candidates = [
    path.join(process.cwd(), 'public', 'wasm', 'ghosttrack_core.wasm'),
    path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public', 'wasm', 'ghosttrack_core.wasm'),
  ];

  let wasmBytes = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      wasmBytes = fs.readFileSync(p);
      break;
    }
  }
  if (!wasmBytes) {
    throw new Error(`ghosttrack_core.wasm not found in: ${candidates.join(', ')}`);
  }

  const mod = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(mod, {});
  wasmExports = instance.exports;
  return wasmExports;
}

function callWasmJson(fnName, inputStr) {
  const wasm = getRustWasm();
  const encoded = textEncoder.encode(inputStr);
  const inPtr = wasm.alloc(encoded.length);
  new Uint8Array(wasm.memory.buffer, inPtr, encoded.length).set(encoded);

  const outPtr = wasm[fnName](inPtr, encoded.length);
  const outLen = wasm.wasm_last_len();

  const outCopy = new Uint8Array(wasm.memory.buffer, outPtr, outLen).slice();
  wasm.dealloc(inPtr, encoded.length);
  wasm.dealloc(outPtr, outLen);

  return JSON.parse(textDecoder.decode(outCopy));
}

function rustParsePhone(number) {
  return callWasmJson('wasm_parse_phone', String(number || ''));
}

function rustHashPin(groupCode, pin) {
  return callWasmJson('wasm_hash_pin', JSON.stringify({ group_code: String(groupCode || ''), pin: String(pin || '') }));
}

function rustCheckGeofence(lat, lng, zones) {
  return callWasmJson('wasm_check_geofence', JSON.stringify({ lat, lng, zones }));
}

function rustOsintTargets(username) {
  return callWasmJson('wasm_osint_platforms', String(username || ''));
}

// --- Lazy Neon PostgreSQL Connection ---
let _sql = null;
let _schemaReady = false;

function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '';
}

function getSql() {
  if (_sql) return _sql;
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) return null;
  _sql = neon(dbUrl);
  return _sql;
}

async function ensureSchema(sql) {
  if (_schemaReady || !sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS family_groups (
      group_code TEXT PRIMARY KEY,
      family_name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS family_members (
      group_code TEXT NOT NULL REFERENCES family_groups(group_code) ON DELETE CASCADE,
      member_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Anggota',
      phone TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '📱',
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      accuracy_m DOUBLE PRECISION NOT NULL DEFAULT 10,
      speed_kmh DOUBLE PRECISION NOT NULL DEFAULT 0,
      battery_pct INTEGER NOT NULL DEFAULT 100,
      status_label TEXT NOT NULL DEFAULT 'Aktif',
      sos_active BOOLEAN NOT NULL DEFAULT FALSE,
      consent_granted BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_code, member_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS safe_zones (
      id TEXT PRIMARY KEY,
      group_code TEXT NOT NULL REFERENCES family_groups(group_code) ON DELETE CASCADE,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      radius_m DOUBLE PRECISION NOT NULL DEFAULT 250
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS location_history (
      id BIGSERIAL PRIMARY KEY,
      group_code TEXT NOT NULL REFERENCES family_groups(group_code) ON DELETE CASCADE,
      member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      battery_pct INTEGER NOT NULL DEFAULT 100,
      status_label TEXT NOT NULL DEFAULT 'Aktif',
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Seed default demo circle KEL-777 (PIN: 1234) if absent
  const existing = await sql`SELECT group_code FROM family_groups WHERE group_code = 'KEL-777' LIMIT 1`;
  if (existing.length === 0) {
    const { hash } = rustHashPin('KEL-777', '1234');
    await sql`
      INSERT INTO family_groups (group_code, family_name, pin_hash)
      VALUES ('KEL-777', 'Keluarga Nusantara (Demo)', ${hash})
      ON CONFLICT (group_code) DO NOTHING
    `;

    await sql`
      INSERT INTO family_members (group_code, member_id, name, role, phone, avatar, lat, lng, accuracy_m, speed_kmh, battery_pct, status_label, sos_active, consent_granted)
      VALUES
        ('KEL-777', 'ayah', 'Ayah (Budi)', 'Orang Tua', '+6281234567890', '👨', -6.175392, 106.827153, 12.0, 0.0, 84, 'Di Kantor', FALSE, TRUE),
        ('KEL-777', 'ibu', 'Ibu (Sari)', 'Orang Tua', '+6281598765432', '👩', -6.186486, 106.834091, 9.5, 0.0, 91, 'Di Rumah', FALSE, TRUE),
        ('KEL-777', 'anak', 'Raka (Anak)', 'Anak', '+6289611223344', '🧒', -6.194957, 106.823045, 15.0, 18.4, 63, 'Pulang Sekolah', FALSE, TRUE)
      ON CONFLICT (group_code, member_id) DO NOTHING
    `;

    await sql`
      INSERT INTO safe_zones (id, group_code, name, lat, lng, radius_m)
      VALUES
        ('sz-home-777', 'KEL-777', 'Rumah Keluarga', -6.186486, 106.834091, 250),
        ('sz-school-777', 'KEL-777', 'Sekolah / Kampus', -6.194957, 106.823045, 300)
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO location_history (group_code, member_id, member_name, lat, lng, battery_pct, status_label)
      VALUES
        ('KEL-777', 'anak', 'Raka (Anak)', -6.198200, 106.821100, 68, 'Berangkat Pulang'),
        ('KEL-777', 'anak', 'Raka (Anak)', -6.194957, 106.823045, 63, 'Pulang Sekolah')
    `;
  }

  _schemaReady = true;
}

// --- In-Memory Fallback (Only when DATABASE_URL is absent) ---
const memGroups = new Map();
function ensureMemDemo() {
  if (memGroups.size > 0) return;
  const { hash } = rustHashPin('KEL-777', '1234');
  const now = new Date().toISOString();
  memGroups.set('KEL-777', {
    group_code: 'KEL-777',
    family_name: 'Keluarga Nusantara (Demo)',
    pin_hash: hash,
    created_at: now,
    members: new Map([
      ['ayah', { member_id: 'ayah', name: 'Ayah (Budi)', role: 'Orang Tua', phone: '+6281234567890', avatar: '👨', lat: -6.175392, lng: 106.827153, accuracy_m: 12, speed_kmh: 0, battery_pct: 84, status_label: 'Di Kantor', sos_active: false, consent_granted: true, updated_at: now }],
      ['ibu', { member_id: 'ibu', name: 'Ibu (Sari)', role: 'Orang Tua', phone: '+6281598765432', avatar: '👩', lat: -6.186486, lng: 106.834091, accuracy_m: 9.5, speed_kmh: 0, battery_pct: 91, status_label: 'Di Rumah', sos_active: false, consent_granted: true, updated_at: now }],
      ['anak', { member_id: 'anak', name: 'Raka (Anak)', role: 'Anak', phone: '+6289611223344', avatar: '🧒', lat: -6.194957, lng: 106.823045, accuracy_m: 15, speed_kmh: 18.4, battery_pct: 63, status_label: 'Pulang Sekolah', sos_active: false, consent_granted: true, updated_at: now }],
    ]),
    safe_zones: [
      { id: 'sz-home-777', name: 'Rumah Keluarga', lat: -6.186486, lng: 106.834091, radius_m: 250 },
      { id: 'sz-school-777', name: 'Sekolah / Kampus', lat: -6.194957, lng: 106.823045, radius_m: 300 },
    ],
    history: [
      { member_id: 'anak', member_name: 'Raka (Anak)', lat: -6.1982, lng: 106.8211, battery_pct: 68, status_label: 'Berangkat Pulang', recorded_at: now },
      { member_id: 'anak', member_name: 'Raka (Anak)', lat: -6.194957, lng: 106.823045, battery_pct: 63, status_label: 'Pulang Sekolah', recorded_at: now },
    ],
  });
}

function getRouteName(url) {
  const r = url.searchParams.get('__route');
  if (r) return r.replace(/^\/+|\/+$/g, '').split('/')[0];
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] === 'api' && parts[1]) return parts[1];
  return 'health';
}

async function handleHealth() {
  let wasmLoaded = false;
  let wasmError = null;
  try {
    getRustWasm();
    wasmLoaded = true;
  } catch (err) {
    wasmError = err.message;
  }

  const sql = getSql();
  let dbMode = 'in-memory-fallback';
  let dbPing = false;
  let dbError = null;

  if (sql) {
    dbMode = 'neon-postgres';
    try {
      await ensureSchema(sql);
      await sql`SELECT 1 AS ok`;
      dbPing = true;
    } catch (err) {
      dbError = err.message;
    }
  }

  return jsonResponse({
    ok: wasmLoaded && (sql ? dbPing : true),
    engine: 'Vercel Serverless + Rust WebAssembly (ghosttrack_core.wasm)',
    rust_wasm_loaded: wasmLoaded,
    wasm_error: wasmError,
    database_mode: dbMode,
    db_ping: dbPing,
    db_error: dbError,
    timestamp: new Date().toISOString(),
  });
}

async function handlePhone(url) {
  const number = url.searchParams.get('number') || '';
  const info = rustParsePhone(number);
  const familyMatches = [];

  if (info.valid) {
    const sql = getSql();
    if (sql) {
      try {
        await ensureSchema(sql);
        const rows = await sql`
          SELECT m.group_code, g.family_name, m.member_id, m.name, m.phone, m.lat, m.lng, m.battery_pct, m.status_label, m.sos_active, m.updated_at
          FROM family_members m
          JOIN family_groups g ON g.group_code = m.group_code
          WHERE m.phone = ${info.e164}
        `;
        for (const r of rows) {
          familyMatches.push(r);
        }
      } catch (err) {
        console.error('Phone family lookup error:', err);
      }
    } else {
      ensureMemDemo();
      for (const g of memGroups.values()) {
        for (const m of g.members.values()) {
          const mp = rustParsePhone(m.phone);
          if (mp.e164 === info.e164) {
            familyMatches.push({
              group_code: g.group_code,
              family_name: g.family_name,
              member_id: m.member_id,
              name: m.name,
              phone: m.phone,
              lat: m.lat,
              lng: m.lng,
              battery_pct: m.battery_pct,
              status_label: m.status_label,
              sos_active: m.sos_active,
              updated_at: m.updated_at,
            });
          }
        }
      }
    }
  }

  return jsonResponse({
    ok: true,
    engine: 'rust-wasm',
    phone: info,
    family_matches: familyMatches,
  });
}

async function handleIp(url, req) {
  let targetIp = (url.searchParams.get('ip') || '').trim();
  if (!targetIp) {
    const fwd = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
    targetIp = fwd.split(',')[0].trim();
  }

  const endpoint = targetIp
    ? `https://ipwho.is/${encodeURIComponent(targetIp)}`
    : 'https://ipwho.is/';

  try {
    const resp = await fetch(endpoint, {
      signal: AbortSignal.timeout(7000),
      headers: { 'User-Agent': 'GhostTrack-Family-Rust/1.0' },
    });
    const data = await resp.json();
    return jsonResponse({
      ok: Boolean(data.success !== false),
      queried_ip: targetIp || data.ip || '',
      ...data,
    });
  } catch (err) {
    return jsonResponse({ ok: false, success: false, message: err.message }, 502);
  }
}

async function handleUsername(url) {
  const username = (url.searchParams.get('username') || '').trim();
  const targets = rustOsintTargets(username);
  if (!targets || targets.length === 0) {
    return jsonResponse({ ok: false, error: 'Masukkan username yang valid' }, 400);
  }

  const results = await Promise.all(
    targets.map(async (t) => {
      let status = 'check_manually';
      let httpCode = null;
      try {
        const res = await fetch(t.url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(3500),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
          },
        });
        httpCode = res.status;
        if (res.status >= 200 && res.status < 300) {
          status = 'found';
        } else if (res.status === 404) {
          status = 'not_found';
        }
      } catch {
        status = 'check_manually';
      }
      return {
        site: t.site,
        url: t.url,
        category: t.category,
        status,
        http_status: httpCode,
      };
    }),
  );

  return jsonResponse({
    ok: true,
    engine: 'rust-wasm',
    username: username.replace(/^@/, ''),
    total: results.length,
    results,
  });
}

async function fetchNeonGroupPayload(sql, groupCode, pin) {
  await ensureSchema(sql);
  const { normalized_code: code, hash } = rustHashPin(groupCode, pin);

  const groups = await sql`SELECT group_code, family_name, pin_hash, created_at FROM family_groups WHERE group_code = ${code} LIMIT 1`;
  if (groups.length === 0) {
    return { status: 404, body: { ok: false, error: `Grup keluarga "${code}" tidak ditemukan` } };
  }
  if (groups[0].pin_hash !== hash) {
    return { status: 401, body: { ok: false, error: 'PIN grup keluarga salah' } };
  }

  const [members, safeZones, history] = await Promise.all([
    sql`SELECT member_id, name, role, phone, avatar, lat, lng, accuracy_m, speed_kmh, battery_pct, status_label, sos_active, consent_granted, updated_at FROM family_members WHERE group_code = ${code} ORDER BY name ASC`,
    sql`SELECT id, name, lat, lng, radius_m FROM safe_zones WHERE group_code = ${code} ORDER BY name ASC`,
    sql`SELECT member_id, member_name, lat, lng, battery_pct, status_label, recorded_at FROM location_history WHERE group_code = ${code} ORDER BY recorded_at DESC LIMIT 80`,
  ]);

  const enrichedMembers = members.map((m) => ({
    ...m,
    geofences: rustCheckGeofence(Number(m.lat), Number(m.lng), safeZones),
  }));

  return {
    status: 200,
    body: {
      ok: true,
      storage: 'neon-postgres',
      group_code: groups[0].group_code,
      family_name: groups[0].family_name,
      created_at: groups[0].created_at,
      members: enrichedMembers,
      safe_zones: safeZones,
      history: history.reverse(),
    },
  };
}

function fetchMemGroupPayload(groupCode, pin) {
  ensureMemDemo();
  const { normalized_code: code, hash } = rustHashPin(groupCode, pin);
  const g = memGroups.get(code);
  if (!g) return { status: 404, body: { ok: false, error: `Grup keluarga "${code}" tidak ditemukan` } };
  if (g.pin_hash !== hash) return { status: 401, body: { ok: false, error: 'PIN grup keluarga salah' } };

  const members = Array.from(g.members.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({
      ...m,
      geofences: rustCheckGeofence(m.lat, m.lng, g.safe_zones),
    }));

  return {
    status: 200,
    body: {
      ok: true,
      storage: 'in-memory-fallback',
      group_code: g.group_code,
      family_name: g.family_name,
      created_at: g.created_at,
      members,
      safe_zones: g.safe_zones,
      history: g.history.slice(-80),
    },
  };
}

async function handleFamilyGet(url) {
  const groupCode = url.searchParams.get('group_code') || 'KEL-777';
  const pin = url.searchParams.get('pin') || '1234';
  const sql = getSql();

  if (sql) {
    try {
      const res = await fetchNeonGroupPayload(sql, groupCode, pin);
      return jsonResponse(res.body, res.status);
    } catch (err) {
      console.error('Neon GET /api/family error:', err);
      return jsonResponse({ ok: false, error: err.message }, 500);
    }
  }
  const res = fetchMemGroupPayload(groupCode, pin);
  return jsonResponse(res.body, res.status);
}

async function handleFamilyPost(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON body tidak valid' }, 400);
  }

  const action = body.action || '';
  const sql = getSql();

  if (!sql) {
    ensureMemDemo();
    if (action === 'create_group') {
      const rawCode = (body.group_code || '').trim() || `KEL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const pin = String(body.pin || '1234');
      const { normalized_code: code, hash } = rustHashPin(rawCode, pin);
      if (memGroups.has(code)) return jsonResponse({ ok: false, error: 'Kode grup sudah digunakan' }, 409);
      memGroups.set(code, {
        group_code: code,
        family_name: (body.family_name || 'Keluarga Saya').trim(),
        pin_hash: hash,
        created_at: new Date().toISOString(),
        members: new Map(),
        safe_zones: [],
        history: [],
      });
      const res = fetchMemGroupPayload(code, pin);
      return jsonResponse(res.body, 201);
    }
    if (action === 'update_location' || action === 'toggle_sos') {
      const groupCode = body.group_code || 'KEL-777';
      const pin = String(body.pin || '1234');
      const { normalized_code: code, hash } = rustHashPin(groupCode, pin);
      const g = memGroups.get(code);
      if (!g) return jsonResponse({ ok: false, error: 'Grup tidak ditemukan' }, 404);
      if (g.pin_hash !== hash) return jsonResponse({ ok: false, error: 'PIN salah' }, 401);

      const memberId = String(body.member_id || body.name || 'member-1').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const prev = g.members.get(memberId);
      const now = new Date().toISOString();
      const phoneInfo = body.phone ? rustParsePhone(body.phone) : null;
      const member = {
        member_id: memberId,
        name: (body.name || prev?.name || memberId).trim(),
        role: (body.role || prev?.role || 'Anggota').trim(),
        phone: phoneInfo?.valid ? phoneInfo.e164 : (body.phone || prev?.phone || ''),
        avatar: body.avatar || prev?.avatar || '📱',
        lat: typeof body.lat === 'number' ? body.lat : (prev?.lat ?? -6.175392),
        lng: typeof body.lng === 'number' ? body.lng : (prev?.lng ?? 106.827153),
        accuracy_m: typeof body.accuracy_m === 'number' ? body.accuracy_m : (prev?.accuracy_m ?? 10),
        speed_kmh: typeof body.speed_kmh === 'number' ? body.speed_kmh : (prev?.speed_kmh ?? 0),
        battery_pct: typeof body.battery_pct === 'number' ? Math.max(0, Math.min(100, Math.round(body.battery_pct))) : (prev?.battery_pct ?? 85),
        status_label: body.status_label || (body.sos_active ? 'SOS DARURAT' : prev?.status_label || 'Aktif'),
        sos_active: typeof body.sos_active === 'boolean' ? body.sos_active : (prev?.sos_active ?? false),
        consent_granted: body.consent_granted !== false,
        updated_at: now,
      };
      g.members.set(memberId, member);
      g.history.push({ member_id: memberId, member_name: member.name, lat: member.lat, lng: member.lng, battery_pct: member.battery_pct, status_label: member.status_label, recorded_at: now });
      const res = fetchMemGroupPayload(code, pin);
      return jsonResponse(res.body, 200);
    }
    if (action === 'add_safe_zone') {
      const groupCode = body.group_code || 'KEL-777';
      const pin = String(body.pin || '1234');
      const { normalized_code: code, hash } = rustHashPin(groupCode, pin);
      const g = memGroups.get(code);
      if (!g) return jsonResponse({ ok: false, error: 'Grup tidak ditemukan' }, 404);
      if (g.pin_hash !== hash) return jsonResponse({ ok: false, error: 'PIN salah' }, 401);
      g.safe_zones.push({
        id: `sz-${Date.now()}`,
        name: (body.zone_name || 'Zona Aman').trim(),
        lat: Number(body.lat ?? -6.175392),
        lng: Number(body.lng ?? 106.827153),
        radius_m: Math.max(50, Number(body.radius_m ?? 250)),
      });
      const res = fetchMemGroupPayload(code, pin);
      return jsonResponse(res.body, 200);
    }
    return jsonResponse({ ok: false, error: 'Action tidak didukung' }, 400);
  }

  try {
    await ensureSchema(sql);

    if (action === 'create_group') {
      const familyName = (body.family_name || 'Keluarga Saya').trim();
      const pin = String(body.pin || '1234').trim();
      const rawCode = (body.group_code || '').trim() || `KEL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const { normalized_code: code, hash } = rustHashPin(rawCode, pin);

      const exists = await sql`SELECT group_code FROM family_groups WHERE group_code = ${code} LIMIT 1`;
      if (exists.length > 0) {
        return jsonResponse({ ok: false, error: `Kode grup "${code}" sudah terdaftar` }, 409);
      }

      await sql`
        INSERT INTO family_groups (group_code, family_name, pin_hash)
        VALUES (${code}, ${familyName}, ${hash})
      `;
      const res = await fetchNeonGroupPayload(sql, code, pin);
      return jsonResponse(res.body, 201);
    }

    const groupCode = body.group_code || '';
    const pin = String(body.pin || '');
    const { normalized_code: code, hash } = rustHashPin(groupCode, pin);
    const groups = await sql`SELECT group_code, pin_hash FROM family_groups WHERE group_code = ${code} LIMIT 1`;
    if (groups.length === 0) {
      return jsonResponse({ ok: false, error: `Grup "${code}" tidak ditemukan` }, 404);
    }
    if (groups[0].pin_hash !== hash) {
      return jsonResponse({ ok: false, error: 'PIN grup salah' }, 401);
    }

    if (action === 'update_location' || action === 'toggle_sos') {
      const memberId = String(body.member_id || body.name || 'member-1')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-');
      const existing = await sql`SELECT * FROM family_members WHERE group_code = ${code} AND member_id = ${memberId} LIMIT 1`;
      const prev = existing[0] || null;

      const name = (body.name || prev?.name || memberId).trim();
      const role = (body.role || prev?.role || 'Anggota').trim();
      const parsedPhone = body.phone ? rustParsePhone(body.phone) : null;
      const phone = parsedPhone?.valid ? parsedPhone.e164 : (body.phone || prev?.phone || '');
      const avatar = body.avatar || prev?.avatar || '📱';
      const lat = typeof body.lat === 'number' ? body.lat : Number(prev?.lat ?? -6.175392);
      const lng = typeof body.lng === 'number' ? body.lng : Number(prev?.lng ?? 106.827153);
      const accuracyM = typeof body.accuracy_m === 'number' ? body.accuracy_m : Number(prev?.accuracy_m ?? 10);
      const speedKmh = typeof body.speed_kmh === 'number' ? body.speed_kmh : Number(prev?.speed_kmh ?? 0);
      const batteryPct = typeof body.battery_pct === 'number' ? Math.max(0, Math.min(100, Math.round(body.battery_pct))) : Number(prev?.battery_pct ?? 85);
      const sosActive = typeof body.sos_active === 'boolean' ? body.sos_active : Boolean(prev?.sos_active ?? false);
      const statusLabel = body.status_label || (sosActive ? 'SOS DARURAT' : prev?.status_label || 'Aktif');
      const consentGranted = body.consent_granted !== false;

      await sql`
        INSERT INTO family_members (group_code, member_id, name, role, phone, avatar, lat, lng, accuracy_m, speed_kmh, battery_pct, status_label, sos_active, consent_granted, updated_at)
        VALUES (${code}, ${memberId}, ${name}, ${role}, ${phone}, ${avatar}, ${lat}, ${lng}, ${accuracyM}, ${speedKmh}, ${batteryPct}, ${statusLabel}, ${sosActive}, ${consentGranted}, NOW())
        ON CONFLICT (group_code, member_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          phone = EXCLUDED.phone,
          avatar = EXCLUDED.avatar,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          accuracy_m = EXCLUDED.accuracy_m,
          speed_kmh = EXCLUDED.speed_kmh,
          battery_pct = EXCLUDED.battery_pct,
          status_label = EXCLUDED.status_label,
          sos_active = EXCLUDED.sos_active,
          consent_granted = EXCLUDED.consent_granted,
          updated_at = NOW()
      `;

      await sql`
        INSERT INTO location_history (group_code, member_id, member_name, lat, lng, battery_pct, status_label)
        VALUES (${code}, ${memberId}, ${name}, ${lat}, ${lng}, ${batteryPct}, ${statusLabel})
      `;

      const res = await fetchNeonGroupPayload(sql, code, pin);
      return jsonResponse(res.body, 200);
    }

    if (action === 'add_safe_zone') {
      const zoneId = `sz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const zoneName = (body.zone_name || 'Zona Aman').trim();
      const lat = Number(body.lat ?? -6.175392);
      const lng = Number(body.lng ?? 106.827153);
      const radiusM = Math.max(50, Number(body.radius_m ?? 250));

      await sql`
        INSERT INTO safe_zones (id, group_code, name, lat, lng, radius_m)
        VALUES (${zoneId}, ${code}, ${zoneName}, ${lat}, ${lng}, ${radiusM})
      `;

      const res = await fetchNeonGroupPayload(sql, code, pin);
      return jsonResponse(res.body, 200);
    }

    if (action === 'delete_safe_zone') {
      const zoneId = String(body.zone_id || '');
      await sql`DELETE FROM safe_zones WHERE id = ${zoneId} AND group_code = ${code}`;
      const res = await fetchNeonGroupPayload(sql, code, pin);
      return jsonResponse(res.body, 200);
    }

    return jsonResponse({ ok: false, error: 'Action tidak dikenal' }, 400);
  } catch (err) {
    console.error('Neon POST /api/family error:', err);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req) {
  const url = new URL(req.url);
  const route = getRouteName(url);
  if (route === 'health') return handleHealth();
  if (route === 'phone') return handlePhone(url);
  if (route === 'ip') return handleIp(url, req);
  if (route === 'username') return handleUsername(url);
  if (route === 'family') return handleFamilyGet(url);
  return jsonResponse({ ok: false, error: `Unknown GET route: ${route}` }, 404);
}

export async function POST(req) {
  const url = new URL(req.url);
  const route = getRouteName(url);
  if (route === 'family') return handleFamilyPost(req);
  return jsonResponse({ ok: false, error: `Unknown POST route: ${route}` }, 404);
}
