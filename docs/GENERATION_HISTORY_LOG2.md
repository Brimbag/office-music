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

## Produkcyjny smoke test — pozytywny, 2026-10-11

Potwierdzenie użytkownika dla LOG1/LOG2: migracja została wykonana w produkcyjnej bazie `office-music-db`. Tabela `generation_logs` zawierała 1 wpis. Po kliknięciu **Odśwież historię** w zalogowanym OMM widok wyświetlił: „Historia chmurowa: 1 ostatnich wpisów tego konta (maks. 100)”. Zapis wpisu i odczyt chmurowy są potwierdzone przez użytkownika; agent nie wykonywał migracji ani bezpośredniego testu na jego sesji.

Wcześniejszy komunikat „Połącz Spotify” był widoczny przed odświeżeniem. Na podstawie tego testu nie ma podstaw do zgłaszania błędu sesji ani zmiany LOG1/LOG2.

Aktywacja D1 jest zakończona; wcześniejszy brak dostępu administracyjnego środowiska nie jest już blokadą tej aktywacji. **Nie wykonywać ponownie migracji** `migrations/0001_generation_logs.sql`. Bez zmian kodu, danych D1 i konfiguracji produkcyjnej w ramach odnotowania wyniku. Potwierdzenie obejmuje zapis/odczyt na zalogowanym koncie; nie rozszerzamy go na produkcyjny test izolacji dwóch kont ani pełnej synchronizacji LF2.

## Testy i wycofanie

Chromium: sukces/pusta historia, stare wersje, filtry bez zapytań, częściowe błędy, lokalny fallback, brak sesji/inny właściciel, uszkodzony lokalny wpis, niedozwolony HTML/payload, 401 jednokrotny retry, błąd refresh/sieć/timeout/429/503, backoff, zachowanie poprzednich danych, równoległy odczyt, spóźniona odpowiedź po zmianie konta/wylogowaniu, zmiana sesji w innej karcie, klawiatura i szerokość 375 px. Pełna istniejąca regresja i benchmark nadal obowiązują.

Walidacja lokalna: **507/507 testów** (22 nowe). Porównanie z main c2aabf2 na identycznych danych/zegarze/losowaniu: 2/4 osoby, cold/warm; w czterech przypadkach identyczne 60 utworów, ID/kolejność, wyniki selekcji, stan pul oraz liczba/metody/ścieżki/parametry zapytań API. Czasy wykonania mocków mogą się różnić, nie są porównywane jako tożsamość żądań. LOG1 nadal zapisuje poprawny agregat. Wynik fixture nie jest prognozą długości na rzeczywistych danych użytkownika.

Wpływ na długość/jakość playlist: brak, kod selekcji i pozyskiwania pozostaje bez zmian. Dodatkowy GET występuje tylko na życzenie; backend uwierzytelnia go dotychczasowym odczytem Spotify /me, bez nowych Search/Last.fm. Rollback: revert LOG2, bez DROP i kasowania lokalnych/chmurowych wpisów. Warunki wycofania: ujawnienie historii innego konta, utrata danych, dodatkowe odpytywanie w tle albo wpływ widoku na generator.

Po pozytywnym produkcyjnym smoke teście dziennika kolejny niezależny zakres: **M — wspólny monitor stanu odtwarzania Spotify**, a dopiero po nim osobni konsumenci V (głośność RMF) i S1/S2 (automatyczne pominięcia). Bez automatycznych ocen i regulacji głośności w PR M.
