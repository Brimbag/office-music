# LOG2 — historia generowań

Wersja v43.35.LOG2. W generatorze: **Narzędzia i dane → Historia generowań**. Wyłącznie widok diagnostyki, bez zmian selekcji, progów, discovery, feedbacku, źródeł kandydatów i RMF.

## Zachowanie

Po zalogowaniu można odświeżyć do 100 ostatnich wpisów przez istniejący chroniony `GET /api/generations?limit=100`. Brak GET przy starcie, otwieraniu panelu, zmianie filtrów i generowaniu playlisty; brak timera. Filtry wyniku, uczestnika i wersji działają na pobranych danych. Kolejność pochodzi z backendu, nie z zegara klienta. Starsze wpisy LOG1 schematu 1 pozostają czytelne.

Karty pokazują wersję, potwierdzoną długość, wynik, czas końca klienta i przyjęcia przez serwer, użyte profile, czasy, Search, discovery, różnych wykonawców i dopasowanie osób. Szczegóły: 11 etapów, bilans oczekiwania/tła, metryki inclusive/exclusive, filtry, zatrzymanie i pozyskiwanie. Liczniki odrzuceń mogą się nakładać; nie przypisujemy im wyłącznych udziałów ani nie rekonstruujemy nieobserwowanej przyczyny.

Błąd generowania odróżnia brak potwierdzenia utworzenia od możliwego częściowego zapisu. Preferencje w chmurze i wynik katalogu LF2 pozostają osobne. Potwierdzenie poprzedniej synchronizacji nie jest nowym zapisem LF2.

Lokalny `office_generation_log_last_v1` pojawia się tylko po zalogowaniu i przy zgodności oznaczenia konta, po walidacji tego samego schematu. To **jedna ostatnia próba**, nie pełna historia i nie dowód przyjęcia przez D1. Kopia nie jest powielana, gdy wpis o tym samym UUID znajduje się w pobranej historii. Nowe generowanie aktualizuje lokalny widok bez kolejnego GET. Lokalny raport nie jest automatycznie wysyłany przez LOG2.

## Izolacja i awarie

Backend nadal rozstrzyga właściciela przez Spotify `account_id`; klient nie przekazuje właściciela w query/body. Widok wymaga zakończonego logowania. Wylogowanie, nowa sesja i zmiana tokenu z innej karty czyszczą wrażliwe wpisy z DOM, resetują filtry i anulują odczyt. Odpowiedzi wcześniejszego konta są ignorowane. Po zmianie sesji w innej karcie należy ponownie załadować/logować stronę, aby zweryfikować konto; nie pokazujemy poprzednich danych przy niepewnej tożsamości.

Cała odpowiedź jest walidowana przed zastąpieniem danych. Render używa textContent i stałych etykiet; brak HTML z payloadu, tokenów, komunikatów wyjątków i surowej historii. 401 pozwala na jedno odświeżenie istniejącym PKCE i ponowienie samego GET; następny 401 kończy odczyt. 429/503 z Retry-After blokuje kolejne odczyty w danej karcie do końca przerwy, bez timera. Timeout 5 sekund na żądanie; równoległe kliknięcia nie tworzą dodatkowych zapytań. Błędy nie usuwają pobranych danych ani kopii lokalnej. LOG2 nie zapisuje localStorage, D1, preferencji ani playlist Spotify.

## D1 — zatwierdzona migracja, brak dostępu wykonawczego

Użytkownik zatwierdził aktywację migracji LOG1 w tej sesji. Dostępne środowisko nie ma zmiennych/konfiguracji uwierzytelniających Cloudflare ani narzędzia administracyjnego D1. GitHub proxy pozwala scalać/wdrażać kod, ale nie daje administracyjnego dostępu do bazy; odczyt konfiguracji Actions jest również niedostępny. **Nie wykonano produkcyjnego SQL ani uwierzytelnionego smoke testu dziennika.** Nie jest potrzebna kolejna zgoda na ten sam plik, tylko dostęp wykonawczy.

Administrator może wykonać aktywację w Cloudflare D1 Console:

1. Sprawdzić bazę wskazywaną przez binding `DB` produkcyjnego projektu Pages `office-music`. Nie wybierać bazy tylko po podobnej nazwie.
2. Odczytać `SELECT name FROM sqlite_master WHERE type='table' AND name='generation_logs';`. Jeśli już istnieje, porównać `PRAGMA table_info(generation_logs);` oraz indeksy z przygotowanym schematem; przy rozbieżności zatrzymać się zamiast zmieniać istniejące dane.
3. Wykonać dokładnie `migrations/0001_generation_logs.sql` (CREATE tabeli i indeksu IF NOT EXISTS). Nie zmieniać app_state i nie usuwać danych.
4. Na zalogowanym koncie wygenerować playlistę, sprawdzić potwierdzenie zapisu i **Odśwież historię**. Sprawdzić zgodność wersji, długości, profili oraz LF2. Na innym uprawnionym koncie historia pierwszego konta musi być niedostępna.

Alternatywnie udostępnić uprawnienie D1 do właściwej bazy przez bezpieczne ustawienia środowiska, bez wklejania tokenów w czat. Do czasu aktywacji widok toleruje 503 i pokazuje dostępną kopię lokalną, lecz pełna historia chmurowa nie jest potwierdzona.

## Testy i wycofanie

Chromium: sukces/pusta historia, stare wersje, filtry bez zapytań, częściowe błędy, lokalny fallback, brak sesji/inny właściciel, uszkodzony lokalny wpis, niedozwolony HTML/payload, 401 jednokrotny retry, błąd refresh/sieć/timeout/429/503, backoff, zachowanie poprzednich danych, równoległy odczyt, spóźniona odpowiedź po zmianie konta/wylogowaniu, zmiana sesji w innej karcie, klawiatura i szerokość 375 px. Pełna istniejąca regresja i benchmark nadal obowiązują.

Walidacja lokalna: **507/507 testów** (22 nowe). Porównanie z main c2aabf2 na identycznych danych/zegarze/losowaniu: 2/4 osoby, cold/warm; w czterech przypadkach identyczne 60 utworów, ID/kolejność, wyniki selekcji, stan pul oraz liczba/metody/ścieżki/parametry zapytań API. Czasy wykonania mocków mogą się różnić, nie są porównywane jako tożsamość żądań. LOG1 nadal zapisuje poprawny agregat. Wynik fixture nie jest prognozą długości na rzeczywistych danych użytkownika.

Wpływ na długość/jakość playlist: brak, kod selekcji i pozyskiwania pozostaje bez zmian. Dodatkowy GET występuje tylko na życzenie; backend uwierzytelnia go dotychczasowym odczytem Spotify /me, bez nowych Search/Last.fm. Rollback: revert LOG2, bez DROP i kasowania lokalnych/chmurowych wpisów. Warunki wycofania: ujawnienie historii innego konta, utrata danych, dodatkowe odpytywanie w tle albo wpływ widoku na generator.

Po aktywacji/smoke dziennika kolejny niezależny zakres: **M — wspólny monitor stanu odtwarzania Spotify**, a dopiero po nim osobni konsumenci V (głośność RMF) i S1/S2 (automatyczne pominięcia). Bez automatycznych ocen i regulacji głośności w PR M.
