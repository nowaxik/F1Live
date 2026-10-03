export class OpenF1Client {
  constructor({ fetcher = fetch, now = Date.now, gap = 2200 } = {}) {
    this.fetcher = fetcher;
    this.now = now;
    this.gap = gap;
    this.queue = Promise.resolve();
    this.nextRequest = 0;
  }
  async get(endpoint, params) {
    return this.queue = this.queue.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 1; attempt++) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, this.nextRequest - this.now())));
        this.nextRequest = this.now() + this.gap;
        let response;
        try {
          response = await this.fetcher('https://api.openf1.org/v1/' + endpoint + '?' + new URLSearchParams(params), {
            signal: AbortSignal.timeout(25000),
          });
        } catch { throw new Error('OpenF1 nie odpowiada. Sprawdź połączenie z internetem.'); }
        if (!response.ok) {
          if (response.status === 429) this.nextRequest = this.now() + 60000;
          const error = new Error(response.status === 429 ? 'Limit OpenF1 został osiągnięty. Ponowienie za minutę.' : response.status === 401 || response.status === 403 ? 'Sesja nie jest dostępna w darmowym archiwum. Wybierz starszą zakończoną sesję.' : `OpenF1 jest chwilowo niedostępne (HTTP ${response.status}).`);
          error.status = response.status === 429 ? 429 : 502;
          throw error;
        }
        let rows;
        try { rows = await response.json(); } catch { throw new Error('Niepoprawna odpowiedź OpenF1.'); }
        if (!Array.isArray(rows)) throw new Error('Niepoprawny format danych OpenF1.');
        return rows;
      }
    });
  }
}
