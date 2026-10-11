# LOG1 — backend dziennika generowań

Wersja: v43.34.LOG1. Osobny endpoint i tabela; bez zmian algorytmu playlist, progów, feedbacku, discovery, limitów źródeł ani RMF. LOG2 (widok historii) pozostaje osobnym PR-em.

## Kontrakt i prywatność

`POST /api/generations` przyjmuje pojedynczy wpis schematu 1 do 16 KiB UTF-8, ze strumieniowym limitem także bez Content-Length. Whitelisty pól obowiązują również wewnątrz obiektów. UUID identyfikuje jedną próbę generowania. Wpis zawiera wersję klienta, czas zakończenia klienta, success/error, zamówioną i potwierdzoną długość, potwierdzenie utworzenia playlisty, profile użyte w doborze po pominięciu profili bez danych (wyłącznie cztery istniejące identyfikatory), czasy 11 etapów, bilans synchronizacji/oczekiwania/tła, mierzone operacje i liczniki API/cache/OAuth.

Po sukcesie zapisujemy discovery i jego maksimum, liczbę odmiennych Spotify Artist ID (łącznie ze współwykonawcami, wyłącznie liczba), średnie dopasowanie/strong/weak, liczniki odrzuceń, przyczyny zatrzymania i bilans pozyskiwania. Przy błędzie nie deklarujemy poprawności nieukończonego zestawu: `selection:null`; `playlistCreated` i `length` mówią tylko o potwierdzonych operacjach Spotify, nie gwarantują braku częściowego zapisu po błędzie sieci.

Nie zapisujemy tokenów, PKCE, query, adresów URL, nazw utworów/wykonawców, ich ID, playlist ID, surowej historii ani komunikatów wyjątków. Builder wybiera konkretne pola zamiast serializować raport, profil lub wynik rekomendacji. Sam report/warnings pozostaje dotychczasową lokalną diagnostyką.

Osobne `cloud.state` oraz `cloud.lastfm` rozróżniają preferencje i LF2. LF2: not_run / success / skipped / error, liczby artystów/utworów/bajtów oraz `written`. `written:true` pojawia się dopiero po potwierdzeniu PUT katalogu. Cache odczytu zachowuje podsumowanie poprzedniego potwierdzenia, ale w bieżącym generowaniu zwraca `written:false`. Nieodczytane liczby są null, nie zero. Zmiana LF2 dotyczy wyłącznie obserwowalności; nie dodaje żądań ani nie zmienia merge/TTL/retencji.

`GET /api/generations?limit=20` zwraca chronione wpisy (limit 1–100, inne/zdublowane parametry odrzucane) i serwerowy `receivedAt`. Obie metody używają istniejącego Bearer auth Spotify `/me` i tylko niezmiennego `account_id`, bez publicznego `id` ani właściciela z body. GET ma Cache-Control:no-store. Dane nie trafiają do publicznego pliku i nie są częścią `/api/state`.

## Retencja i idempotencja

Tabela `generation_logs`: wewnętrzny `record_order` AUTOINCREMENT, `account_id`, `generation_id`, `payload_json`, serwerowy `created_at`, UNIQUE(account_id,generation_id). Indeks po account_id/record_order. Jedna transakcja D1 batch wykonuje INSERT ON CONFLICT DO NOTHING, retencję do **100 wpisów tego konta**, a następnie odczyt zapisanej wartości.

Ponowienie tego samego UUID/payloadu nie tworzy drugiego wpisu ani nie odnawia daty/kolejności retencji. Kolejność kluczy JSON jest kanonizowana. Ten sam UUID z innym payloadem daje 409, zachowując pierwszy wpis. Po usunięciu wpisu przez retencję UUID nie ma już tombstone, więc gwarancja deduplikacji dotyczy zachowanego okna. Nie ma automatycznych ponowień po niejednoznacznych wynikach sieci. Retencja korzysta z kolejności INSERT, również przy identycznych/cofających się timestampach; czas z przeglądarki jej nie steruje.

Błędy: 400 schemat/JSON/parametry, 413 rozmiar, 401 auth, 409 konflikt ID/nieobsługiwany zapisany schemat, 502/503 upstream lub baza. Nie ma CREATE TABLE w handlerze ani automatycznego wykonywania migracji podczas deployu.

## Klient i awarie

Po zakończeniu dotychczasowego generatora i zdjęciu instrumentacji powstaje UUID i zbiorczy wpis. Nowy zapis nie uruchamia ponownie generowania, wyszukiwania ani zapisów playlisty. Jedno dodatkowe żądanie do backendu oraz jego uwierzytelnienie Spotify /me; zero nowych Search / Last.fm / timera odpytywania. Zapis następuje także po nieudanej próbie, gdy dostępna jest sesja. Brak sesji pozostawia tylko diagnostykę lokalną.

Ostatni zbiorczy wpis lokalny: `office_generation_log_last_v1`, z lokalnym oznaczeniem konta, poza kluczami chmury preferencji. Quota nie usuwa raw cache, historii, preferencji ani poprzedniego wpisu; nadal próbujemy zapisać do chmury. To jedna ostatnia kopia, nie kolejka dostarczenia wszystkich zaległych generowań. `lastGenerationReport` i widoczna diagnostyka pozostają przy nieudanym zapisie.

POST ma timeout 5 s na żądanie. Jednoznaczny 401 (przed SQL) dopuszcza istniejące odświeżenie PKCE i jedno ponowienie tego samego wpisu. Brak replay po timeout/5xx/błędzie sieciowym, brak restartu generatora i brak nowych UUID przy retry. Retry-After z 429 lub 503 ustanawia przerwę w kolejnych zapisach tego konta, bez timera. Zmiana konta przed wysłaniem przerywa zapis starej operacji. Przy braku modułu dziennika generator nadal kończy zwykłą ścieżkę i odblokowuje przyciski.

Status zapisu pojawia się osobno poniżej raportu; czas POST jest dostępny w `lastGenerationReport.journal.ms`, poza zakończonym bilansem generowania. Kontrolki odblokowujemy po tej opcjonalnej próbie. Sukces dziennika oznacza potwierdzone przyjęcie wpisu, nie potwierdzenie pełnej synchronizacji LF2. Błąd dziennika nie zmienia playlisty w błąd.

## Aktywacja produkcji — osobna zgoda

Przygotowany i przetestowany plik: `migrations/0001_generation_logs.sql`. Dwa polecenia CREATE IF NOT EXISTS dodają nową tabelę i jej indeks; nie zmieniają `app_state`, preferencji, katalogów ani konfiguracji bindingu DB.

**Nie wykonywać na produkcji w ramach automatycznego scalenia/deployu PR.** Zgodnie z zaakceptowaną kolejką migracja produkcyjna jest osobnym zatwierdzanym działaniem. Po zgodzie wykonać dokładnie ten plik w D1 podpiętej do bindingu DB projektu Cloudflare Pages `office-music`; wcześniej sprawdzić, że ewentualna istniejąca tabela ma właściwy schemat. Do wykonania potrzebny jest dostęp administracyjny do tej bazy. Nie trzeba przekazywać tokenów w czacie.

Kod może być scalony/wdrożony przed aktywacją tabeli: brak schematu daje 503 i niepowodzenie opcjonalnego dziennika, bez przerwania playlisty. Do czasu migracji **historia generowań w D1 nie jest gotowa**, a ostatni lokalny wpis nie zapewnia odtworzenia całego tego okresu. Po wykonaniu SQL sprawdzić na uprawnionym koncie POST/GET oraz brak dostępu między kontami; nie publikować tokenów/payloadów prywatnych w logach smoke testu.

## Rollback i weryfikacja

Rollback: revert PR kodu i wrócić do poprzedniej wersji frontendu. Nie wykonywać DROP ani kasowania istniejących wpisów; tabela nie wpływa na starszy kod. Przyjęte logi pozostają w D1. Warunki wycofania: naruszenie izolacji kont, prywatne dane w payloadzie, utrata preferencji/cache, wywoływanie ponownych zapisów Spotify, blokowanie generowania przez dziennik lub przekroczenie retencji.

SQLite wykonuje rzeczywisty plik migracji dwukrotnie, testuje idempotencję, izolację, 105 wpisów i limit 100, równoległe powtórzenia, konflikt payloadu, kolejność przy zmianie zegara oraz rollback transakcji. Pure: whitelisty, rozmiary/liczby/daty, success/error/partial, stripping sekretów i osobny wynik LF2. Chromium: udany/duplikowany zapis, brak tabeli/503, 401 jednokrotny retry, 429/backoff, sieć/timeout, quota bez utraty cache, brak UUID/modułu, zachowanie kontroli generatora i potwierdzenie rzeczywistego PUT LF2.

Benchmark względem main 1975ec8: 2/4 osoby, cold/warm, identyczne dane/zegar/losowanie; we wszystkich czterech przypadkach 60 utworów, identyczne ID/kolejność/selektory i istniejące żądania, plus jeden POST dziennika. To test izolacji zmiany, nie prognoza długości na danych użytkownika. Pełna regresja i CI wymagane przed scaleniem. Bez produkcyjnych kont i zapisów D1 w testach.
