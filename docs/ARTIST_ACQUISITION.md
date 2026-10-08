# Pozyskiwanie kwalifikowalnych wykonawców — v43.13.D

## Problem i zakres

Generator używał liczby surowych rekordów do oceny nasycenia źródła. Trzy wariantowe lub zablokowane utwory mogły zatrzymać odświeżenie artysty wzorcowego, a wiele utworów jednego artysty w gatunku mogło kierować budżet do kolejnych podobnych stron. Priming wybierał najpierw losowy offset bez cache. Etap wspólny korzystał wyłącznie z zapytań gatunkowych, pomijając dostępnych już wykonawców Last.fm.

PR D zmienia tylko pozyskiwanie i diagnostykę. Punktacja, fairness, MMR, xQuAD, discovery, progi, limit dwóch utworów, historia, feedback, wersje i RMF zachowują dotychczasowe reguły. F3 pozostaje diagnostyczne; nie ma aktywacji dopasowań ani migracji preferencji. B i C pozostają osobnymi zakresami.

## Polityka źródeł

Trzy etapy pozostają: artyści wzorcowi (do 3 nowych wyszukiwań), gatunki (do 6/7/8 dla celu 60/90/120+) i wspólne źródła (do 3, w pozostałym globalnym budżecie). Globalne limity nadal wynoszą 12/14/16. Jedno zapytanie kanoniczne może otrzymać najwyżej jedną nową stronę w generowaniu; retry Spotify pozostaje dotychczasowe, maksymalnie trzy ponowienia po 429. Nie zwiększono liczby fizycznych prób na jedno wyszukiwanie. Mogą zostać wykorzystane dotąd niewykorzystane wywołania w istniejącym budżecie.

Najpierw odczytywane są świeże strony cache offsetów 0–90, raz dla zapytania w generowaniu, bez API. Działa to także przy zerowym pozostałym budżecie. Pusta strona nie zatrzymuje przeglądania kolejnych. Cache ma niezmienione TTL 24 h. Do puli z cache trafiają nowe kandydaty przechodzące rzeczywiste filtry i istniejącą bramkę normalną lub fallbackową. Zostają najwyżej dwie różne sygnatury na wykonawcę, z uwzględnieniem wcześniej kwalifikowalnych utworów. Warianty, blokady i duplikaty nie udają różnorodności. Pominięte rekordy pozostają w cache do oceny przy przyszłych profilach.

Podczas tego ponownego użycia cache dotychczas kwalifikowalne rekordy są chronione przed wyparciem z puli 2000. Przy pełnej puli odrzucane są stare niekwalifikowalne rekordy; jeśli nie ma wolnego miejsca poza chronionymi rekordami, nie dodajemy nowych z cache. Dotychczasowa polityka zapisu wyników świeżych wywołań API pozostaje bez zmian. Cache nie usuwa ocen ani preferencji, a quota zachowuje poprzednią zapisaną pulę.

Pozostały budżet kierowany jest najpierw do zapytań o najmniejszej liczbie użytecznych miejsc: sumie maksymalnie dwóch różnych sygnatur na znormalizowaną nazwę wykonawcy. W obrębie remisu zachowano wcześniejszą kolejność źródeł, preferencje gustu i rotację. Zapytania konkretnego wykonawcy są pomijane, gdy ma już dwie kwalifikowalne sygnatury lub obowiązuje twarda blokada nazwy/cooldown albo kara <=−40. Blokada Spotify ID nie służy do blokowania zapytania całej nazwy: inny homonim nadal może być wyszukany.

Etap wspólny obejmuje także wykonawców wybranych z istniejącej lokalnej puli Last.fm według gatunków profili (do 18 na profil, jak w istniejącym źródle zapytań profilu). Nie pobiera nowego Last.fm. Nadal każdy wynik musi przejść te same filtry. Nie ma gwarancji, że zapytanie o nową nazwę zwróci dobrego kandydata.

## Kwalifikacja i diagnostyka

Planer używa tych samych funkcji `eligibleGroupCandidates` i `groupCandidateStatic`. Można im przekazać tymczasowe rekordy do oceny cache; domyślnie nadal korzystają z trwałej puli. Reguły filtrów i wzory nie zmieniły się. Bramka pozyskiwania odpowiada istniejącej normalnej bramce `groupBase >= 44` lub istniejącemu bezpiecznemu fallbackowi `groupBase >= 35`, minimum profilu 35 oraz feedback >−40. **To nie implementacja PR B:** normalna selekcja zachowuje dotychczasową regułę minimum profilu. Progi nie są obniżane.

Diagnostyka pokazuje liczbę kwalifikowalnych wykonawców przed/po pozyskiwaniu, ponownie użyte strony cache i nowe wyszukiwania. Wykonawcy są liczeni po znormalizowanych nazwach, zgodnie z obecnym limitem dwóch utworów, a nie według nowych rozstrzygnięć F3. Współwykonawcy współdzielą limit i sygnatury; pojemność jest heurystyką kolejności zapytań, nie obietnicą długości. Końcowa selekcja ponownie buduje aktualne blokady po pozyskiwaniu, uwzględniając np. blokadę dodaną podczas oczekiwania na API.

## Regresje i wpływ

Pełne testy zawierają 142 wcześniejsze regresje oraz porównanie z zamrożonymi funkcjami pozyskiwania z main `9169cf2` w `tests/fixtures/acquisition-v43.12.json`. Fixture jest zapisany w repo, aby CI nie potrzebowało pełnej historii git.

Dla dwóch i czterech profili na identycznych danych oraz przy jednym wywołaniu API:

| Wynik | v43.12.F3 | PR D |
|---|---:|---:|
| Kwalifikowalni wykonawcy | 1 | 3 |
| Utwory przy celu 6 | 2 | 6 |
| Średnia każdego profilu | 78,08 | 78,08 |
| Nowe wywołania API | 1 | 1 |

To kontrolowana pula, nie prognoza wyniku live. Zmiana wyboru źródeł może poprawić długość i różnorodność, ale nie daje gwarancji przy pustej/niepasującej bazie albo innych odpowiedziach Spotify. Nie wymusza wypełnienia słabymi utworami. Scenariusze obejmują rzeczywiste `searchTracks` i limity dla 60/90/120, cache przy wyczerpanym budżecie/offline, nasycone źródła, brak powtórnego wywołania, blokady, homonimy ID, historię, duplikaty, 429, quota, cache przy 2000 rekordów oraz pełne generowanie/zapis/kolejność/snapshot z symulowanym Spotify.

## Dane, ryzyka i wycofanie

Brak nowych kluczy, tabel, migracji D1, konfiguracji i zależności. Używane są istniejące cache, pula Spotify i rotacja gatunków. Nie zmienia się budżet Last.fm. Dodatkowe ocenianie lokalnej puli może wydłużyć obliczenia; indeks pojemności zapytań powstaje wspólnie, bez odczytywania całej puli osobno dla każdego zapytania.

Wycofać przy przekroczeniu budżetu, utracie kwalifikowalnych rekordów wskutek ponownego użycia cache, obejściu blokad/progów/limitu dwóch utworów, istotnym pogorszeniu wyników dla 2/4 profili lub blokowaniu interfejsu przez obliczenia. Rollback: revert tego PR-a i nadanie nowego numeru nagłówkom/modelowi/eksportowi. Istniejącą pulę i preferencje zachować; starszy kod nadal je rozumie. Bez kasowania D1. Każde scalenie wymaga osobnego zatwierdzenia użytkownika.

## Uzupełniony audyt i warunek dalszej pracy

[Audyt limitów i rotacji pul](POOL_RETENTION_AUDIT.md) dokumentuje pełne pule, przestarzałe `recentCount`, ograniczoną rotację Last.fm oraz wyparcie wartościowych rekordów przez świeże API i cloud merge. Ochrona cache w tym PR nie rozwiązuje dwóch ostatnich ścieżek. Dodano testy charakteryzujące i prototyp retencji wyłącznie na kopii danych; nie zmieniono aplikacji ani limitów w ramach audytu.

Zalecana aktualizacja kolejności: osobny D.1 (aktualność historii), osobny D.2 (retencja/rotacja), następnie odświeżenie i ponowna weryfikacja tego PR. #13 pozostaje niescalony. Cele poprawy, wpływ na długość i warunki rollbacku wymagają zatwierdzenia zgodnie z audytem; nie są deklaracją wyników produkcyjnych.
