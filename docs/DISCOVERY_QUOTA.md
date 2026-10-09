# Końcowa quota discovery — v43.18.C

## Problem i decyzja produktu

PR C na `main` a5b2364 (wdrożona v43.17.B). Wstępny fallback używał limitu discovery dla zamówionej długości: dla celu 60/30% mógł zakończyć na 31 utworach z 21 odkryciami, choć stara quota dla faktycznych 31 wynosiła 11.

Decyzja użytkownika z 09.10.2026: przy 30% dolna granica 25% jest miękka, górna 35% twarda. Pierwszeństwo mają blokady/jakość/górna quota, następnie największa bezpieczna długość do celu. Nie skracamy listy ani nie usuwamy dobrych znanych utworów tylko dla dolnego procentu. Przy podobnej długości i jakości preferujemy udział bliższy targetowi. Dobieramy bezpieczne odkrycia do wolnych miejsc; nadmiar zastępujemy znanymi przed skracaniem.

`discoveryQuotaForTotal` zachowuje target i tolerancję ±5 p.p., ale max zaokrągla **w dół** (`floor`), żeby faktyczny udział nie przekroczył maksimum. Stare `ceil` pozwalało np. na 6/16=37,5%. Dolny miękki cel zaokrąglamy **w górę** (`ceil`): przy 50 utworach 25% wymaga 13 odkryć. Korekta 1e−9 eliminuje jedynie błędy zmiennoprzecinkowe na granicach całkowitych. Przy 1/2 utworach i 30% twardy max wynosi 0, miękki cel 1; przedział może nie mieć rozwiązania całkowitoliczbowego. UI opisuje obie granice osobno i nie przedstawia miękkiego niedoboru jako osiągniętego targetu.

Świadome 0% oznacza wyłącznie znane utwory, 100% wyłącznie discovery. Brak bezpiecznych kandydatów wybranego typu może dać pusty wynik. Nie obniżamy progów, aby wymusić wynik 100%.

## Algorytm i niezmienniki

Czysty lokalny `discovery-quota.js` otrzymuje tylko zakwalifikowane rekordy spełniające normalny próg 44 albo istniejący fallback 35 i jego guard feedbacku. `selectGroupPlaylist` zachowuje minimum 35 każdego obecnego profilu, karę wykonawcy ≤−40, blokadę Spotify ID oraz wszystkie wcześniejsze filtry historii, wersji, rozpoznawalności i jawnych blokad. Nie pobiera odrzuconych rekordów z surowej puli. Tryb 100% dodatkowo wyklucza znane utwory na wejściu do selektora z własnym licznikiem.

1. Uzupełnia wynik bezpiecznymi znanymi utworami do celu.
2. Przy nadmiarze discovery próbuje zastąpić odkrycie znanym kandydatem, sprawdzając ograniczenia po zwolnieniu miejsca, także współwykonawców.
3. Przy braku zastąpienia usuwa najsłabsze discovery i ponownie próbuje uzupełnić znanymi.
4. Próbuje dodać bezpieczne odkrycia do wolnych miejsc, bez usuwania znanych i tylko w quota faktycznej długości.
5. Porównuje poprawny wynik z dwoma ograniczonymi alternatywami: zachowanie znanych ze wstępnego zestawu i dobór znanych od początku, z bezpiecznym uzupełnieniem discovery.
6. Preferuje długość. Przy tej samej długości różnica średniej istniejącego `groupBase` większa od 1 punktu preferuje jakość; przy różnicy ≤1 preferuje udział bliższy targetowi, pod warunkiem zachowania znanych utworów wstępnego zestawu. Nie usuwa znanych wyłącznie dla procentu.

Poprawny pełny wynik ma szybką ścieżkę bez tworzenia deskryptorów korekty. Jeśli pierwotny poprawny wynik jest tak samo długi jak najlepsza alternatywa, zachowuje jego ID, kolejność i dynamiczne szczegóły. Każdy plan utrzymuje ID/sygnatury alternatywnych wydań i maks. dwa utwory każdego współwykonawcy według istniejącego `trackArtistKeys` (nazwy). C nie zmienia tożsamości ani blokad F2. Soft spacing realizuje istniejący `sequencePlaylistForListening`.

Przy zmianie zestawu odbudowuje stan: indywidualne satysfakcje, szczegóły, discovery, PL, aspekty i licznik faktycznie wybranych fallbacków. Wzory fairness/MMR nie zmieniają się; ponownie obliczone bonusy odnoszą się do nowego zestawu. Diagnostyka odróżnia niedobór bezpiecznych odkryć możliwych do dodania w zamówionym limicie bez usunięcia znanych od przekroczenia dozwolonego maksimum (po korekcie zero).

To trzy ograniczone heurystyki, nie globalne przeszukanie wszystkich kombinacji. Nie gwarantują optimum przy złożonych duetach i duplikatach. Naprawa jest co najmniej tak długa jak samo odcinanie discovery; indeksy ID/sygnatur/artystów ograniczają koszt zastąpień, a każda iteracja zmniejsza liczbę discovery.

## Regresje i długość

Porównanie z zamrożonym rzeczywistym selektorem **i oryginalną funkcją quota** v43.17.B, na tych samych kontrolowanych kandydatach, cel 60/30%, 2 i 4 profile. Oceny profili jawnie ustawione na 60: to test strukturalny, nie prognoza live. [Surowe wyniki](fixtures/discovery-quota-impact.json).

| Scenariusz bez zamienników | B: długość/discovery | C, 2 osoby | C, 4 osoby |
| --- | --- | --- | --- |
| 1 znany + 21 odkryć | 22/21 | 1/0 | 1/0 |
| 10 znanych + 21 odkryć | 31/21 | 15/5 | 15/5 |
| 21/36 | 36/21 | 23/8 | 23/8 |
| 20 znanych + 21 odkryć | 41/21 | 30/10 | 30/10 |
| 21/48 | 48/21 | 41/14 | 41/14 |
| 21/50 | 50/21 | 44/15 | 44/15 |
| Duety blokujące 40 znanych | 30/20 | 50/0 | 50/0 |

Każdy końcowy udział ≤35%; minimum każdej osoby nadal 60, bez API. W wariancie duetów dolny cel ma niedobór 13; zachowanie długości ma zgodnie z decyzją produktu pierwszeństwo. Osobny fixture udowadnia, że poprawny zestaw **40 utworów/12 odkryć (30%)** istnieje, lecz planer zachowuje **50 utworów/5 odkryć (10%)**, bez usuwania znanych; niedobór do miękkiego celu wynosi 8.

Dodatkowe przypadki: 31→60 przy 21 odkryciach, bez usuwania; zastąpienia 3/4 discovery→1/4 bez skrócenia; 10 znanych→15 utworów z 5 discovery bez usuwania znanych. Testy obejmują 0/1/5/30/50/95/100%, długości 0/1/2/10/60/90/120, granice zaokrągleń, najdłuższy wynik bez konfliktów, immutability, sygnatury/duety, zachowanie poprawnego wyniku, zbliżoną jakość i target, spójność szczegółów/statystyk po zmianie kolejności, minimum 35, feedback −40 i blokadę ID. 200 deterministycznych pul z duetami/duplikatami weryfikuje ograniczenia i długość nie mniejszą niż samo przycinanie. Końcowa regresja lokalna: **268/268**, zero błędów i pominiętych (realny Chromium, składnia obu stron i API, istniejące regresje algorytmu/historii/blokad/API/synchronizacji). Oba CI wymagane na finalnym commicie.

## Wydajność i zakres danych

C nie dodaje API, nie zmienia budżetów D, retencji D.2, limitów pul, D1, synchronizacji, RMF ani konfiguracji produkcyjnej. Dodaje lokalną pracę po selekcji.

`node tests/benchmarks/discovery-quota.mjs`: realny Chromium, kontekst puli 2000, 129 przygotowanych kwalifikowalnych rekordów, 2/4 profile, 10 naprzemiennych prób po rozgrzewce; przygotowanie ocen poza pomiarem. Dodatkowo sam planer z 2000 kwalifikowalnych deskryptorów. [Surowy pomiar](fixtures/discovery-quota-performance.json).

| Selektor, p95 | B | C | Długość B → C |
| --- | --- | --- | --- |
| 2 osoby, pełny poprawny | 392,1 ms | 374,1 ms | 60 → 60 |
| 4 osoby, pełny poprawny | 389,5 ms | 378,5 ms | 60 → 60 |
| 2 osoby, konflikty | 485,7 ms | 494,8 ms | 32 → 52 |
| 4 osoby, konflikty | 532,8 ms | 544,8 ms | 32 → 52 |

Średnia każdego profilu 60 przed/po; sam planer na 2000 deskryptorów p95 **24 ms**. Nie jest to czas całej generacji, sieci lub pozyskiwania D ani gwarancja na innych urządzeniach. Różnice pełnego wyniku mieszczą się w zmienności pomiaru; nie przedstawiamy C jako naprawy spowolnienia D. W konfliktach za większy poprawny zestaw dochodzi około 9–12 ms w tym benchmarku.

## Wdrożenie i wycofanie

Wersja obu nagłówków/tytułów, eksportu i modelu: v43.18.C. PR na aktualnym main po B; bez scalenia/produkcji podczas przygotowania. Brak migracji i nowych trwałych kluczy.

Rollback: revert tylko C na bieżącym main, nowa jednoznaczna wersja wszystkich etykiet, pełna regresja i osobno zatwierdzone wdrożenie. Zachować B i wcześniejsze zabezpieczenia; nie kasować pul/preferencji/D1. Revert przywraca stary błąd górnej quota oraz poprzednią semantykę zaokrągleń/100% — jawny koszt wycofania.

Wycofać przy przekroczeniu max, obejściu minimum/blokad/deduplikacji/limitu wykonawcy, błędach szczegółów/discovery po kolejności lub zapisie, nieuzasadnionym skróceniu poprawnego zestawu albo istotnym pogorszeniu czasu. Skrócenie niepoprawnej listy przy braku bezpiecznych znanych kandydatów jest zamierzone; samo nieosiągnięcie miękkiego minimum nie uzasadnia obniżenia jakości lub skracania.
