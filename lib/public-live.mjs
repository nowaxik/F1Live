import WebSocket from 'ws';
import { LiveStore } from './live-store.mjs';
const TOPICS = ['Heartbeat', 'SessionInfo', 'SessionStatus', 'DriverList', 'TimingData'];
const RS = '\x1e';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function sessionDate(value, offset = '+00:00') {
  if (!value) return null;
  const suffix = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? '' : (offset.startsWith('-') || offset.startsWith('+') ? offset : '+' + offset).slice(0, 6);
  const date = Date.parse(value + suffix);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}
export class PublicTimingState {
  constructor() { this.store = new LiveStore(); this.sportStatus = ''; this.lastStatusTime = 0; }
  apply(topic, raw, at = null) {
    let value = raw;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return; } }
    if (!object(value)) return;
    const date = Date.parse(at) || 0;
    if (topic === 'SessionInfo') {
      const current = this.store.session;
      const key = Number(value.Key || current?.session_key);
      if (!key) return;
      if (current?.session_key !== key) { this.store.reset(null); this.sportStatus = ''; this.lastStatusTime = 0; }
      const prior = this.store.session || {};
      this.store.session = {
        session_key: key, session_name: value.Name || prior.session_name || 'Sesja F1', session_type: value.Type || prior.session_type,
        date_start: sessionDate(value.StartDate, value.GmtOffset) || prior.date_start,
        date_end: sessionDate(value.EndDate, value.GmtOffset) || prior.date_end,
        country_name: value.Meeting?.Country?.Name || prior.country_name || 'F1',
        circuit_short_name: value.Meeting?.Circuit?.ShortName || prior.circuit_short_name || '—',
        year: Number(String(value.StartDate || prior.date_start).slice(0, 4)),
      };
      if (value.SessionStatus && date >= this.lastStatusTime) { this.sportStatus = value.SessionStatus; this.lastStatusTime = date; }
    }
    if (topic === 'SessionStatus' && value.Status && date >= this.lastStatusTime) { this.sportStatus = value.Status; this.lastStatusTime = date; }
    const key = this.store.session?.session_key;
    if (!key) return;
    if (topic === 'DriverList') this.store.mergeDrivers(Object.entries(value).filter(([number, driver]) => /^\d+$/.test(number) && object(driver)).map(([number, driver]) => ({
      session_key: key, driver_number: Number(number), name_acronym: driver.Tla, full_name: driver.FullName,
      team_name: driver.TeamName, team_colour: driver.TeamColour, _id: date,
    })));
    if (topic === 'TimingData' && object(value.Lines)) this.store.mergePositions(Object.entries(value.Lines).filter(([number, line]) => /^\d+$/.test(number) && object(line) && line.Position !== undefined).map(([number, line]) => ({
      session_key: key, driver_number: Number(number), position: Number(line.Position), date: new Date(date).toISOString(),
    })));
  }
  bootstrap(result) {
    this.store.reset(null); this.sportStatus = ''; this.lastStatusTime = 0;
    for (const topic of ['SessionInfo', 'SessionStatus', 'DriverList', 'TimingData']) this.apply(topic, result?.[topic]);
  }
  state(now) {
    if (!this.store.session) return 'waiting';
    if (['Ends', 'Ended', 'Finished', 'Finalised'].includes(this.sportStatus)) return 'ended';
    if (this.sportStatus === 'Aborted') return 'suspended';
    const end = Date.parse(this.store.session.date_end);
    if (Number.isFinite(end) && now > end + 3 * 3600000) return 'waiting';
    return ['Started', 'Resumed'].includes(this.sportStatus) ? 'connected' : 'waiting';
  }
}
export class LiveFeed {
  constructor({ fetcher = fetch, socketFactory = (url, options) => new WebSocket(url, options), now = Date.now } = {}) {
    this.fetcher = fetcher; this.socketFactory = socketFactory; this.now = now;
    this.timing = new PublicTimingState(); this.listeners = new Set(); this.generation = 0;
    this.status = 'idle'; this.message = 'Publiczny F1 Live Timing. Nie wymaga konta ani płatnego API.';
    this.client = null; this.failures = 0; this.ready = false;
  }
  snapshot() { return { configured: true, provider: 'F1 Live Timing', requiresAccount: false, status: this.status, message: this.message, serverTime: this.now(), upcoming: null, ...this.timing.store.snapshot() }; }
  emit() { const state = this.snapshot(); for (const listener of this.listeners) listener(state); }
  setStatus(status, message) { this.status = status; this.message = message; this.emit(); }
  sportState() {
    const status = this.timing.state(this.now());
    const messages = {
      connected: 'Odbiór publicznych danych F1 aktywny. Pozycje aktualizują się po otrzymaniu komunikatów.',
      ended: 'Sesja zakończona. Wyświetlana jest ostatnia klasyfikacja ze źródła, a nie relacja na żywo.',
      suspended: 'Sesja przerwana. Połączenie pozostaje aktywne; oczekujemy na wznowienie.',
      waiting: 'Połączenie aktywne. Oczekujemy na bieżącą sesję i dostępne dane; ewentualna tabela jest ostatnią migawką źródła.',
    };
    this.status = status; this.message = messages[status];
  }
  subscribe(listener) {
    this.listeners.add(listener); listener(this.snapshot());
    if (this.listeners.size === 1) {
      const generation = ++this.generation;
      this.heartbeat = setInterval(() => { if (this.ready) this.sportState(); this.emit(); }, 10000);
      void this.connect(generation);
    }
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stop(); };
  }
  current(generation) { return generation === this.generation && this.listeners.size > 0; }
  stop() {
    ++this.generation; this.controller?.abort();
    clearInterval(this.heartbeat); clearInterval(this.ping); clearTimeout(this.retry); clearTimeout(this.deadline); clearTimeout(this.publish);
    this.publish = null; const client = this.client; this.client = null; client?.terminate();
    this.ready = false; this.status = 'idle'; this.message = 'Odbiór zatrzymany. Kliknij Połącz, aby wznowić.';
  }
  fail(generation, message, blocked = false) {
    if (!this.current(generation)) return;
    clearInterval(this.ping); clearTimeout(this.deadline); clearTimeout(this.retry);
    this.ready = false; const client = this.client; this.client = null; client?.terminate();
    this.failures++;
    this.setStatus(blocked ? 'unavailable' : 'reconnecting', message);
    if (!blocked) this.retry = setTimeout(() => void this.connect(generation), Math.min(60000, 5000 * 2 ** Math.min(this.failures - 1, 4)));
  }
  async connect(generation) {
    if (!this.current(generation)) return;
    clearTimeout(this.retry);
    this.setStatus('connecting', 'Łączenie z publicznym F1 Live Timing…');
    this.controller = new AbortController();
    try {
      const response = await this.fetcher('https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1', {
        method: 'POST', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!this.current(generation)) return;
      if ([401, 403].includes(response.status)) return this.fail(generation, 'Źródło nie udostępnia teraz anonimowego dostępu. Demo i darmowe archiwum pozostają dostępne.', true);
      if (!response.ok) throw new Error('Negotiate failed');
      const result = await response.json();
      if (!this.current(generation)) return;
      const id = result.connectionToken || result.connectionId;
      if (!id || result.url || !result.availableTransports?.some(item => item.transport === 'WebSockets')) throw new Error('Unsupported negotiation');
      const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const client = this.socketFactory('wss://livetiming.formula1.com/signalrcore?id=' + encodeURIComponent(id), { headers: cookie ? { Cookie: cookie } : {}, handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 });
      this.client = client; this.ready = false;
      let buffer = '', handshaken = false, pending = [], lastMessage = this.now();
      const send = value => client.send(JSON.stringify(value) + RS);
      const valid = () => this.current(generation) && this.client === client;
      this.deadline = setTimeout(() => { if (valid()) this.fail(generation, 'Źródło nie odpowiedziało na subskrypcję. Ponawiam połączenie…'); }, 25000);
      client.on('open', () => { if (valid()) send({ protocol: 'json', version: 1 }); });
      client.on('message', bytes => {
        if (!valid()) return;
        lastMessage = this.now(); buffer += bytes.toString();
        if (buffer.length > 2 * 1024 * 1024) return this.fail(generation, 'Niepoprawny format strumienia. Ponawiam połączenie…');
        let boundary;
        while (valid() && (boundary = buffer.indexOf(RS)) >= 0) {
          const raw = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
          if (!raw) continue;
          let message; try { message = JSON.parse(raw); } catch { return this.fail(generation, 'Niepoprawny komunikat źródła. Ponawiam połączenie…'); }
          if (!handshaken) {
            if (message.error) return this.fail(generation, 'Publiczne połączenie zostało odrzucone przez źródło.', true);
            handshaken = true;
            send({ type: 1, invocationId: '1', target: 'Subscribe', arguments: [TOPICS] });
            this.ping = setInterval(() => {
              if (!valid()) return;
              if (this.now() - lastMessage > 45000) return this.fail(generation, 'Utracono kontakt z F1 Live Timing. Ostatnie pozycje mogą być nieaktualne.');
              send({ type: 6 });
            }, 15000);
          } else if (message.type === 3 && message.invocationId === '1') {
            if (message.error) return this.fail(generation, 'Źródło odmówiło publicznej subskrypcji. Skorzystaj z demo lub archiwum.', true);
            if (!object(message.result)) return this.fail(generation, 'Źródło nie zwróciło migawki sesji. Ponawiam połączenie…');
            this.timing.bootstrap(message.result);
            for (const args of pending) this.timing.apply(...args);
            pending = []; this.ready = true; this.failures = 0; clearTimeout(this.deadline);
            this.sportState(); this.emit();
          } else if (message.type === 1 && message.target?.toLowerCase() === 'feed' && Array.isArray(message.arguments)) {
            const args = message.arguments;
            if (!TOPICS.includes(args[0])) continue;
            if (!this.ready) { if (pending.length < 500) pending.push(args); else return this.fail(generation, 'Synchronizacja sesji trwa zbyt długo. Ponawiam połączenie…'); }
            else {
              this.timing.apply(...args); this.sportState();
              if (!this.publish) this.publish = setTimeout(() => { this.publish = null; if (valid()) this.emit(); }, 150);
            }
          } else if (message.type === 7) return this.fail(generation, 'Źródło zamknęło połączenie. Ponawiam odbiór…');
        }
      });
      client.on('error', () => { if (valid()) this.fail(generation, 'Nie udało się połączyć z publicznym strumieniem. Ponawiam próbę…'); });
      client.on('close', () => { if (valid()) this.fail(generation, 'Utracono połączenia. Zachowano ostatnie znane pozycje; ponawiam odbiór…'); });
      client.on('unexpected-response', (_req, res) => { res.resume(); if (valid()) this.fail(generation, 'Serwer strumienia odrzucił połączenie. Demo i archiwum nadal działają.', [401, 403].includes(res.statusCode)); });
    } catch {
      if (this.current(generation)) this.fail(generation, 'Publiczny F1 Live Timing jest chwilowo niedostępny. Automatycznie ponawiam połączenie…');
    }
  }
}
