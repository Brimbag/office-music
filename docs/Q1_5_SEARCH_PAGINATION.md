# Q1.5 — paginacja Spotify Search, 1.0.5-rc

## Diagnoza i zakres

Produkcja Q1.4 (12.10.2026, 00:43 czasu Warszawy): 53/60 dla 4 osób, 24,6 s, 12/12 Search. Trzy puste żądania były poza deklarowanym katalogiem: Stare Dobre Małżeństwo offset 80/total 63, groove metal 30/10, Kitty Pryde 30/1. Jednocześnie Spotify zwróciło dla kitty 5 wyników przy offset 40/total 5. Potrzebna jest paginacja korzystająca z dowodów, bez bezwarunkowego zaufania do total.

Zmiana dotyczy wyłącznie wyboru stron w pozyskiwaniu, nie rankingu zapytań lub utworów. Budżet 12 dla celu 60 (dotychczasowe 16 dla większych celów), offsety 0–90, limit dwóch utworów wykonawcy, progi profili, feedback, discovery, RMF, retencja i OAuth bez zmian. Nie naprawiamy w tym PR nazw Mars Volta/Kitty ani gatunków dających total 0.

## Reguły

- Nieznany katalog zaczyna od nieopłaconej strony 0. Gdy strona 0 jest świeża, kolejne nieznane strony idą rosnąco; nie odświeżamy ponownie opłaconego cache tylko dla metadanych.
- Zakres pochodzi z ważnych stron cache Q1.4: raw jest całkowite 0–10, total jest nieujemną bezpieczną liczbą całkowitą. Liczba items po filtracji nazw nie jest dowodem wielkości katalogu.
- Spójne total ogranicza nowe strony do offset < total. Potwierdzone total 0/raw 0 pozwala przeznaczyć budżet na inne zapytanie, także gdy pustą odpowiedź otrzymano z głębszej strony.
- Różne total, wyniki poza deklarowanym zakresem lub pusta odpowiedź wewnątrz deklarowanego zakresu oznaczają sprzeczność: nie odcinamy stron na podstawie total; stosujemy ostrożną kolejność nieopłaconych stron od zera.
- W spójnym, znanym zakresie dalsze nieopłacone strony są rotowane losowo. Nie rozszerzamy dotychczasowego maksimum offset 90.
- Opłacony cache jest nadal dostępny, również poza później pomniejszonym zakresem. Zbiorcze reuse cache w pozyskiwaniu pozostaje bez zmian.
- Starsza ścieżka planująca po 3 strony ponownie sprawdza dopuszczalność przed każdym nowym żądaniem. Odpowiedź z pierwszej strony może więc zatrzymać zbędne żądania zaplanowane wcześniej.
- TTL 24 h pozostaje bez zmian. Po wygaśnięciu/odrzuceniu metadanych ponownie zaczynamy od strony 0. Nie traktujemy błędu API jako pustego katalogu.

## Weryfikacja i wpływ

Testy obejmują total 0/1/5/10/11/38/63/100/107/1000, nieznany katalog, legacy cache, brak metadanych, TTL/uszkodzone dane, sprzeczne total/kitty, puste filtrowane odpowiedzi, częściowe strony, rotację i zachowanie opłaconych stron. Integracja sprawdza przekazanie budżetu innemu wykonawcy, ponowną ocenę starego wielostronicowego planu, 401/429 oraz błąd sieci bez dodatkowego żądania i fałszywego potwierdzenia katalogu.

Kontrolowane porównanie Q1.4/Q1.5 dla 2/4 osób: dwa katalogi po 2 utwory. Q1.4 z ustalonym losowaniem wybiera puste strony 10, Q1.5 strony 0, przy tych samych 2 żądaniach. Test wymaga 0 → 4 utworów, minimum 35 dla każdej osoby, 2 wykonawców i poprawnej quota. To przykład poprawy pozyskiwania, nie obietnica wzrostu każdej playlisty. Produkcyjne ID, kolejność i średnie mogą się zmienić, ponieważ zmieniają się pozyskane strony; funkcje punktacji i selekcji pozostają te same.

Pełne npm test oraz oba istniejące benchmarki CI (standardowy 2/4 cold/warm i Q1 audit 3 warm) są wymagane przed scaleniem. Nie ma nowych zapytań kontrolnych, frameworka, schematu cache ani migracji D1. Preferencje i dane produkcyjne nie wymagają konwersji. Środowisko używa istniejącego Node/Chromium/harnessu.

## Smoke, rollback i następny krok

Po publikacji sprawdzić nagłówek 1.0.5-rc, wygenerować zwykłą playlistę i skopiować Skuteczność Search wraz z końcowymi filtrami/czasem. Nie kasować cache. Nieznane zapytania powinny zaczynać od zera; dla znanych katalogów nie każde żądanie będzie offset 0. Przy sprzecznych metadanych dopuszczalna jest ostrożna obsługa bez twardego zakresu.

Rollback: revert całego PR, bez kasowania puli/cache/preferencji. Wycofać przy naruszeniu budżetu API, jakości lub blokad, błędach runtime albo utrzymującym się pogorszeniu różnorodności/długości w porównaniach na tych samych wejściach. Nowe cache jest identycznego formatu z Q1.4; brak migracji.

Następnie osobny Q1.6: potwierdzone nazwy/tożsamość wykonawców wzorcowych (np. Mars Volta/The Mars Volta), bez luźnego scalania Spotify ID i bez przenoszenia ocen. Dalej Q1.7: rotacja zapytań bez bezpiecznego wkładu na podstawie pomiarów, osobno od progów selekcji.
