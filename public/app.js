// GhostTrack Family Locator — Frontend App (Rust WASM + Leaflet + Vercel/Neon API)

const state = {
  wasm: null,
  familyMap: null,
  ipMap: null,
  familyLayers: {
    markers: null,
    zones: null,
    trails: null,
  },
  ipMarker: null,
  watchId: null,
  sosActive: false,
  lastCoords: null,
  currentGroup: null,
  deferredInstallPrompt: null,
  sirenEnabled: localStorage.getItem('gt_siren') !== 'false',
  lastAlertId: null,
  androidBgActive: false,
  memberId: localStorage.getItem('gt_member_id') || `hp-${Math.random().toString(36).slice(2, 7)}`,
};

localStorage.setItem('gt_member_id', state.memberId);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

const DEFAULT_REMOTE_API = 'https://ghosttrack-family-rs.vercel.app';
function apiUrl(path) {
  const host = window.location.hostname;
  const isNativeContainer =
    window.location.protocol === 'file:' ||
    host === 'appassets.androidplatform.net' ||
    host.endsWith('tauri.localhost');
  if (isNativeContainer) {
    const base = localStorage.getItem('gt_api_base') || window.__GHOSTTRACK_API_BASE__ || DEFAULT_REMOTE_API;
    return `${base.replace(/\/+$/, '')}${path}`;
  }
  return path;
}

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = isError ? '#ef4444' : '#10b981';
  el.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 3600);
}

// --- Rust WebAssembly Browser Bridge ---
async function initRustWasm() {
  const pill = document.getElementById('wasm-pill');
  try {
    const resp = await fetch('./wasm/ghosttrack_core.wasm');
    const bytes = await resp.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    state.wasm = instance.exports;
    pill.className = 'pill ok';
    pill.innerHTML = '<span class="dot"></span> Rust WASM Core v1.0 Active';
  } catch (err) {
    console.warn('WASM load fallback to API:', err);
    pill.className = 'pill danger';
    pill.innerHTML = '<span class="dot"></span> WASM Offline (API Fallback)';
  }
}

function callWasmJson(fnName, inputStr) {
  const w = state.wasm;
  if (!w) return null;
  const encoded = textEncoder.encode(inputStr);
  const inPtr = w.alloc(encoded.length);
  new Uint8Array(w.memory.buffer, inPtr, encoded.length).set(encoded);
  const outPtr = w[fnName](inPtr, encoded.length);
  const outLen = w.wasm_last_len();
  const outBytes = new Uint8Array(w.memory.buffer, outPtr, outLen).slice();
  w.dealloc(inPtr, encoded.length);
  w.dealloc(outPtr, outLen);
  return JSON.parse(textDecoder.decode(outBytes));
}

function wasmParsePhone(number) {
  return callWasmJson('wasm_parse_phone', String(number || ''));
}

function wasmRouteStats(points) {
  return callWasmJson('wasm_calculate_route_stats', JSON.stringify(points || []));
}

function playSosSiren(alertMsg = '') {
  if (state.sirenEnabled) {
    try {
      if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 400]);
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(760, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1120, ctx.currentTime + 0.25);
        osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.56);
      }
    } catch {
      // ignore autoplay audio blocks
    }
  }
  if (alertMsg && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('🚨 Peringatan GhostTrack Family', { body: alertMsg });
    } catch {
      // ignore unsupported notification constructor
    }
  }
}

// --- Health & Storage Badge ---
async function checkHealth() {
  const pill = document.getElementById('db-pill');
  try {
    const res = await fetch(apiUrl('/api/health'));
    const data = await res.json();
    if (data.database_mode === 'neon-postgres' && data.db_ping) {
      pill.className = 'pill ok';
      pill.innerHTML = '<span class="dot"></span> Neon Postgres Connected';
    } else if (data.database_mode === 'neon-postgres') {
      pill.className = 'pill danger';
      pill.innerHTML = '<span class="dot"></span> Neon DB Error';
    } else {
      pill.className = 'pill cyan';
      pill.innerHTML = '<span class="dot"></span> Hybrid Memory Mode';
    }
  } catch {
    pill.className = 'pill danger';
    pill.innerHTML = '<span class="dot"></span> API Offline';
  }
}

// --- Map Setup ---
function initFamilyMap() {
  if (state.familyMap) return;
  const map = L.map('family-map', { zoomControl: true }).setView([-6.185, 106.828], 13);

  const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  });
  const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  });

  osmLayer.addTo(map);
  L.control.layers({ 'Peta Jalan (OSM)': osmLayer, 'Dark Tactical': darkLayer }).addTo(map);

  state.familyLayers.trails = L.layerGroup().addTo(map);
  state.familyLayers.zones = L.layerGroup().addTo(map);
  state.familyLayers.markers = L.layerGroup().addTo(map);
  state.familyMap = map;
}

function getCredentials() {
  const code = (document.getElementById('group-code').value || 'KEL-777').trim().toUpperCase();
  const pin = (document.getElementById('group-pin').value || '1234').trim();
  localStorage.setItem('gt_group_code', code);
  localStorage.setItem('gt_group_pin', pin);
  document.getElementById('circle-pill').textContent = `Grup: ${code}`;
  return { code, pin };
}

function restoreSavedFields() {
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('join');
  const joinPin = params.get('pin');

  const savedCode = joinCode || localStorage.getItem('gt_group_code');
  const savedPin = joinPin || localStorage.getItem('gt_group_pin');
  const savedName = localStorage.getItem('gt_my_name');
  const savedPhone = localStorage.getItem('gt_my_phone');
  if (savedCode) document.getElementById('group-code').value = savedCode.toUpperCase();
  if (savedPin) document.getElementById('group-pin').value = savedPin;
  if (savedName) document.getElementById('my-name').value = savedName;
  if (savedPhone) document.getElementById('my-phone').value = savedPhone;

  if (joinCode) {
    localStorage.setItem('gt_group_code', joinCode.toUpperCase());
    if (joinPin) localStorage.setItem('gt_group_pin', joinPin);
    setTimeout(() => toast(`Bergabung otomatis ke Circle Keluarga "${joinCode.toUpperCase()}"!`), 350);
  }
}

function updateInviteBox() {
  const { code, pin } = getCredentials();
  const host = window.location.hostname;
  const origin =
    host === 'appassets.androidplatform.net' || host.endsWith('tauri.localhost') || window.location.protocol === 'file:'
      ? DEFAULT_REMOTE_API
      : window.location.origin;
  const inviteUrl = `${origin}/?join=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}`;

  const linkInput = document.getElementById('invite-link-input');
  const qrImg = document.getElementById('invite-qr-img');
  const waLink = document.getElementById('btn-share-wa');

  if (linkInput) linkInput.value = inviteUrl;
  if (qrImg) {
    qrImg.style.display = 'block';
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=6&data=${encodeURIComponent(inviteUrl)}`;
    qrImg.onerror = () => {
      qrImg.style.display = 'none';
    };
  }
  if (waLink) {
    const waText = `Halo! Ayo gabung ke Circle Keluarga GhostTrack (${code}, PIN: ${pin}) supaya kita bisa saling memantau lokasi GPS dengan aman:\n${inviteUrl}`;
    waLink.href = `https://wa.me/?text=${encodeURIComponent(waText)}`;
  }
}

async function getBatteryPct() {
  try {
    if (navigator.getBattery) {
      const bat = await navigator.getBattery();
      return Math.round(bat.level * 100);
    }
  } catch {
    // ignore unsupported browsers
  }
  return 88;
}

// --- Family API & Rendering ---
async function loadFamilyGroup(fitBounds = false) {
  const { code, pin } = getCredentials();
  try {
    const res = await fetch(apiUrl(`/api/family?group_code=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}`));
    const data = await res.json();
    if (!res.ok || !data.ok) {
      toast(data.error || 'Gagal memuat grup keluarga', true);
      return;
    }
    state.currentGroup = data;
    renderFamilyGroup(data, fitBounds);
  } catch (err) {
    toast(`Kesalahan jaringan: ${err.message}`, true);
  }
}

function renderFamilyGroup(data, fitBounds = false) {
  initFamilyMap();
  updateInviteBox();
  const { markers, zones, trails } = state.familyLayers;
  markers.clearLayers();
  zones.clearLayers();
  trails.clearLayers();

  document.getElementById('members-header').textContent = `👨‍👩‍👧‍👦 ${data.family_name} (${data.members.length} Anggota)`;

  const bounds = [];

  // Safe zones
  const szEl = document.getElementById('safezone-list');
  szEl.innerHTML = '';
  for (const z of data.safe_zones || []) {
    const circle = L.circle([z.lat, z.lng], {
      radius: z.radius_m,
      color: '#22d3ee',
      fillColor: '#22d3ee',
      fillOpacity: 0.12,
      weight: 1.5,
    }).bindPopup(`<strong>🛡️ ${esc(z.name)}</strong><br/>Radius: ${Math.round(z.radius_m)} m`);
    circle.addTo(zones);
    bounds.push([z.lat, z.lng]);

    const chip = document.createElement('span');
    chip.className = 'tag inside';
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.style.gap = '4px';
    chip.innerHTML = `🛡️ ${esc(z.name)} (${Math.round(z.radius_m)}m)`;
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-xs-del';
    delBtn.title = 'Hapus Safe Zone';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSafeZone(z.id, z.name);
    });
    chip.appendChild(delBtn);
    szEl.appendChild(chip);
  }
  if ((data.safe_zones || []).length === 0) {
    szEl.innerHTML = '<span class="tag">Belum ada Safe Zone. Tambahkan dari form di atas.</span>';
  }

  // Trails grouped by member
  const pathsByMember = new Map();
  const historyPointsByMember = new Map();
  for (const pt of data.history || []) {
    if (!pathsByMember.has(pt.member_id)) pathsByMember.set(pt.member_id, []);
    pathsByMember.get(pt.member_id).push([pt.lat, pt.lng]);

    if (!historyPointsByMember.has(pt.member_id)) historyPointsByMember.set(pt.member_id, []);
    historyPointsByMember.get(pt.member_id).push({
      lat: Number(pt.lat),
      lng: Number(pt.lng),
      battery_pct: Number(pt.battery_pct),
    });
  }
  for (const [, coords] of pathsByMember) {
    if (coords.length > 1) {
      L.polyline(coords, { color: '#10b981', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(trails);
    }
  }

  // Member markers & cards
  const listEl = document.getElementById('member-list');
  listEl.innerHTML = '';
  let anySos = false;

  for (const m of data.members || []) {
    bounds.push([m.lat, m.lng]);
    if (m.sos_active) anySos = true;

    const routeStats = m.route_stats || wasmRouteStats(historyPointsByMember.get(m.member_id) || []) || {
      point_count: 0,
      total_distance_km: 0,
    };

    const icon = L.divIcon({
      className: 'custom-member-icon',
      html: `<div class="marker-pin ${m.sos_active ? 'sos' : ''}">${esc(m.avatar)} ${esc(m.name.split(' ')[0])} ${m.sos_active ? '🚨' : ''}</div>`,
      iconSize: [120, 28],
      iconAnchor: [60, 14],
    });

    const timeStr = new Date(m.updated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const marker = L.marker([m.lat, m.lng], { icon }).bindPopup(
      `<strong>${esc(m.avatar)} ${esc(m.name)}</strong> (${esc(m.role)})<br/>` +
      `Status: <b>${esc(m.status_label)}</b><br/>` +
      `Baterai: ${m.battery_pct}% | Akurasi: ±${Math.round(m.accuracy_m)}m<br/>` +
      `Jarak Rute: ${Number(routeStats.total_distance_km || 0).toFixed(2)} km<br/>` +
      `Telp: ${esc(m.phone || '-')}<br/>` +
      `Update: ${esc(timeStr)}<br/>` +
      `<a href="https://maps.google.com/?q=${m.lat},${m.lng}" target="_blank" rel="noopener">Buka Google Maps</a>`,
    );
    marker.addTo(markers);

    const card = document.createElement('div');
    card.className = `member-card ${m.sos_active ? 'sos' : ''}`;
    const fencesHtml = (m.geofences || [])
      .map((g) => {
        const distLabel = g.distance_m >= 1000 ? `${(g.distance_m / 1000).toFixed(2)} km` : `${Math.round(g.distance_m)} m`;
        return `<span class="tag ${g.inside ? 'inside' : ''}">${g.inside ? '✅ Di dalam' : '📍'} ${esc(g.zone_name)}: ${distLabel}</span>`;
      })
      .join('');

    card.innerHTML = `
      <div class="member-head">
        <div class="member-id">
          <div class="avatar-badge">${esc(m.avatar)}</div>
          <div>
            <strong>${esc(m.name)}</strong>
            <div style="font-size:0.74rem;color:var(--muted);">${esc(m.role)} • ${esc(m.phone || 'No. HP belum diisi')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="pill ${m.sos_active ? 'danger' : 'ok'}">${esc(m.status_label)}</span>
          <button class="btn-xs-del" data-del-member="${esc(m.member_id)}" title="Hapus Anggota">🗑️</button>
        </div>
      </div>
      <div class="member-meta">
        <span>🔋 ${m.battery_pct}%</span>
        <span>🎯 ±${Math.round(m.accuracy_m)}m</span>
        <span>🚗 ${Number(m.speed_kmh || 0).toFixed(1)} km/j</span>
        <span>🛣️ ${Number(routeStats.total_distance_km || 0).toFixed(2)} km (${routeStats.point_count || 0} titik)</span>
        <span>🕒 ${esc(timeStr)}</span>
      </div>
      <div class="geofence-tags">${fencesHtml}</div>
    `;
    card.querySelector('[data-del-member]').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteMember(m.member_id, m.name);
    });
    card.addEventListener('click', () => {
      state.familyMap.setView([m.lat, m.lng], 16, { animate: true });
      marker.openPopup();
    });
    listEl.appendChild(card);
  }

  if ((data.members || []).length === 0) {
    listEl.innerHTML = '<p class="subtext">Belum ada anggota di grup ini. Tekan "Check-In Sekali" atau "Mulai Bagikan GPS Real-Time" untuk bergabung.</p>';
  }

  // Alerts list & Telegram status
  const alertsEl = document.getElementById('alerts-list');
  if (alertsEl) {
    alertsEl.innerHTML = '';
    const alerts = data.alerts || [];
    for (const a of alerts) {
      const t = new Date(a.created_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
      const row = document.createElement('div');
      row.className = `history-row ${a.alert_type === 'sos' ? 'sos-alert' : ''}`;
      row.innerHTML = `
        <span>${esc(a.message)}</span>
        <span style="color:var(--muted);font-family:var(--mono);white-space:nowrap;">${esc(t)}</span>
      `;
      alertsEl.appendChild(row);
    }
    if (alerts.length === 0) {
      alertsEl.innerHTML = '<p class="subtext" style="margin:0;">Belum ada peringatan SOS, Geofence, atau Baterai Kritis.</p>';
    }
    const newest = alerts[0];
    if (newest && newest.id !== state.lastAlertId) {
      const hadPrevious = state.lastAlertId !== null;
      state.lastAlertId = newest.id;
      if (hadPrevious && (newest.alert_type === 'sos' || anySos)) {
        playSosSiren(newest.message);
        toast(newest.message, true);
      }
    } else if (anySos && state.sirenEnabled) {
      playSosSiren('');
    }
  }

  const tgChatEl = document.getElementById('tg-chat-id');
  const tgStatEl = document.getElementById('tg-status-text');
  if (tgChatEl && !tgChatEl.value && data.telegram_chat_id) {
    tgChatEl.value = data.telegram_chat_id;
  }
  if (tgStatEl) {
    tgStatEl.textContent = data.telegram_configured
      ? `✅ Bot Telegram keluarga aktif (Chat ID: ${data.telegram_chat_id})`
      : 'Belum dikonfigurasi. Buat bot gratis via @BotFather di Telegram untuk alert otomatis.';
  }

  // History list
  const histEl = document.getElementById('history-list');
  histEl.innerHTML = '';
  const latestHistory = [...(data.history || [])].reverse().slice(0, 15);
  for (const h of latestHistory) {
    const t = new Date(h.recorded_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <span><strong>${esc(h.member_name)}</strong> — ${esc(h.status_label)} (🔋${h.battery_pct}%)</span>
      <span style="color:var(--muted);font-family:var(--mono);">${Number(h.lat).toFixed(4)}, ${Number(h.lng).toFixed(4)} • ${esc(t)}</span>
    `;
    histEl.appendChild(row);
  }

  if (fitBounds && bounds.length > 0) {
    state.familyMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
  }
}

async function createFamilyGroup() {
  const { code, pin } = getCredentials();
  const familyName = document.getElementById('family-name-input').value.trim() || `Keluarga ${code}`;
  try {
    const res = await fetch(apiUrl('/api/family'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_group',
        group_code: code,
        pin,
        family_name: familyName,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      toast(data.error || 'Gagal membuat grup', true);
      return;
    }
    document.getElementById('group-code').value = data.group_code;
    getCredentials();
    renderFamilyGroup(data, true);
    toast(`Grup "${data.group_code}" berhasil dibuat! Bagikan Kode & PIN ke keluarga.`);
  } catch (err) {
    toast(`Error: ${err.message}`, true);
  }
}

async function sendLocationUpdate(lat, lng, accuracy, speedMps) {
  const { code, pin } = getCredentials();
  const name = document.getElementById('my-name').value.trim() || 'HP Saya';
  const phone = document.getElementById('my-phone').value.trim();
  const role = document.getElementById('my-role').value;
  const statusLabel = state.sosActive ? 'SOS DARURAT' : document.getElementById('my-status').value;

  localStorage.setItem('gt_my_name', name);
  localStorage.setItem('gt_my_phone', phone);

  const battery = await getBatteryPct();
  const speedKmh = speedMps ? Number((speedMps * 3.6).toFixed(1)) : 0;

  const avatar = role === 'Orang Tua' ? '🛡️' : role === 'Anak' ? '🎒' : '📱';

  const res = await fetch(apiUrl('/api/family'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'update_location',
      group_code: code,
      pin,
      member_id: state.memberId,
      name,
      role,
      phone,
      avatar,
      lat,
      lng,
      accuracy_m: accuracy || 12,
      speed_kmh: speedKmh,
      battery_pct: battery,
      status_label: statusLabel,
      sos_active: state.sosActive,
      consent_granted: true,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    toast(data.error || 'Gagal mengirim lokasi', true);
    return;
  }

  state.lastCoords = { lat, lng };
  state.currentGroup = data;
  renderFamilyGroup(data, false);
  document.getElementById('gps-live-info').textContent =
    `Terakhir dikirim: ${lat.toFixed(5)}, ${lng.toFixed(5)} (±${Math.round(accuracy || 12)}m, Baterai ${battery}%)`;
}

function getBrowserPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser/perangkat tidak mendukung Geolocation API'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 5000,
    });
  });
}

async function checkInOnce() {
  try {
    toast('Mengambil koordinat GPS perangkat...');
    const pos = await getBrowserPositionOnce();
    await sendLocationUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed);
    toast('Lokasi berhasil dikirim ke Circle Keluarga!');
  } catch (err) {
    toast(`Izin GPS ditolak atau tidak tersedia: ${err.message}`, true);
  }
}

function toggleRealtimeGps() {
  const btn = document.getElementById('btn-toggle-gps');
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    btn.textContent = '🛰️ Mulai Bagikan GPS Real-Time';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
    document.getElementById('gps-live-info').textContent = 'Status GPS perangkat: Dihentikan oleh pengguna.';
    toast('Berbagi lokasi real-time dimatikan.');
    return;
  }

  if (!navigator.geolocation) {
    toast('Perangkat tidak mendukung GPS Geolocation.', true);
    return;
  }

  let lastSent = 0;
  state.watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const now = Date.now();
      if (now - lastSent < 8000) return; // throttle server updates to every 8s
      lastSent = now;
      await sendLocationUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed);
    },
    (err) => {
      toast(`GPS Error: ${err.message}`, true);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 },
  );

  btn.textContent = '⏹️ Hentikan GPS Real-Time';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-danger');
  toast('GPS Real-Time aktif (Opt-In)! Lokasi dikirim berkala ke keluarga.');
}

async function toggleSos() {
  state.sosActive = !state.sosActive;
  const btn = document.getElementById('btn-sos');
  btn.textContent = state.sosActive ? '✅ Matikan Status SOS' : '🚨 SOS DARURAT';

  if (state.lastCoords) {
    await sendLocationUpdate(state.lastCoords.lat, state.lastCoords.lng, 10, 0);
  } else {
    try {
      const pos = await getBrowserPositionOnce();
      await sendLocationUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed);
    } catch {
      const center = state.familyMap ? state.familyMap.getCenter() : { lat: -6.175392, lng: 106.827153 };
      await sendLocationUpdate(center.lat, center.lng, 50, 0);
    }
  }
  toast(state.sosActive ? '🚨 SINYAL SOS DARURAT DIKIRIM KE KELUARGA!' : 'Status SOS dimatikan.', state.sosActive);
}

async function addSafeZone() {
  const { code, pin } = getCredentials();
  const zoneName = document.getElementById('sz-name').value.trim() || 'Zona Aman';
  const radiusM = Number(document.getElementById('sz-radius').value || 250);
  const pos = state.lastCoords || (state.familyMap ? state.familyMap.getCenter() : { lat: -6.175392, lng: 106.827153 });

  try {
    const res = await fetch(apiUrl('/api/family'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_safe_zone',
        group_code: code,
        pin,
        zone_name: zoneName,
        lat: pos.lat,
        lng: pos.lng,
        radius_m: radiusM,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      toast(data.error || 'Gagal menambah zona aman', true);
      return;
    }
    renderFamilyGroup(data, false);
    toast(`Safe Zone "${zoneName}" (${radiusM}m) ditambahkan!`);
  } catch (err) {
    toast(`Error: ${err.message}`, true);
  }
}

async function postFamilyAction(payload, successMsg = null) {
  const { code, pin } = getCredentials();
  try {
    const res = await fetch(apiUrl('/api/family'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_code: code, pin, ...payload }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      toast(data.error || 'Aksi gagal dijalankan', true);
      return null;
    }
    state.currentGroup = data;
    renderFamilyGroup(data, false);
    if (successMsg) toast(successMsg);
    return data;
  } catch (err) {
    toast(`Error: ${err.message}`, true);
    return null;
  }
}

async function deleteSafeZone(zoneId, zoneName) {
  await postFamilyAction({ action: 'delete_safe_zone', zone_id: zoneId }, `Safe Zone "${zoneName}" dihapus.`);
}

async function deleteMember(memberId, memberName) {
  await postFamilyAction({ action: 'delete_member', member_id: memberId }, `Anggota "${memberName}" dihapus dari grup.`);
}

async function clearAlerts() {
  await postFamilyAction({ action: 'clear_alerts' }, 'Log peringatan dibersihkan.');
}

async function saveTelegramConfig() {
  const token = document.getElementById('tg-token').value.trim();
  const chatId = document.getElementById('tg-chat-id').value.trim();
  const data = await postFamilyAction({
    action: 'save_telegram_config',
    telegram_bot_token: token,
    telegram_chat_id: chatId,
    send_test: Boolean(token && chatId),
  });
  if (!data) return;
  if (data.telegram_result?.sent) {
    toast('✅ Bot Telegram tersimpan & pesan tes berhasil terkirim!');
  } else if (data.telegram_result && !data.telegram_result.sent) {
    toast(`Pengaturan disimpan, namun gagal tes Telegram: ${data.telegram_result.description || 'cek token/chat id'}`, true);
  } else {
    toast('Pengaturan Telegram disimpan.');
  }
}

async function shareWhatsAppLocation() {
  let coords = state.lastCoords;
  if (!coords) {
    try {
      const pos = await getBrowserPositionOnce();
      coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      const center = state.familyMap ? state.familyMap.getCenter() : { lat: -6.175392, lng: 106.827153 };
      coords = { lat: center.lat, lng: center.lng };
    }
  }
  const name = document.getElementById('my-name').value.trim() || 'Saya';
  const status = state.sosActive ? '🚨 DARURAT SOS' : document.getElementById('my-status').value;
  const { code } = getCredentials();
  const text = `[GhostTrack Family - ${code}]\n${name} (${status})\nLokasi terkini: https://maps.google.com/?q=${coords.lat},${coords.lng}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function toggleAndroidForegroundService() {
  const bridge = window.GhostTrackAndroid;
  if (!bridge) {
    toast('Fitur ini aktif otomatis di dalam aplikasi APK Android.', true);
    return;
  }
  const btn = document.getElementById('btn-android-fg');
  if (state.androidBgActive) {
    bridge.stopBackgroundSync();
    state.androidBgActive = false;
    btn.textContent = '🤖 Aktifkan Background GPS Service (Layar Mati)';
    btn.classList.remove('btn-danger');
    toast('Background GPS Service Android dihentikan.');
    return;
  }
  const { code, pin } = getCredentials();
  const name = document.getElementById('my-name').value.trim() || 'HP Android';
  const role = document.getElementById('my-role').value;
  const phone = document.getElementById('my-phone').value.trim();
  const base = localStorage.getItem('gt_api_base') || window.__GHOSTTRACK_API_BASE__ || DEFAULT_REMOTE_API;
  bridge.startBackgroundSync(base, code, pin, state.memberId, name, role, phone);
  state.androidBgActive = true;
  btn.textContent = '⏹️ Hentikan Background GPS Service';
  btn.classList.add('btn-danger');
  toast('Background GPS Service Android aktif (tetap sync saat layar terkunci)!');
}

// --- GhostTrack Phone Tracker ---
async function scanPhone(overrideNum = null) {
  const inputEl = document.getElementById('phone-input');
  const number = (overrideNum ?? inputEl.value).trim();
  if (overrideNum) inputEl.value = overrideNum;

  const box = document.getElementById('phone-result');
  const localWasm = wasmParsePhone(number);
  if (localWasm) {
    renderPhoneResult(localWasm, [], 'Rust WASM (Lokal Instan)');
  }

  try {
    const res = await fetch(apiUrl(`/api/phone?number=${encodeURIComponent(number)}`));
    const data = await res.json();
    if (data.phone) {
      renderPhoneResult(data.phone, data.family_matches || [], 'Rust WASM + Neon Family DB');
    }
  } catch (err) {
    if (!localWasm) {
      box.innerHTML = `<p class="subtext" style="color:#fca5a5;">Gagal memeriksa nomor: ${esc(err.message)}</p>`;
    }
  }
}

function renderPhoneResult(p, familyMatches, engineLabel) {
  const box = document.getElementById('phone-result');
  const matchHtml = familyMatches.length > 0
    ? `
      <div class="consent-banner" style="margin-top:12px;">
        <strong>📍 Cocok dengan Anggota Circle Keluarga:</strong>
        ${familyMatches.map((m) => `
          <div style="margin-top:6px;">
            <b>${esc(m.name)}</b> (${esc(m.family_name)} / ${esc(m.group_code)}) —
            Status: <b>${esc(m.status_label)}</b> | Baterai: ${m.battery_pct}% |
            Koordinat: <code>${Number(m.lat).toFixed(5)}, ${Number(m.lng).toFixed(5)}</code>
            <button class="btn btn-sm btn-cyan" style="margin-left:8px;" onclick="window.__focusFamilyCoord(${m.lat}, ${m.lng})">Lihat di Peta</button>
          </div>
        `).join('')}
      </div>
    `
    : '<p class="subtext" style="margin-top:10px;">Nomor ini belum terdaftar di anggota grup keluarga mana pun (hanya menampilkan metadata OSINT operator &amp; negara).</p>';

  box.innerHTML = `
    <div style="margin-top:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="pill ${p.valid ? 'ok' : 'danger'}">${p.valid ? '✅ Nomor Valid' : '⚠️ Format Tidak Valid'}</span>
      <span class="pill cyan">Engine: ${esc(engineLabel)}</span>
      ${p.whatsapp_url ? `<a class="btn btn-sm" href="${esc(p.whatsapp_url)}" target="_blank" rel="noopener">💬 Buka WhatsApp</a>` : ''}
      ${p.telegram_url ? `<a class="btn btn-sm" href="${esc(p.telegram_url)}" target="_blank" rel="noopener">✈️ Buka Telegram</a>` : ''}
    </div>
    ${p.error ? `<p class="subtext" style="color:#fcd34d;margin-top:8px;">${esc(p.error)}</p>` : ''}
    <div class="kv-grid">
      <div class="kv-box"><small>Format E.164</small><strong>${esc(p.e164 || '-')}</strong></div>
      <div class="kv-box"><small>Format Nasional</small><strong>${esc(p.national || '-')}</strong></div>
      <div class="kv-box"><small>Operator / Carrier</small><strong>${esc(p.carrier || '-')}</strong></div>
      <div class="kv-box"><small>Negara</small><strong>${esc(p.country)} (${esc(p.iso_code || '-')})</strong></div>
      <div class="kv-box"><small>Wilayah / Region</small><strong>${esc(p.region || '-')}</strong></div>
      <div class="kv-box"><small>Zona Waktu</small><strong>${esc(p.timezone || '-')}</strong></div>
      <div class="kv-box"><small>Tipe Nomor</small><strong>${esc(p.number_type || '-')}</strong></div>
      <div class="kv-box"><small>Kode Negara</small><strong>${esc(p.country_code || '-')}</strong></div>
    </div>
    ${matchHtml}
  `;
}

window.__focusFamilyCoord = (lat, lng) => {
  switchTab('family');
  if (state.familyMap) {
    setTimeout(() => state.familyMap.setView([lat, lng], 16, { animate: true }), 120);
  }
};

// --- GhostTrack IP Tracker ---
async function scanIp(forceSelf = false) {
  const input = document.getElementById('ip-input');
  if (forceSelf) input.value = '';
  const target = input.value.trim();
  const resBox = document.getElementById('ip-result');
  const mapEl = document.getElementById('ip-map');
  resBox.innerHTML = '<p class="subtext">Melacak geolokasi IP...</p>';

  try {
    const res = await fetch(apiUrl(`/api/ip?ip=${encodeURIComponent(target)}`));
    const d = await res.json();
    if (!d.success && d.message) {
      resBox.innerHTML = `<p class="subtext" style="color:#fca5a5;">Gagal melacak IP: ${esc(d.message)}</p>`;
      return;
    }

    const lat = Number(d.latitude);
    const lng = Number(d.longitude);
    resBox.innerHTML = `
      <div class="btn-row" style="margin-bottom:8px;">
        <span class="pill ok">IP: ${esc(d.ip || d.queried_ip)}</span>
        <a class="btn btn-sm btn-cyan" href="https://www.google.com/maps/@${lat},${lng},14z" target="_blank" rel="noopener">🗺️ Buka di Google Maps</a>
      </div>
      <div class="kv-grid">
        <div class="kv-box"><small>Negara &amp; Kode</small><strong>${esc(d.country)} (${esc(d.country_code)})</strong></div>
        <div class="kv-box"><small>Kota / Wilayah</small><strong>${esc(d.city || '-')}, ${esc(d.region || '-')}</strong></div>
        <div class="kv-box"><small>ISP / Organisasi</small><strong>${esc(d.connection?.isp || '-')} (${esc(d.connection?.org || '-')})</strong></div>
        <div class="kv-box"><small>ASN &amp; Domain</small><strong>AS${esc(d.connection?.asn || '-')} • ${esc(d.connection?.domain || '-')}</strong></div>
        <div class="kv-box"><small>Koordinat Perkiraan</small><strong>${lat.toFixed(5)}, ${lng.toFixed(5)}</strong></div>
        <div class="kv-box"><small>Zona Waktu</small><strong>${esc(d.timezone?.id || '-')} (${esc(d.timezone?.utc || '')})</strong></div>
      </div>
    `;

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      mapEl.style.display = 'block';
      if (!state.ipMap) {
        state.ipMap = L.map('ip-map').setView([lat, lng], 12);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.ipMap);
      } else {
        state.ipMap.setView([lat, lng], 12);
      }
      setTimeout(() => state.ipMap.invalidateSize(), 100);
      if (state.ipMarker) state.ipMarker.remove();
      state.ipMarker = L.marker([lat, lng]).addTo(state.ipMap)
        .bindPopup(`<b>${esc(d.ip)}</b><br/>${esc(d.city)}, ${esc(d.country)}`).openPopup();
    }
  } catch (err) {
    resBox.innerHTML = `<p class="subtext" style="color:#fca5a5;">Error: ${esc(err.message)}</p>`;
  }
}

// --- GhostTrack Username OSINT ---
async function scanUsername() {
  const username = document.getElementById('osint-input').value.trim();
  const box = document.getElementById('osint-result');
  if (!username) {
    toast('Masukkan username terlebih dahulu', true);
    return;
  }
  box.innerHTML = '<p class="subtext" style="margin-top:10px;">Memindai 22 platform sosial media secara paralel...</p>';

  try {
    const res = await fetch(apiUrl(`/api/username?username=${encodeURIComponent(username)}`));
    const data = await res.json();
    if (!res.ok) {
      box.innerHTML = `<p class="subtext" style="color:#fca5a5;">${esc(data.error || 'Gagal memindai')}</p>`;
      return;
    }

    const foundCount = (data.results || []).filter((r) => r.status === 'found').length;
    box.innerHTML = `
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <span class="pill ok">Ditemukan (HTTP 200): ${foundCount}</span>
        <span class="pill cyan">Total Platform: ${data.total}</span>
      </div>
      <div class="osint-grid">
        ${(data.results || []).map((r) => {
          const badge = r.status === 'found'
            ? '<span class="badge-found">Ditemukan</span>'
            : r.status === 'not_found'
              ? '<span class="badge-missing">404 Kosong</span>'
              : '<span class="badge-manual">Cek Link</span>';
          return `
            <a class="osint-item" href="${esc(r.url)}" target="_blank" rel="noopener">
              <div>
                <div style="font-weight:700;font-size:0.86rem;">${esc(r.site)}</div>
                <div style="font-size:0.72rem;color:var(--muted);">${esc(r.category)}</div>
              </div>
              ${badge}
            </a>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    box.innerHTML = `<p class="subtext" style="color:#fca5a5;">Error: ${esc(err.message)}</p>`;
  }
}

// --- Device Telemetry & PWA ---
async function renderDeviceTelemetry() {
  const box = document.getElementById('device-telemetry');
  const battery = await getBatteryPct();
  let ipText = 'Memeriksa...';
  try {
    const r = await fetch(apiUrl('/api/ip'));
    const d = await r.json();
    ipText = `${d.ip || '-'} (${d.city || '-'}, ${d.country_code || '-'})`;
  } catch {
    ipText = 'Tidak tersedia';
  }

  let gpsPerm = 'Tidak diketahui';
  try {
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      gpsPerm = p.state;
    }
  } catch {
    // ignore
  }

  box.innerHTML = `
    <div class="kv-box"><small>Platform / OS</small><strong>${esc(navigator.platform || 'Android/Web')}</strong></div>
    <div class="kv-box"><small>Status Baterai</small><strong>${battery}%</strong></div>
    <div class="kv-box"><small>Izin GPS Browser</small><strong>${esc(gpsPerm)}</strong></div>
    <div class="kv-box"><small>IP Publik Terdeteksi</small><strong>${esc(ipText)}</strong></div>
    <div class="kv-box"><small>Resolusi Layar</small><strong>${window.screen.width} × ${window.screen.height}</strong></div>
    <div class="kv-box"><small>Status Koneksi</small><strong>${navigator.onLine ? 'Online' : 'Offline'}</strong></div>
  `;
}

// --- Tab Navigation ---
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });
  if (tabName === 'family' && state.familyMap) {
    setTimeout(() => state.familyMap.invalidateSize(), 80);
  }
  if (tabName === 'ip' && state.ipMap) {
    setTimeout(() => state.ipMap.invalidateSize(), 80);
  }
  if (tabName === 'android') {
    renderDeviceTelemetry();
  }
}

// --- Bootstrap ---
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', async () => {
  restoreSavedFields();
  initFamilyMap();

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-load-group').addEventListener('click', () => loadFamilyGroup(true));
  document.getElementById('btn-refresh-family').addEventListener('click', () => loadFamilyGroup(false));
  document.getElementById('btn-fit-map').addEventListener('click', () => loadFamilyGroup(true));
  document.getElementById('btn-create-group').addEventListener('click', createFamilyGroup);
  document.getElementById('btn-toggle-gps').addEventListener('click', toggleRealtimeGps);
  document.getElementById('btn-checkin-once').addEventListener('click', checkInOnce);
  document.getElementById('btn-sos').addEventListener('click', toggleSos);
  document.getElementById('btn-add-sz').addEventListener('click', addSafeZone);
  document.getElementById('btn-wa-sos').addEventListener('click', shareWhatsAppLocation);
  document.getElementById('btn-clear-alerts').addEventListener('click', clearAlerts);
  document.getElementById('btn-save-tg').addEventListener('click', saveTelegramConfig);

  document.getElementById('btn-toggle-invite').addEventListener('click', () => {
    const box = document.getElementById('invite-box');
    const willShow = box.style.display === 'none';
    if (willShow) updateInviteBox();
    box.style.display = willShow ? 'block' : 'none';
  });

  document.getElementById('btn-copy-invite').addEventListener('click', async () => {
    const val = document.getElementById('invite-link-input').value;
    try {
      await navigator.clipboard.writeText(val);
      toast('Link undangan disalin ke clipboard!');
    } catch {
      document.getElementById('invite-link-input').select();
      toast('Tekan Ctrl+C / Tahan untuk menyalin link.');
    }
  });

  const sirenBtn = document.getElementById('btn-toggle-siren');
  const syncSirenBtn = () => {
    sirenBtn.textContent = state.sirenEnabled ? '🔊 Sirine SOS: ON' : '🔇 Sirine SOS: OFF';
  };
  syncSirenBtn();
  sirenBtn.addEventListener('click', async () => {
    state.sirenEnabled = !state.sirenEnabled;
    localStorage.setItem('gt_siren', String(state.sirenEnabled));
    syncSirenBtn();
    if (state.sirenEnabled && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // ignore
      }
    }
    toast(state.sirenEnabled ? 'Sirine & Notifikasi SOS diaktifkan.' : 'Sirine SOS dimatikan.');
  });

  if (window.GhostTrackAndroid) {
    document.getElementById('android-fg-row').style.display = 'flex';
    document.getElementById('btn-android-fg').addEventListener('click', toggleAndroidForegroundService);
  }

  document.getElementById('btn-scan-phone').addEventListener('click', () => scanPhone());
  document.querySelectorAll('[data-quick-phone]').forEach((btn) => {
    btn.addEventListener('click', () => scanPhone(btn.dataset.quickPhone));
  });

  document.getElementById('btn-scan-ip').addEventListener('click', () => scanIp(false));
  document.getElementById('btn-my-ip').addEventListener('click', () => scanIp(true));
  document.getElementById('btn-scan-osint').addEventListener('click', scanUsername);
  document.getElementById('btn-refresh-device').addEventListener('click', renderDeviceTelemetry);

  document.getElementById('btn-install-pwa').addEventListener('click', async () => {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      const choice = await state.deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') toast('Aplikasi terpasang di layar utama Android!');
      state.deferredInstallPrompt = null;
    } else {
      toast('Di Chrome Android, ketuk menu ⋮ → "Tambahkan ke layar utama / Install app".');
    }
  });

  await Promise.all([initRustWasm(), checkHealth(), loadFamilyGroup(true)]);
  scanPhone('081234567890');

  // Auto-refresh family positions every 15 seconds
  setInterval(() => {
    if (document.getElementById('tab-family').classList.contains('active')) {
      loadFamilyGroup(false);
    }
  }, 15000);
});
