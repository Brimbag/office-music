# Kontrakt API stanu

`GET/PUT /api/state` weryfikuje Bearer token przez Spotify `/v1/me`. Identyfikator z body nie jest używany.

Oficjalny [SDK Spotify](https://github.com/spotify/spotify-web-api-ts-sdk/blob/main/src/types.ts) deklaruje `UserProfile` dziedziczący `User.id`. Kod v42 wymagał wyłącznie `account_id`. API obsługuje oba warianty: jeśli zweryfikowana odpowiedź ma poprawne `account_id`, zachowuje ten dotychczasowy klucz partycji; w pozostałych przypadkach używa `id`. Nie kopiuje, nie usuwa ani nie scala rekordów kont. Sam SDK nie potwierdza odpowiedzi produkcyjnego konta.

Przed scaleniem/wdrożeniem sprawdzić na działającym środowisku obecność pól w odpowiedzi `/v1/me` i zgodność wybranego identyfikatora z istniejącymi rekordami `app_state`. Nie wypisywać tokenu ani pełnego profilu w logach. Jeśli istniejące rekordy wymagają przeniesienia między identyfikatorami, zatrzymać wdrożenie i zaplanować oddzielną migrację z backupem i rollbackiem. Nie wyszukiwać ani nie przypisywać innych partycji po danych klienta.

PUT przyjmuje `{ "state": { ... } }`, maksymalnie 2 MiB UTF-8 całego żądania, 1,5 MiB pojedynczej wartości i 32 klucze. Dozwolone są 23 klucze aktualnego `cloudStateKeys()`; nie są dozwolone tokeny, PKCE ani dowolne klucze `office_*`. Null jako wartość klucza pozostaje znacznikiem usunięcia, zgodnym z frontendem. Puste `{state:{}}` jest poprawnym zapisem bez zmian. Wartości JSON zachowują zgodność ze starszym API; stringi localStorage nie są przepisywane.

Walidacja całego payloadu kończy się przed zapisami. GET zwraca wyłącznie dozwolone klucze; pozostałe istniejące rekordy pozostają w bazie. Błędy danych: 400, przekroczenie rozmiaru: 413, brak/odrzucenie tokenu: 401, niedostępny Spotify: 502 lub 503 (429 zachowuje liczbowy Retry-After), niedostępna baza: 503.

Nie ma migracji SQL ani zmian bindingu DB. Rollback to powrót do poprzedniej funkcji; układ `app_state` i istniejące rekordy pozostają bez zmian. Testy uruchamiają atrapę interfejsu D1 i rozdzielenie kont w pamięci; nie potwierdzają danych ani dostępności produkcyjnego D1.
