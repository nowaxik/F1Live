# F1Live — wersja bez płatnych API

Aplikacja lokalna z klasyfikacją F1, skrótami kierowców, barwami zespołów i powtórkami.

## Uruchomienie

Node.js 22 lub nowszy:

```powershell
npm ci
npm start
```

Adres: http://localhost:4173. Zatrzymanie: Ctrl+C. Testy: `npm test`.
Nie jest wymagane konto, abonament, klucz API ani plik `.env`. Poprzednie zmienne OPENF1_USERNAME i OPENF1_PASSWORD nie są już odczytywane.

## Tryby

- **Na żywo → Połącz z F1 Live Timing**: anonimowy publiczny strumień SignalR Core z `livetiming.formula1.com`. Odbieramy SessionInfo, SessionStatus, DriverList, TimingData i Heartbeat. Serwer przesyła przeglądarce gotową tabelę przez SSE. Jedno połączenie źródłowe obsługuje wszystkie otwarte lokalne karty; po rozłączeniu ostatniej karty odbiór ustaje.
- **Archiwum**: bezpłatne dane historyczne OpenF1 od 2023 roku. Wybierz rok, pobierz listę sesji, następnie uruchom powtórkę. Sesje trwające lub zakończone mniej niż 30 minut temu są pomijane. Dostawca może ograniczać zakres i liczbę zapytań.
- **Demo**: fikcyjne zmiany pozycji i przykładowy skład z 2024 r.; działa bez internetu.

Powtórki i demo mają pauzę, restart, przewijanie i prędkość od 1× do 60×.

## Publiczne dane na żywo

Publiczny dostęp nie gwarantuje dostępności ani pełnego zakresu danych podczas każdej sesji. To nie jest oficjalne API z gwarancją wsparcia. Jeśli źródło odrzuci anonimowy dostęp (401/403 lub odmowa subskrypcji), aplikacja pokaże niedostępność i nie podejmie próby logowania ani przełączenia na płatną usługę. Błędy sieciowe wywołują ponowienie z narastającą przerwą do 60 sekund.

Źródło może zwrócić migawkę zakończonej sesji. Interfejs oznacza ją jako SESJA ZAKOŃCZONA. Sesja bez potwierdzonego statusu Started/Resumed jest oznaczana jako oczekiwanie lub przerwana. Dodatkowo stara sesja z przeterminowanym czasem końca nie jest oznaczana jako live. Tabela po zerwaniu połączenia pozostaje widoczna z ostrzeżeniem. Czas ostatniego zapisu pozycji nie jest wskaźnikiem sprawności łącza: pozycje mogą długo się nie zmieniać. Początkowa migawka nie zawiera czasu każdej pozycji, więc jej czas nie jest wymyślany.

Po reconnect odbieramy nową migawkę. Częściowe zmiany nie kasują metadanych kierowców; starsze pozycje nie nadpisują nowszych. Zmiana sesji usuwa klasyfikację poprzedniej. Zmiany pozycji oznaczają awanse w klasyfikacji, nie potwierdzone wyprzedzania. Dopuszczalne są przejściowe duplikaty pozycji, jeśli źródło aktualizuje kierowców osobno.

## Zakres i weryfikacja

Podstawowa tabela obsługuje sesje wskazane przez źródło: treningi, kwalifikacje, sprinty i wyścigi. Nie ma jeszcze osobnych widoków Q1/Q2/Q3, czasów okrążeń, statusów PIT/DNF, mapy toru ani synchronizacji z TV.

Testy obejmują ramki SignalR, częściowe aktualizacje, reconnect, odmowę anonimowego dostępu, statusy sesji i odtwarzanie archiwum. Potwierdzono również anonimowe połączenie z prawdziwym źródłem oraz pobranie migawki kierowców i klasyfikacji. Aktualizacje w trakcie trwającej sesji wymagają osobnego sprawdzenia podczas jazdy.

Serwer jest dostępny wyłącznie na 127.0.0.1 i serwuje pliki z `public`. Dane routingu połączenia z serwerem F1 pozostają na backendzie. Archiwum ma kolejkę zapytań i podręczną pamięć odpowiedzi. Opcjonalne Google Fonts mają lokalne fonty zastępcze.

Źródła techniczne: https://github.com/theOehrly/Fast-F1/blob/main/fastf1/livetiming/client.py oraz https://openf1.org/docs/ . Dostęp publiczny nie jest równoznaczny z licencją na komercyjną redystrybucję. Projekt fanowski, niezwiązany z Formula 1 ani FIA.
