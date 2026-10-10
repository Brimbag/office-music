# LF2 — kompaktowy katalog Last.fm w chmurze

Wersja: v43.33.LF2. Zakres: synchronizacja danych katalogowych kandydatów, bez zmiany scoringu, progów, feedbacku, discovery, limitu dwóch utworów i kolejki RMF.

## Audyt i kontrakt

Główne `/api/state` ma limit 2 MiB i nie przenosiło pul Last.fm. Fixture pełnych pul (1800 artystów / 3000 utworów, z nazwami Unicode) zajmuje 486804 bajty. Nowe `/api/lastfm` przenosi osobny katalog **do 128 KiB UTF-8**, zamiast dokładać pełne pule do istniejącego payloadu. W tej fixture pozostaje 656 artystów i 655 utworów, 131061 bajtów. Jest to reprezentatywny podzbiór, nie kompletna kopia bazy ani gwarancja liczby rekordów dla rzeczywistych danych. Limity lokalne 1800/3000 oraz Spotify 2000 pozostają bez zmian.

Schemat v1: `version`, znormalizowany `user` Last.fm, `artists`, `tracks`. Wiersz zawiera wykonawcę, opcjonalnie tytuł, **oryginalny** `savedAt`, do 20 tagów, do 8 oznaczeń źródła oraz istniejące MBID/dowody katalogowe (do czterech, z flagą ucięcia). Oznaczenia źródeł mówią o pozyskaniu kandydata, nie potwierdzają świeżego odsłuchu. Nie przenosimy `recentCount`, `recentObservation`, dat scrobbli, historii, markerów prób/sukcesu synchronizacji, `lastUsedAt`, surowego cache Last.fm ani tokenów OAuth.

Każdy rekord ma TTL 45 dni od istniejącego `savedAt`. Odczyt, przesłanie i merge nie odnawiają czasu. Wygasłe rekordy są logicznie pomijane i usuwane z następnego zapisu katalogu; brak osobnego zadania kasującego D1. Deterministyczna kompakcja przeplata artystów i utwory; utwory układa round-robin według wykonawcy, zaczynając od nowszych danych. Bardzo duży rekord może zostać pominięty na rzecz mieszczących się rekordów.

## Izolacja, zgodność i migracja

Endpoint korzysta z dotychczasowego uwierzytelnienia Spotify `/me`: wyłącznie `account_id`, bez fallbacku do publicznego `id` i bez identyfikatora właściciela z payloadu. Katalog jest dodatkowo oznaczony kontem Last.fm. Niezgodnego konta nie importujemy ani automatycznie nie nadpisujemy. Zmiana pary kont wymaga osobnego rozwiązania, nie migracji ocen po nazwie.

W istniejącej tabeli `app_state` powstaje pojedynczy klucz `office_lastfm_compact_v1`, dopiero przy pierwszym zwykłym zapisie klienta. **Nie potrzeba SQL ani ręcznej migracji produkcji.** Starszy `/api/state` ignoruje klucz przy GET i nie zmienia go przy PUT. Brak nowego endpointu, błędny lub przyszły schemat pozostawia dane lokalne i zdalne bez zmian oraz pokazuje ostrzeżenie. Starszy frontend po rollbacku ignoruje nowy rekord.

Zapis jest atomowym compare-and-swap na dokładnej poprzedniej wartości (`base`), również przy pierwszym INSERT i usunięciu wiersza między GET/PUT. Konflikt 409 powoduje ponowny odczyt i merge, najwyżej trzy próby; nie nadpisujemy cudzej równoległej wersji. Backend weryfikuje całe body przed SQL, whitelistę pól, schemat, liczbę rekordów, limit katalogu i strumieniowy limit żądania 512 KiB (obejmuje escaped CAS base).

## Zachowanie klienta

Synchronizacja współdzieli jedną operację w toku. Wykonuje się podczas istniejącej synchronizacji chmury przy logowaniu, przy ręcznej synchronizacji i po generowaniu; nie dodaje timera odpytywania. Niezmieniony katalog ma 10-minutowy cache odczytu. Zmiana katalogu umożliwia wcześniejszy zapis; ręczne pobranie/zapis omija ten cache. Potrzeba jednego GET i ewentualnie jednego PUT; każdy endpoint wymaga istniejącej weryfikacji Spotify `/me`, ale nie wykonuje nowych Spotify Search ani odświeżeń Last.fm.

Import jest addytywny. Zachowuje lokalne obserwacje historii, daty użycia i pełne lokalne tagi. Brak w ograniczonym katalogu chmurowym nie jest tombstone. Przy pełnej lokalnej puli nie usuwamy dotychczasowych kandydatów dla nowych rekordów z chmury; na nowym komputerze katalog wypełnia wolne miejsca. Dwa klucze pul zapisujemy osobno: jeśli drugi zapis zawiedzie, pierwszy udany import zostaje zachowany, a następna synchronizacja bezpiecznie dokończy merge. Nie ma destrukcyjnego zastępowania całej lokalnej bazy ani preferencji.

Zapis korzysta z istniejącego bezpiecznego `OmmLocalState.write`: quota może usunąć jedynie odtwarzalny raw cache; nie kasuje historii/preferencji. Aktywny import/odzyskiwanie blokuje synchronizację. Zmiana konta podczas GET uniemożliwia import wyniku starej operacji.

Jednoznaczny 401 dopuszcza jedno odświeżenie sesji i powtórzenie nieudanego żądania. Każde żądanie katalogu ma limit oczekiwania 10 sekund. Nie ponawiamy niejednoznacznych zapisów po timeout/błędzie sieci/5xx. `Retry-After` ustanawia backoff; inne błędy mają dwuminutową przerwę, bez automatycznego timera ponowień. Ręczna synchronizacja pozwala spróbować ponownie. Błąd katalogu nie blokuje istniejącego zapisu preferencji ani utworzenia playlisty; komunikat pozostaje widoczny w statusie chmury.

## Wpływ i rollback

Na identycznych lokalnych danych reguły wyboru pozostają identyczne. Nowy komputer może uzyskać więcej kandydatów niż wcześniej, ale katalog nie zastępuje aktualnej historii ani nie gwarantuje pełnej długości playlisty. Skrócona baza może zawierać mniej gatunków/utworów niż komputer źródłowy; kompletne lokalne pule pozostają nienaruszone. Koszt: ograniczony rekord D1, dodatkowy transfer do 128 KiB oraz operacje uwierzytelnienia podczas synchronizacji. Brak nowych scope OAuth i konfiguracji produkcyjnej.

Rollback: revert wyłącznie tego PR (frontend, endpoint, moduł i testy). Nie usuwać produkcyjnego klucza ani pul lokalnych. Poprzedni klient pomija nowy katalog. Warunki wycofania: utrata lokalnych preferencji/obserwacji, nadpisanie równoległego zapisu, migracja między kontami, odnowienie TTL przez odczyt, przekroczenie limitu payloadu lub blokowanie generowania przez awarię cache.

## Regresja

Testy pure: wykluczenie historii/tokenów, granice TTL, przyszłe/malformed dane, idempotencja merge, zachowanie niejednoznaczności MBID, cztery powtórzone dowody bez fałszywego ucięcia, byte limit Unicode i różnorodność pełnych pul. SQLite: izolacja kont, atomowy CAS przy insert/update/delete, stary klient, walidacja, oversized stream i nieobsługiwany schemat. Chromium: nowy komputer, pełna pula, lokalne obserwacje/tagi, równoległe żądania, konflikt i ponowny merge, quota, zmiana konta, inne konto Last.fm, offline/404, 401 jednokrotny retry, 429/backoff i niezależność zapisu preferencji.

Przed scaleniem: pełne `npm test`, zamknięty benchmark 2/4 profili cold/warm z identycznym zegarem/losowaniem względem main, CI i sprawdzenie deployu dokładnego SHA. Nie używać produkcyjnych kont/API do benchmarku.

Porównanie z main `2eddd2b` na fixture 2/4 osób, cold/warm, z ustalonym zegarem i losowaniem: we wszystkich czterech przypadkach 60 utworów oraz identyczne ID, kolejność, wyniki selekcji i żądania API poza nowym `/api/lastfm`. To kontrola braku zmiany algorytmu, nie prognoza długości na danych użytkownika.
