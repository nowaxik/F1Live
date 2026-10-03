import { createDemo, prepareEvents, stateAt } from './replay.js';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const clock = ms => { const sec = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const colour = value => /^[0-9a-f]{6}$/i.test(value) ? '#' + value : '#9298a3';
let data = createDemo(), time = data.start, playing = true, lastTick = performance.now(), lastRendered = -1, sessions = [], busy = false;
let source = 'demo';
let liveStream = null, liveState = null, lastHeartbeat = 0;
const liveLabels = { ended: 'SESJA ZAKOŃCZONA', suspended: 'SESJA PRZERWANA', unavailable: 'ŹRÓDŁO NIEDOSTĘPNE', unconfigured: 'BRAK KONFIGURACJI', idle: 'ROZŁĄCZONO', connecting: 'ŁĄCZENIE', waiting: 'OCZEKIWANIE', connected: 'POŁĄCZONO', reconnecting: 'PONOWNE ŁĄCZENIE', error: 'BŁĄD POŁĄCZENIA' };
function notice(message, error = false) { $('notice-text').textContent = message; $('notice').classList.toggle('error', error); }
function renderRows(state) {
  $('leaderboard').innerHTML = state.map(driver => {
    const delta = driver.previous === null || driver.position === null ? 0 : driver.previous - driver.position;
    return `<tr class="${driver.position === 1 ? 'leader' : ''}" style="--team:${colour(driver.team_colour)}"><td class="position">${driver.position ?? '—'}</td><td><div class="driver-cell"><span class="team-stripe"></span><span class="driver-code" title="${escape(driver.full_name)}">${escape(driver.name_acronym || '???')}</span><span class="driver-name">${escape(driver.full_name)}</span></div></td><td class="team-cell"><span class="team-dot"></span>${escape(driver.team_name)}</td><td class="movement ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'}" aria-label="${delta > 0 ? 'Awans o ' + delta : delta < 0 ? 'Spadek o ' + Math.abs(delta) : 'Brak zmiany'}">${delta > 0 ? '↑ ' + delta : delta < 0 ? '↓ ' + Math.abs(delta) : '—'}</td></tr>`;
  }).join('') || `<tr><td colspan="4" class="empty-table">${source === 'live' ? 'Brak bieżącej klasyfikacji. Pozycje pojawią się po połączeniu z aktywną sesją.' : 'Wybierz sesję archiwalną, aby wyświetlić klasyfikację.'}</td></tr>`;
  $('driver-count').textContent = state.length;
}
function renderChanges(changes, drivers, start) {
  $('changes').innerHTML = changes.slice(-5).reverse().map(event => {
    const driver = drivers.find(d => Number(d.driver_number) === event.driver);
    return `<div class="change"><span class="change-arrow">↑</span><div><strong>${escape(driver?.name_acronym || event.driver)}</strong><small>P${event.old} → P${event.position}</small></div><time>${clock(event.time - start)}</time></div>`;
  }).join('') || '<p class="empty-changes">Brak zarejestrowanych awansów w tej sesji.</p>';
}
function render(force = false) {
  if (source === 'live') return;
  const second = Math.floor(time / 1000);
  if (!force && second === lastRendered) return;
  lastRendered = second;
  const state = stateAt(data.drivers, data.events, time);
  renderRows(state);
  const progress = data.end > data.start ? (time - data.start) / (data.end - data.start) : 1;
  $('timeline').value = Math.round(progress * 1000);
  $('progress-percent').textContent = Math.round(progress * 100) + '%';
  $('elapsed').textContent = clock(time - data.start);
  $('duration').textContent = clock(data.end - data.start);
  $('driver-count').textContent = state.length;
  $('play-pause').textContent = playing ? 'Ⅱ Pauza' : time >= data.end ? '↺ Odtwórz' : '▶ Odtwórz';
  $('play-status').textContent = time >= data.end ? 'KONIEC POWTÓRKI' : playing ? 'ODTWARZANIE' : 'PAUZA';
  const previous = new Map(), changes = [];
  for (const event of data.events) {
    if (event.time > time) break;
    const old = previous.get(event.driver);
    if (old !== undefined && old > event.position) changes.push({ ...event, old });
    previous.set(event.driver, event.position);
  }
  renderChanges(changes, data.drivers, data.start);
}
function setBusy(value) { busy = value; for (const id of ['fetch-sessions', 'load-session', 'demo-mode', 'archive-mode', 'live-mode', 'year', 'session']) $(id).disabled = value || (id === 'load-session' || id === 'session') && !sessions.length; }
function setMode(mode) {
  $('archive-panel').hidden = mode !== 'archive';
  $('live-panel').hidden = mode !== 'live';
  $('live-card').hidden = mode !== 'live';
  $('replay-card').hidden = mode === 'live';
  $('play-status').removeAttribute('data-state');
  for (const name of ['demo', 'archive', 'live']) { $(name + '-mode').classList.toggle('active', mode === name); $(name + '-mode').setAttribute('aria-pressed', String(mode === name)); }
}
function disconnectLive() { liveStream?.close(); liveStream = null; }
function renderLive(snapshot) {
  if (source !== 'live') return;
  liveState = snapshot;
  const session = snapshot.session;
  $('session-title').textContent = session ? `${session.country_name} · ${session.session_name}` : 'Oczekiwanie na sesję';
  $('session-kicker').textContent = session ? `${session.year} / ${session.circuit_short_name} / F1 LIVE TIMING` : 'PUBLICZNY F1 LIVE TIMING';
  $('session-format').textContent = session?.session_name || '—';
  $('source-label').textContent = 'F1 Live Timing';
  $('play-status').textContent = liveLabels[snapshot.status] || 'OCZEKIWANIE';
  $('play-status').dataset.state = snapshot.status;
  $('connection-state').textContent = liveLabels[snapshot.status] || snapshot.status;
  $('last-update').textContent = snapshot.lastPositionAt ? new Date(snapshot.lastPositionAt).toLocaleString('pl-PL') : (snapshot.drivers?.length ? 'Migawka źródła (bez czasu zapisu)' : 'Nie otrzymano jeszcze pozycji');
  const upcoming = snapshot.upcoming;
  $('next-session').textContent = upcoming ? `${upcoming.country_name} · ${upcoming.session_name} · ${new Date(upcoming.date_start).toLocaleString('pl-PL')}` : 'Źródło przełączy się automatycznie przy zmianie sesji';
  $('live-description').textContent = snapshot.message;
  $('live-heading').textContent = 'Publiczny timing. Bez abonamentu.';
  $('live-connect').disabled = !snapshot.configured;
  $('live-connect').textContent = liveStream ? 'Rozłącz' : 'Połącz z F1 Live Timing →';
  
  notice(snapshot.message, ['error', 'reconnecting', 'unavailable'].includes(snapshot.status));
  $('table-caption').textContent = ['connected', 'connecting'].includes(snapshot.status) ? 'Pozycje według F1 Live Timing • aktualizowane po otrzymaniu danych' : 'Ostatnia dostępna klasyfikacja ze źródła • sprawdź status sesji i połączenia';
  renderRows(snapshot.drivers || []);
  renderChanges(snapshot.changes || [], snapshot.drivers || [], Date.parse(session?.date_start) || Date.now());
}
async function inspectLive() {
  try {
    const response = await fetch('/api/live/status');
    if (!response.ok) throw new Error();
    const snapshot = await response.json();
    if (source !== 'live' || liveStream) return;
    // A different tab can already have an upstream connection. This tab still needs its own stream.
    renderLive({ ...snapshot, status: snapshot.configured ? 'idle' : 'unconfigured', message: snapshot.configured ? 'Kliknij „Połącz z F1 Live Timing”. Dostęp publiczny, bez logowania i kluczy API.' : snapshot.message });
  } catch {
    if (source === 'live') renderLive({ configured: false, status: 'error', message: 'Nie można połączyć się z serwerem. Sprawdź, czy lokalny serwer działa, i wybierz ponownie „Na żywo”.', drivers: [] });
  }
}
$('live-mode').addEventListener('click', () => {
  if (busy) return;
  playing = false; source = 'live'; setMode('live');
  if (liveStream && liveState) return renderLive(liveState);
  renderLive({ configured: false, status: 'connecting', message: 'Sprawdzanie dostępności lokalnego serwera…', drivers: [] });
  void inspectLive();
});
$('live-connect').addEventListener('click', () => {
  if (liveStream) { disconnectLive(); renderLive({ ...liveState, status: 'idle', message: 'Odbiór zatrzymany. Wyświetlane pozycje nie są już aktualizowane.' }); return; }
  lastHeartbeat = Date.now();
  const stream = new EventSource('/api/live/events');
  liveStream = stream;
  renderLive({ ...liveState, status: 'connecting', message: 'Łączenie z lokalnym serwerem…' });
  stream.addEventListener('state', event => {
    if (liveStream !== stream) return;
    try { lastHeartbeat = Date.now(); renderLive(JSON.parse(event.data)); } catch { /* Keep the last valid snapshot. */ }
  });
  stream.onerror = () => {
    if (liveStream === stream) renderLive({ ...liveState, status: 'reconnecting', message: 'Utracono połączenie z lokalnym serwerem. Automatycznie ponawiam połączenie; tabela pokazuje ostatni znany stan.' });
  };
});
setInterval(() => {
  if (source === 'live' && liveStream && Date.now() - lastHeartbeat > 35000) renderLive({ ...liveState, status: 'reconnecting', message: 'Brak potwierdzenia połączenia z serwerem. Pozycje mogą być nieaktualne.' });
}, 5000);
function resetPlayback(next) { data = next; time = data.start; playing = true; lastTick = performance.now(); render(true); }
async function api(endpoint, params) {
  const response = await fetch('/api/' + endpoint + '?' + new URLSearchParams(params));
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Nie udało się pobrać danych.');
  if (!Array.isArray(body)) throw new Error('Niepoprawna odpowiedź OpenF1.');
  return body;
}
$('demo-mode').addEventListener('click', () => {
  if (busy) return;
  disconnectLive();
  source = 'demo'; setMode('demo');
  $('session-title').textContent = 'Sesja demonstracyjna'; $('session-kicker').textContent = 'SANDBOX / DEMO'; $('session-format').textContent = 'Wyścig · demo'; $('source-label').textContent = 'Symulacja';
  $('table-caption').textContent = 'Zmiany pozycji generowane na potrzeby prezentacji';
  notice('Tryb demonstracyjny • fikcyjny przebieg sesji, przykładowy skład z 2024 roku. To nie jest transmisja na żywo.');
  resetPlayback(createDemo());
});
$('archive-mode').addEventListener('click', () => {
  if (source === 'live') {
    disconnectLive(); source = 'archive'; playing = false;
    data = { drivers: [], events: [], start: 0, end: 0 }; time = 0;
    $('session-title').textContent = 'Wybierz sesję archiwalną'; $('session-kicker').textContent = 'OPENF1 / ARCHIWUM'; $('session-format').textContent = '—';
    $('table-caption').textContent = 'Wybierz sesję, aby załadować klasyfikację';
    notice('Wybierz sezon, pobierz listę sesji i uruchom powtórkę.');
  }
  setMode('archive'); render(true);
});
$('year').addEventListener('change', () => { sessions = []; $('session').innerHTML = '<option>Pobierz sesje wybranego sezonu</option>'; setBusy(false); });
$('fetch-sessions').addEventListener('click', async () => {
  setBusy(true); notice('Pobieranie listy sesji z OpenF1… Obecna powtórka pozostaje dostępna.');
  try {
    const year = $('year').value;
    sessions = (await api('sessions', { year })).filter(s => Date.parse(s.date_end) < Date.now() - 1800000).sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
    $('session').innerHTML = sessions.map(s => `<option value="${Number(s.session_key)}">${escape(new Date(s.date_start).toLocaleDateString('pl-PL'))} · ${escape(s.country_name)} / ${escape(s.circuit_short_name)} · ${escape(s.session_name)}</option>`).join('') || '<option>Brak zakończonych sesji</option>';
    notice(sessions.length ? 'Wybierz sesję i kliknij „Odtwórz sesję”. Wyświetlana tabela nadal pokazuje ' + (source === 'demo' ? 'dane demonstracyjne.' : 'poprzednią powtórkę.') : 'Brak zakończonych sesji dla tego roku. Wybierz inny sezon.');
  } catch (error) { notice(error.message + ' Nadal możesz korzystać z demo lub obecnej powtórki.', true); }
  finally { setBusy(false); }
});
$('load-session').addEventListener('click', async () => {
  const session = sessions.find(s => Number(s.session_key) === Number($('session').value));
  if (!session || busy) return;
  setBusy(true); notice('Pobieranie kierowców i historii pozycji… Może to potrwać kilkanaście sekund.');
  try {
    const drivers = await api('drivers', { session_key: session.session_key });
    const events = prepareEvents(await api('position', { session_key: session.session_key }));
    if (!drivers.length || !events.length) throw new Error('Ta sesja nie ma kompletu danych kierowców i pozycji. Wybierz inną.');
    const start = Math.min(Date.parse(session.date_start) || events[0].time, events[0].time);
    const end = Math.max(Date.parse(session.date_end) || events.at(-1).time, events.at(-1).time);
    source = 'archive';
    $('session-title').textContent = `${session.country_name} · ${session.session_name}`;
    $('session-kicker').textContent = `${session.year} / ${session.circuit_short_name} / ARCHIWUM`;
    $('session-format').textContent = session.session_name; $('source-label').textContent = 'OpenF1';
    $('table-caption').textContent = 'Pozycje według OpenF1 • „—” oznacza brak pozycji w tym momencie';
    notice('Archiwalna powtórka OpenF1 • odtwarzamy zarejestrowane pozycje, nie transmisję live. Aktualizacje poszczególnych kierowców mogą przychodzić w różnym czasie.');
    resetPlayback({ drivers, events, start, end });
  } catch (error) { notice(error.message + ' Zachowano dotychczasową powtórkę.', true); }
  finally { setBusy(false); }
});
$('play-pause').addEventListener('click', () => { if (time >= data.end) time = data.start; playing = !playing; lastTick = performance.now(); render(true); });
$('restart').addEventListener('click', () => { time = data.start; lastTick = performance.now(); render(true); });
$('timeline').addEventListener('input', () => { time = data.start + Number($('timeline').value) / 1000 * (data.end - data.start); if (time >= data.end) playing = false; lastTick = performance.now(); render(true); });
$('speed').addEventListener('change', () => { lastTick = performance.now(); });
setInterval(() => {
  const now = performance.now();
  if (playing && source !== 'live') { time = Math.min(data.end, time + (now - lastTick) * Number($('speed').value)); if (time >= data.end) playing = false; render(); }
  lastTick = now;
}, 150);
render(true);
