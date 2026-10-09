# Alternatywne wersje — v43.7.E

PR E bazuje na main po PR A. Nie obejmuje PR F (tożsamość wykonawców), D, B, C ani niescalonego PR #5.

## Reguły

`hasAlternativeVersionMarker()` odrzuca Rework/Reworked w opisie wersji w nawiasie, nawiasie kwadratowym lub segmencie po separatorze tytułu/albumu. Zwykły tytuł „Rework”, nazwa albumu „Rework” lub wykonawca Rework nie są same w sobie opisem alternatywnego nagrania.

Oznaczenia Orchestra/Orchestral/Variation w kontekście wersji oraz album nazwany dokładnie „Orchestral Version” są wskazówkami orkiestrowego wariantu. Strukturalny tytuł dzieła klasycznego (np. Symphony No. 5, BWV 988) lub klasyczne tagi Last.fm głównego wykonawcy chronią takie nagranie. Istniejące Live/Remix/Rework nadal działają także przy klasyce — ochrona nie wyłącza wszystkich filtrów wersji.

Dodatkowy wykonawca nazwany Philharmonic Orchestra lub Symphony Orchestra jest sygnałem tylko w połączeniu z mocnymi tagami Last.fm nowoczesnego głównego wykonawcy (rock/pop/metal itd.). Zapytanie Spotify genre nie wystarcza. Orkiestra jako główny wykonawca i sama nazwa The Cinematic Orchestra nie powodują odrzucenia. Przykład: Def Leppard + Royal Philharmonic Orchestra z tagiem rock odpada; bez tych tagów brak podstaw do automatycznego wykluczenia. To świadomie ostrożna reguła, nie pełna klasyfikacja muzyki klasycznej lub wszystkich orkiestr świata.

Gdy użytkownik wyłączy istniejący filtr alternatywnych wersji, nowe reguły również są wyłączone. Reguły remasterów pozostają: remaster odpada, jeśli istnieje zwykłe wydanie. Wariant orkiestrowy nie jest uznawany za zwykłe wydanie podczas budowania tego indeksu.

Nie rozszerzamy kanonizacji sygnatur o Rework: zmieniłoby to klucze istniejącego feedbacku i historii bez migracji. Nowe markery dotyczą filtrowania; dotychczasowe sygnatury i zapisane oceny pozostają odczytywane. Nie zmienia progów jakości, discovery, kary wykonawcy z A, budżetu API, limitu dwóch utworów ani RMF. Nie wykonuje nowych wywołań API ani zmian D1.

## Walidacja i wpływ

Dziesięć nowych testów obejmuje markery i zwykłe tytuły, metadane albumu, Def Leppard, The Cinematic Orchestra, orkiestrę jako głównego wykonawcę, klasyczne dzieła, mieszane tagi classical/pop, wyłączenie filtra, zachowanie remasterów i sygnatur feedbacku. Obie strony mają sprawdzaną wersję nagłówka i tytułu. Pełny zestaw lokalny: 77/77.

Porównanie identycznej puli na main 7aba472 i E, Math.random = 0.25, dla dwóch/czterech profili: cel 6, dwie pozycje Rework i cztery zwykłe; rozszerzona pula dodaje dwa zwykłe zamienniki. Bez zamienników długość main → E wynosi 6 → 4; z zamiennikami 6 → 6. Średnia każdej osoby pozostaje 56,04. Nie przewiduje to długości na rzeczywistej puli użytkownika.

Wykrywanie kontekstu orkiestrowego nadal korzysta z dotychczasowego nazwowego połączenia Last.fm, więc istniejące ryzyko homonimów rozwiązuje osobny PR F. Brak mocnych danych celowo pozostawia niejednoznaczne nagranie dozwolone. Przy niespójnym opisie dzieła klasycznego lub niepełnych tagach możliwe są błędne klasyfikacje; przykłady należy dodawać jako regresje przed rozszerzaniem reguł.

## Wycofanie i oznaczenie wydania

Revert PR E, bez migracji danych; istniejące historie, preferencje, feedback i pula nie wymagają odtworzenia. Wycofać przy fałszywym odrzucaniu zwykłych/klasycznych nagrań lub zmianie odczytu zapisanych ocen. Skrócenie wyłącznie przez odrzucenie uzgodnionych wariantów jest oczekiwane.

Każde kolejne wydanie produkcyjne ma mieć odrębne oznaczenie `v43.<numer PR>.<zakres>`, np. `v43.7.E`. Zaktualizować nagłówki i tytuły obu stron, metadane eksportu i bieżącą diagnostykę generatora; sprawdzić oznaczenie na live po wdrożeniu. Nie przepisywać wersji w historycznych snapshotach playlist. Cofnięcie do starszej wersji powinno pokazać jej starsze oznaczenie.
