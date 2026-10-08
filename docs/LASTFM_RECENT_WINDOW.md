# D.1 — datowane dowody odsłuchów Last.fm (v43.14.D1)

## Problem i zachowanie

`Math.max(stary, nowy)` utrwalał dawne liczniki. Wynik tagowy odnawiał ich ważność przez `savedAt`, nieobserwowani wykonawcy nie byli zerowani, a synchronizacja aktualizowała tylko top 40. Nie było właściciela ani informacji, czy pobrano pełne okno.

D.1 dodaje opcjonalne `recentObservation` do lokalnych rekordów wykonawców: konto (case-insensitive), zakres zapytania, czas obserwacji, kompletność i daty odsłuchów. Odczyt liczy wyłącznie dowody aktywnego konta z ostatnich 14 dni, bez przyszłych dat. Każdy odsłuch wygasa indywidualnie. Tag nie odnawia obserwacji. Źródło `recent` nie jest dowodem rozpoznawalności, gdy nie ma aktualnych odsłuchów.

Pełna, poprawna odpowiedź zastępuje liczniki i zeruje nieobserwowanych wykonawców. Częściowa zastępuje dowody nazw obserwowanych w tej odpowiedzi (dolne oszacowanie) i zachowuje wcześniejsze datowane dowody nazw nieobserwowanych; nie udaje kompletnego wyniku. Błąd kolejnej strony albo nieprawidłowa odpowiedź nie publikuje częściowego zapisu. Nie ma dodatkowych stron/API: nadal maksymalnie 3 × 200. Wszystkie zaobserwowane nazwiska otrzymują dowód, bez top 40; limit puli pozostaje 1800. Duplikaty między stronami nie podnoszą licznika i odbierają pewność kompletności. Daty spoza rzeczywistego okna 14 dni są pomijane mimo zaokrąglonego parametru `from`.

Zmiana konta unieważnia dowody innego właściciela i wymusza odczyt historii w istniejącym budżecie nawet przy świeżym terminie poprzedniego konta. Sprawdzenie właściciela po await chroni przed publikacją odpowiedzi dla konta zmienionego w trakcie. Dotyczy dowodów `recentCount`, nie przenosi ocen, nie rozstrzyga homonimów ani nie izoluje całej wspólnej historii odtworzeń i tagów.

## Dane i kompatybilność

Brak migracji D1, nowych endpointów, zmiany limitów ani konfiguracji. Pule Last.fm pozostają lokalne. Nowy lokalny klucz `office_lastfm_recent_observation_v1` opisuje podsumowanie ostatniego pobrania; status rozróżnia pełne/częściowe okno i brak świeżej obserwacji. Podsumowanie jest świeże przez istniejący TTL cache historii; nie jest obietnicą pełnej liczby wszystkich odsłuchów.

Legacy `recentCount` bez właściciela/dat nie jest aktualnym dowodem. Nie przypisujemy go automatycznie bieżącemu kontu. Nie kasujemy rekordów, tagów, ocen, blokad ani historii; kolejne zapisy mogą zastąpić legacy licznik liczbą potwierdzoną lub zerem. Przy następnym odświeżeniu historii powstają datowane dowody. Quota zachowuje poprzedni zapis puli i nie aktualizuje terminu udanej synchronizacji po błędzie jej zapisu. Dodatkowe daty zajmują pamięć: maksymalnie 600 nowych znaczników na odpowiedź, bez zwiększenia liczby rekordów lub żądań.

Starszy kod ignoruje nowe pola, rozumie dotychczasowe rekordy i `recentCount`. Eksport/import zachowuje opcjonalne dane jako część lokalnego stanu; niczego nie zapisujemy do produkcji podczas przygotowania PR.

## Regresje i wpływ na playlisty

17 nowych testów w prawdziwym Chromium: pełna/częściowa obserwacja, 99 → 1, zerowanie nieobecnych, indywidualne wygasanie, tagi, legacy, inne konto, awaria drugiej strony, malformed, pusty wynik, quota, 55 wykonawców, duplikaty, zmieniającą się paginację i niepoprawne daty, zmiana konta podczas await ochronę nowszej obserwacji przed wolniejszą odpowiedzią oraz wymuszenie nowej historii po zmianie konta. Istniejące testy obejmują API/state, import/export, feedback, blokady, wersje, RMF i oba HTML.

Porównanie kontrolowanej puli ośmiu nagrań, celu 6, identycznych odpowiedzi i ziarna:

| Osoby | Legacy sposób odczytu liczników | D.1 bez datowanych dowodów | D.1 z potwierdzonymi dowodami |
|---|---|---|---|
| 2 | 6 utworów; średnie 56,04 / 56,04 | 6; 56,04 / 56,04 | 6; 56,04 / 56,04 |
| 4 | 6 utworów; każda średnia 56,04 | 6; każda 56,04 | 6; każda 56,04 |

Porównanie odtwarza dawny odczyt `recentCount` na tej samej puli; nie jest replayem produkcyjnej generacji ani pełnej poprzedniej aplikacji. Te nagrania mają niezależne dowody utworów i gatunków. W live może być krócej, gdy jedynym dowodem rozpoznawalności był stary licznik, lub inaczej rozłożone discovery. Usunięcie fałszywego bonusu nie obniża jakościowych progów. Wzory ocen, progi selekcji, quota discovery, limit dwóch utworów, feedback, RMF i polityka retencji D.2 pozostają bez zmian.

## Warunki wycofania

Wycofać przy zerowaniu po częściowej/błędnej odpowiedzi, wykorzystaniu dowodów innego konta, odnowieniu historii przez tagi, utracie preferencji, zwiększeniu budżetu albo niewyjaśnionym pogorszeniu długości/jakości po pełnym odświeżeniu. Przed wdrożeniem zachować eksport lokalnego stanu. Rollback: revert PR i nowy numer w nagłówkach/modelu/eksporcie, bez kasowania baz/D1. Powrót starego kodu przywraca jego wadliwą politykę `Math.max`, więc rollback nie jest naprawą aktualności. Każde scalenie wymaga zatwierdzenia użytkownika; D.2 i #13 pozostają osobne.
