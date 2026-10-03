const cleanSession = row => Object.fromEntries(['session_key', 'session_name', 'session_type', 'date_start', 'date_end', 'country_name', 'circuit_short_name', 'year'].map(key => [key, row[key]]));

export function selectSession(sessions, now = Date.now()) {
  const usable = sessions.filter(s => !s.is_cancelled && Number.isFinite(Date.parse(s.date_start)) && Number.isFinite(Date.parse(s.date_end)));
  const active = usable.filter(s => now >= Date.parse(s.date_start) - 1800000 && now <= Date.parse(s.date_end) + 1800000)
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start))[0];
  const upcoming = usable.filter(s => Date.parse(s.date_start) > now).sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))[0];
  return { active: active ? cleanSession(active) : null, upcoming: upcoming ? cleanSession(upcoming) : null };
}

export class LiveStore {
  constructor() { this.reset(null); }
  reset(session) {
    this.session = session ? cleanSession(session) : null;
    this.drivers = new Map();
    this.positions = new Map();
    this.changes = [];
    this.lastPositionAt = null;
  }
  mergeDrivers(rows) {
    for (const row of rows) {
      if (Number(row.session_key) !== Number(this.session?.session_key) || !Number.isInteger(Number(row.driver_number))) continue;
      const number = Number(row.driver_number);
      const previous = this.drivers.get(number) || {};
      if ((previous._id || 0) > (Number(row._id) || 0)) continue;
      this.drivers.set(number, { driver_number: number, name_acronym: row.name_acronym || previous.name_acronym || '???', full_name: row.full_name || previous.full_name || `Kierowca ${number}`, team_name: row.team_name || previous.team_name || '—', team_colour: row.team_colour || previous.team_colour || '9298A3', _id: Number(row._id) || 0 });
    }
  }
  mergePositions(rows) {
    const valid = rows.filter(row => Number(row.session_key) === Number(this.session?.session_key) && Number.isInteger(Number(row.driver_number)) && Number.isInteger(Number(row.position)) && Number(row.position) > 0 && Number.isFinite(Date.parse(row.date)))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || (Number(a._id) || 0) - (Number(b._id) || 0));
    for (const row of valid) {
      const number = Number(row.driver_number), position = Number(row.position), timestamp = Date.parse(row.date), id = Number(row._id) || 0;
      const old = this.positions.get(number);
      if (old && (timestamp < old.time || timestamp === old.time && id <= old.id)) continue;
      const previous = old && old.position !== position ? old.position : old?.previous ?? null;
      this.positions.set(number, { position, previous, time: timestamp, id });
      if (old && old.position > position) this.changes.push({ driver: number, old: old.position, position, time: timestamp });
      this.lastPositionAt = Math.max(this.lastPositionAt || 0, timestamp);
    }
    this.changes.sort((a, b) => a.time - b.time);
    this.changes = this.changes.slice(-5);
  }
  snapshot() {
    const numbers = new Set([...this.drivers.keys(), ...this.positions.keys()]);
    const drivers = [...numbers].map(number => {
      const { _id, ...driver } = this.drivers.get(number) || { driver_number: number, name_acronym: '???', full_name: `Kierowca ${number}`, team_name: '—', team_colour: '9298A3' };
      const position = this.positions.get(number);
      return { ...driver, position: position?.position ?? null, previous: position?.previous ?? null };
    }).sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.driver_number - b.driver_number);
    return { session: this.session, drivers, changes: this.changes, lastPositionAt: this.lastPositionAt };
  }
}
