# Kontrakt API stanu

`GET/PUT /api/state` weryfikuje Bearer token przez Spotify `/v1/me`. Identyfikator z body nie jest używany.

Aktualny [kontrakt Spotify `/me`](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile), zweryfikowany 2026-10-08, definiuje `account_id` jako publiczny, niezmienny i pseudoanonimowy identyfikator. Wprost nakazuje używać go do powiązania konta zamiast `id`: „Do not use this field for account linking — use account_id instead, which is immutable”. Dotychczasowy klucz D1 był zgodny z tym kontraktem. Starsza definicja `UserProfile` oficjalnego SDK deklaruje `id` i pomija `account_id`; nie powinna zastępować aktualnej dokumentacji endpointu.

API wymaga poprawnego `account_id` po zweryfikowaniu tokenu. Odpowiedź z samym `id`, brakującym lub niepoprawnym `account_id` jest odrzucana jako niepoprawna odpowiedź upstream (502), przed dostępem do D1. Nie ma fallbacku do `id`, przepisywania, usuwania ani scalania partycji. Identyfikator przesłany przez frontend jest ignorowany.

Przed wdrożeniem wykonać smoke odczytu/zapisu z działającym kontem oraz sprawdzić rozmiar rzeczywistych payloadów względem limitów, bez logowania tokenu ani pełnego profilu. Testy automatyczne nie potwierdzają produkcyjnej dostępności ani danych. Nie jest potrzebna migracja tożsamości wynikająca z tego PR-a.

PUT przyjmuje `{ "state": { ... } }`, maksymalnie 2 MiB UTF-8 całego żądania, 1,5 MiB pojedynczej wartości i 32 klucze. Dozwolone są 23 klucze aktualnego `cloudStateKeys()`; nie są dozwolone tokeny, PKCE ani dowolne klucze `office_*`. Null jako wartość klucza pozostaje znacznikiem usunięcia, zgodnym z frontendem. Puste `{state:{}}` jest poprawnym zapisem bez zmian. Wartości JSON zachowują zgodność ze starszym API; stringi localStorage nie są przepisywane.

Walidacja całego payloadu kończy się przed zapisami. Zbyt głęboki JSON, którego nie da się bezpiecznie zserializować, jest odrzucany jako 400, bez częściowego zapisu. GET zwraca wyłącznie dozwolone klucze; pozostałe istniejące rekordy pozostają w bazie. Błędy danych: 400, przekroczenie rozmiaru: 413, brak/odrzucenie tokenu: 401, niedostępny Spotify: 502 lub 503 (429 zachowuje liczbowy Retry-After), niedostępna baza: 503.

Nie ma migracji SQL ani zmian bindingu DB. Rollback to powrót do poprzedniej funkcji; układ `app_state` i istniejące rekordy pozostają bez zmian. Testy uruchamiają atrapę interfejsu D1 i rozdzielenie kont w pamięci; nie potwierdzają danych ani dostępności produkcyjnego D1.
