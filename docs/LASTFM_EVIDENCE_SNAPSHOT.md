# P.1 — świeże dowody Last.fm w kwalifikacji i diagnostyce

Kandydat v43.21.P1, baza main `58548eb` / wdrożona v43.20.P. Optymalizacja odczytów, bez zmiany algorytmu, progów, D1, limitów pul i API.

## Co się zmienia

`createLastFmEvidenceSnapshot()` raz odczytuje bieżące, znormalizowane pule Last.fm i feedback. Tworzy zbiór dokładnych sygnatur, indeks pierwszego pasującego rekordu wykonawcy oraz kontekst feedbacku. Dane są lokalne w pamięci; nie mają nowego klucza localStorage/D1 i nie trafiają do eksportu lub snapshotu playlisty.

Pierwsza kopia powstaje po zakończeniu pozyskiwania, bezpośrednio przed końcową kwalifikacją. `buildGroupRecommendationContext` przyjmuje ją jako opcjonalny argument i wykorzystuje również do rozpoznawalności oraz filtra wariantów. Model tagów nadal używa ostatniego rekordu danego klucza; rozpoznawalność i filtr wariantów nadal pierwszego, jak legacy `find()`. P.1 nie naprawia nazwowego łączenia homonimów i nie przypisuje preferencji do innego Spotify ID.

Po obu zapisach Spotify (utworzenie playlisty i zapis utworów) powstaje **nowa** kopia do diagnostyki. Pozwala uwzględnić zmiany Last.fm/feedbacku dokonane podczas oczekiwania na API. Oceny w groupResult nadal opisują moment selekcji, jak wcześniej. Snapshotu sprzed await nie używamy do źródeł/feedbacku w diagnostyce.

Nie ma globalnego cache ani ponownego użycia między generowaniami. Oba etapy są synchroniczne. recentCount i źródła są wyliczane przez istniejące loadLastFmArtistPool dla aktualnego konta i czasu na początku etapu; następny etap ponownie uwzględnia ownership, TTL i wygasanie. Snapshot nie odświeża się sam podczas trwania etapu: daje spójny obraz z jego początku. Nie przechowujemy go do późniejszego etapu.

Dotychczasowe wywołania bez dodatkowego argumentu zachowują dawny sposób odczytu. Istniejące snapshoty retencji/pozyskiwania bez indeksu pozostają obsługiwane. AcquisitionCoverage wciąż wykonuje się siedem razy w benchmarku; jego cache/invalidacja nie należą do P.1.

Diagnostyka nadal wyliczana jest 120 razy dla 60 utworów. P.1 współdzieli wyłącznie dowody Last.fm/feedbacku, a nie wynik trackDiagnostic. Usunięcie podwójnej diagnostyki pozostaje niezależnym P.2.

## Porównanie pełnej ścieżki

Chromium, pełne pule 2000/1800/3000, 600 starych wpisów historii, 100 kwalifikowalnych wykonawców, cel 60, kontrolowane preferencje Rock dla 2/4 osób. Pięć próbek po warmup dla każdego wariantu przed/po. Źródłowy kod sześciu zmienionych funkcji v43.20.P jest zamrożony w tests/fixtures/p1-baseline-v43.20.json; pozostałe funkcje algorytmu są niezmienione. Benchmark baseline podmienia te funkcje, a nie cały checkout aplikacji.

Math.random, kryptograficzne losowanie stron oraz modelowy Date.now są deterministyczne. Odstęp search 700 ms mierzy czas rzeczywisty i pozostaje zachowany. Oba pomiary wykonano kolejno, bez równoległego uruchamiania regresji. Wszystkie HTTP to zamknięte atrapy, nie produkcyjne Spotify/Last.fm/D1. Zimny cache oznacza pełne pule bez świeżych cache/TTL; Last.fm zwraca poprawne puste odpowiedzi, nie pełny nowy backfill. Szczegółowe ograniczenia metodologii pozostają takie jak w [GENERATION_PERFORMANCE.md](GENERATION_PERFORMANCE.md).

| Osoby | Cache | Mediana przed → po | Spadek mediany | Maksimum / empiryczne p95 przed → po |
| --- | --- | --- | --- | --- |
| 2 | zimny | 5,76 → 4,21 s | 26,9% | 5,83 → 4,27 s |
| 2 | ciepły | 2,87 → 1,75 s | 39,3% | 2,95 → 1,79 s |
| 4 | zimny | 5,81 → 4,21 s | 27,7% | 5,89 → 4,24 s |
| 4 | ciepły | 2,89 → 1,80 s | 37,7% | 2,96 → 1,89 s |

Cel co najmniej 20% redukcji czasu warm i wyraźnie mniej odczytów dużych pul został osiągnięty w tym scenariuszu. Przy pięciu próbach p95 jest maksimum próbki, nie produkcyjnym percentylem. Nie gwarantujemy takiej poprawy całego czasu na live: rzeczywiste API, 429, inne dane i sprzęt mogą dominować.

Na warm cache odczyty puli wykonawców spadają 538→19 (2 osoby), 540→21 (4); puli utworów 336→17. Kwalifikacja i 120 diagnostyk wykorzystujące jedną kopię wykonują łącznie tylko po jednym odczycie każdej puli, co potwierdza osobny test. Pozostałe odczyty benchmarku pochodzą z niezmienionych etapów pozyskiwania, stanu i podsumowań. Tworzenie dwóch snapshotów kosztuje maksymalnie około 50–61 ms na generowanie w badanych wariantach.

## Zgodność wyników i zakres

Automatyczny comparator sprawdził **20 par** generowań: identyczne końcowe ID i kolejność, minimum indywidualne, discovery, liczby wykonawców, pełne diagnostyki utworów, liczby i kolejność HTTP, liczby rekordów i rozmiar payloadu chmury. Sprawdził też powtarzalność wszystkich pięciu próbek baseline po ustaleniu losowań. Każdy wariant daje 60/60, minimum 56,04, discovery 0 (miękkie minimum nie skraca playlisty), search cold 5 / warm 0, pule 2000/1800/3000. Hash semantycznego wyniku i surowe czasy wszystkich prób zapisano w [p1-generation-performance.json](fixtures/p1-generation-performance.json); powtarzające się dane wynikowe przechowujemy raz.

Osiem nowych regresji obejmuje: pierwszy/ostatni rekord przy duplikatach, klasykę i współwykonawców, dokładne sygnatury, statyczne oceny i finalną selekcję dla 2/4 profili z rzeczywistym discovery oraz feedbackiem/blokadami, konto/TTL/recentCount, uszkodzone/puste pule, liczbę odczytów oraz zmiany podczas await zapisu i ponowne generowanie. Testy porównują także niezaokrąglone oceny i wagi dowodów, nie tylko tekst UI.

Lokalnie pełny zestaw: **286/286**, bez fail/skipped/cancelled; poprawna składnia obu HTML, state API, testów i benchmarków. Istniejący CI uruchamia pełne regresje i benchmark smoke bez progów czasowych. Wyniki CI konkretnego HEAD są zapisane w PR.

Audyt różnicy: nie zmieniono groupTrackFeatures, profileTrackSatisfaction, feedbackScore, eligibleGroupCandidates, selectGroupPlaylist, discovery-quota.js, acquisitionCoverage/primeDiverseQueries, retencji, historii, blokad Spotify ID, API stanu ani RMF. Zmienia się przygotowanie/przekazanie danych do tych funkcji i indeksowanie odczytu. Wersja zaktualizowana w obu stronach, eksporcie i diagnostyce, bez przepisywania historycznych snapshotów.

## Reprodukcja

```sh
OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_BASELINE=tests/fixtures/p1-baseline-v43.20.json node tests/benchmarks/generation-pipeline.mjs > /tmp/p1-before.json
OMM_BENCH_FIXED_CLOCK=1 node tests/benchmarks/generation-pipeline.mjs > /tmp/p1-after.json
node tests/benchmarks/compare-generation.mjs /tmp/p1-before.json /tmp/p1-after.json > /tmp/p1-comparison.json
npm test
```

Nie uruchamiać benchmarków równocześnie z testami. Poza trybem FIXED_CLOCK benchmark zachowuje dotychczasowe zachowanie czasu/crypto. Żadna deterministyczna atrapa nie trafia do aplikacji produkcyjnej.

## Ryzyka i wycofanie

Ryzyko funkcjonalne to niepoprawny wybór duplikatu lub użycie starego obrazu po zmianie źródeł/konta/feedbacku. Chronią je jawne dwa miejsca utworzenia danych, brak trwałego cache i regresje. Dodatkowe indeksy zajmują pamięć tylko w obrębie generowania, przy dotychczasowych rozmiarach pul; nie zwiększają localStorage ani payloadów D1. P.1 nie ma migracji i nie zmienia progów czasu. W pobliżu granicy TTL/recent obserwacja może różnić się od dawnych odczytów per utwór: teraz obowiązuje spójny obraz z początku etapu, odświeżany w następnym. Testy sprawdzają wygaśnięcie w nowym etapie; porównanie identyczności dotyczy ustalonego stanu i czasu.

Wycofać przy rozbieżnych ocenach/kwalifikowalnych ID/diagnostyce na tym samym stanie, pominięciu blokady, wykorzystaniu historii innego konta, wzroście HTTP lub nowym błędzie runtime. Revert całego PR, następnie nowa widoczna wersja; bez kasowania preferencji, historii, cache i D1. Scalenie i produkcja dopiero po potwierdzeniu użytkownika.
