export function prepareEvents(records) {
  return records.map((row, index) => ({ driver: Number(row.driver_number), position: Number(row.position), time: Date.parse(row.date), index }))
    .filter(row => Number.isFinite(row.time) && Number.isInteger(row.driver) && Number.isInteger(row.position) && row.position > 0)
    .sort((a, b) => a.time - b.time || a.index - b.index);
}

export function stateAt(drivers, events, time) {
  const states = new Map(drivers.map(driver => [Number(driver.driver_number), { ...driver, position: null, previous: null }]));
  for (const event of events) {
    if (event.time > time) break;
    const driver = states.get(event.driver);
    if (!driver) continue;
    if (driver.position !== event.position) {
      driver.previous = driver.position;
      driver.position = event.position;
    }
  }
  return [...states.values()].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.driver_number - b.driver_number);
}

export function createDemo() {
  const teams = [
    ['McLaren', 'FF8700', [[4, 'NOR', 'Lando Norris'], [81, 'PIA', 'Oscar Piastri']]],
    ['Red Bull Racing', '3671C6', [[1, 'VER', 'Max Verstappen'], [11, 'PER', 'Sergio Pérez']]],
    ['Ferrari', 'E8002D', [[16, 'LEC', 'Charles Leclerc'], [55, 'SAI', 'Carlos Sainz']]],
    ['Mercedes', '27F4D2', [[44, 'HAM', 'Lewis Hamilton'], [63, 'RUS', 'George Russell']]],
    ['Aston Martin', '229971', [[14, 'ALO', 'Fernando Alonso'], [18, 'STR', 'Lance Stroll']]],
    ['RB', '6692FF', [[22, 'TSU', 'Yuki Tsunoda'], [3, 'RIC', 'Daniel Ricciardo']]],
    ['Haas', 'B6BABD', [[27, 'HUL', 'Nico Hülkenberg'], [20, 'MAG', 'Kevin Magnussen']]],
    ['Alpine', 'FF87BC', [[10, 'GAS', 'Pierre Gasly'], [31, 'OCO', 'Esteban Ocon']]],
    ['Williams', '64C4FF', [[23, 'ALB', 'Alexander Albon'], [2, 'SAR', 'Logan Sargeant']]],
    ['Kick Sauber', '52E252', [[77, 'BOT', 'Valtteri Bottas'], [24, 'ZHO', 'Zhou Guanyu']]],
  ];
  const drivers = teams.flatMap(([team_name, team_colour, members]) => members.map(([driver_number, name_acronym, full_name]) => ({ driver_number, name_acronym, full_name, team_name, team_colour })));
  const order = [1, 4, 16, 81, 55, 63, 44, 11, 14, 18, 22, 27, 3, 10, 23, 31, 20, 77, 24, 2];
  const start = Date.UTC(2024, 0, 1, 14);
  const records = [];
  for (let step = 0; step <= 180; step++) {
    if (step) {
      const slot = (step * 7 + Math.floor(step / 3)) % 19;
      [order[slot], order[slot + 1]] = [order[slot + 1], order[slot]];
    }
    order.forEach((driver_number, index) => records.push({ driver_number, position: index + 1, date: new Date(start + step * 20000).toISOString() }));
  }
  return { drivers, events: prepareEvents(records), start, end: start + 3600000 };
}
