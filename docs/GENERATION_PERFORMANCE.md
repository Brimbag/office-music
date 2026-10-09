# Pomiar generowania — kandydat v43.20.P

## Zakres i metoda

Audyt main `5109b1a` / v43.19.G z 2026-10-09. PR dodaje benchmark i raport; zmiany aplikacji dotyczą wyłącznie oznaczenia przyszłego wydania v43.20.P. Nie optymalizuje algorytmu, nie zmienia danych użytkowników ani konfiguracji. Wszystkie HTTP są lokalnymi atrapami, bez odczytu produkcyjnej D1 lub Spotify. OAuth/token i wybór profili zastąpiono fixture'ami; cleanup, źródła, kwalifikacja, selekcja, kolejność, snapshot, render i frontend synchronizacji wykonują rzeczywisty kod aplikacji.

Chromium, pełne pule Spotify 2000 / Last.fm artists 1800 / tracks 3000, 600 starych wpisów historii, cel 60; 100 kwalifikowalnych wykonawców, pozostała pula Spotify to Rework. Profile 2/4 z kontrolowanymi preferencjami Rock, nie rzeczywiste ankiety użytkowników. Zimny cache oznacza brak cache żądań i świeżych znaczników synchronizacji przy **pełnych pulach**, nie pustą bazę ani zimny system operacyjny. Ciepły cache zawiera komplet 10 stron dla rzeczywiście rozważanych zapytań oraz świeże TTL historii/tagów. Last.fm przy zimnym cache zwraca poprawne puste odpowiedzi: pomiar obejmuje wywołanie/synchronizację, ale nie koszt przetwarzania nowych 600 scrobbli i pełnego backfillu tagów.

Pięć zmierzonych przebiegów na scenariusz po rozgrzewce, każdorazowo nowy kontekst przeglądarki i odbudowane dane. Dodatkowa kontrola bez szczegółowych wrapperów: jeden przebieg po rozgrzewce na scenariusz, bez równoległego uruchamiania innych benchmarków. Przy n=5 empiryczne p95 to maksimum próbki, **nie wiarygodny percentyl produkcyjny**. Czasy inclusive obejmują zagnieżdżone funkcje — nie należy ich sumować. Exclusive dzielą pełny czas jednego przebiegu; suma sprawdzona bez błędu. Odstęp wyszukiwań Spotify 700 ms i budżet 12 pozostają rzeczywiste, bez wyłączania throttlingu.

## Wyniki pełnej ścieżki

| Profile | Cache | Mediana | Maksimum / empiryczne p95 | Kontrola minimalna | Wynik | Nowe search |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | zimny | 5,85 s | 5,99 s | 5,70 s | 60/60 | 5/12 |
| 2 | ciepły | 2,94 s | 3,33 s | 2,93 s | 60/60 | 0/12 |
| 4 | zimny | 5,96 s | 6,07 s | 5,92 s | 60/60 | 5/12 |
| 4 | ciepły | 3,04 s | 3,09 s | 3,02 s | 60/60 | 0/12 |

Kontrola potwierdza długość 60, minimum 56,04, discovery 0 zgodne z miękkim minimum i twardym maksimum oraz najwyżej jeden utwór danego artysty. Wielkości pul po generowaniu pozostają 2000/1800/3000; payload D1 około 515–516 KB. Mediana profilowanych prób i pojedyncza kontrola różnią się o około 0,2–2,6%; to sprawdzenie skali wpływu instrumentacji, nie dokładna estymacja narzutu.

Przy warm cache wynik ID/kolejności jest identyczny między próbami i kontrolą. Przy cold cache ID/kolejność wśród jednakowo ocenionych utworów różnią się również między samymi profilowanymi próbami: rzeczywiste zapisy używają Date.now i zmieniają kolejność świeżości puli. Nie deklarujemy identyczności ID cold ani wpływu instrumentacji na te remisy. Przyszła optymalizacja wymaga dodatkowych porównań na identycznym zamrożonym stanie i zegarze.

## Gdzie znika czas

Przykład: 2 profile, warm cache, maksima inclusive z pięciu prób. Te wiersze nakładają się.

| Funkcja / obszar | Wywołania / generowanie | Maksymalny czas |
| --- | --- | --- |
| eligibleGroupCandidates, wszystkie ścieżki | 8 | 1,56 s |
| acquisitionCoverage | 7 | 1,13 s |
| lastFmEvidenceForTrack | 1720 | 1,21 s |
| loadLastFmArtistPool | 538 | 0,81 s |
| loadLastFmTrackPool | 336 | 0,43 s |
| selectGroupPlaylist | 1 | 0,34 s |
| saveRecentPlaylistSnapshot | 1 | 0,36 s |
| renderPlaylistResult | 1 | 0,37 s |
| readSearchCache | 830 | 0,009 s |
| uploadCloudStateIfChanged, frontend + mock | 1 | 0,052 s |

W zimnych próbach pięć search daje 2,1–2,2 s rzeczywistego oczekiwania w waitForSearchSlot. Dochodzi koszt aktualizacji stanu i ponownego oceniania. Liczba HTTP: cold 24 (13 Last.fm, 5 search, 6 pozostałych), warm 5. Warm nie odpytuje historii ani Last.fm/search; nadal sprawdza konto/listę playlist, tworzy playlistę, zapisuje utwory i wysyła stan.

**Najsilniejszy dowód kosztu:** Last.fm jest wielokrotnie parsowany i przeszukiwany poza ścieżkami korzystającymi z retentionSnapshot. Końcowy kontekst budowany przez buildGroupRecommendationContext nie ma snapshotu rozpoznawalności używanego w acquisitionContext; groupTrackFeatures/recognizability i kwalifikacja odczytują więc ponownie te same pule. Nie oznacza to, że można skopiować snapshot bez sprawdzenia świeżości, ownership, pierwszego pasującego rekordu i asynchronicznych zmian blokad.

**Drugi prosty koszt:** trackDiagnostic jest wywoływane 120 razy dla 60 utworów: raz przy saveRecentPlaylistSnapshot, drugi raz w renderPlaylistResult. Łącznie około 0,60–0,89 s zależnie od próby/scenariusza. Każde wywołanie odczytuje pulę Spotify i dowody Last.fm.

**Trzeci koszt:** acquisitionCoverage ponownie kwalifikuje pełną pulę siedem razy. W warm cache nie ma nowych HTTP, ale są ponowne oceny po etapach przeglądania cache. Cache parsowany nawet 2270 razy w wariancie czterech osób jest znacznie tańszy (maks. 17 ms) niż te ponowne oceny; nie jest pierwszym celem optymalizacji.

Retencja w tym scenariuszu nie jest głównym kosztem: brak napływu nowych ID ponad limit i najwyżej 1–3 wywołania retainSpotifyPool, około 1 ms. Nie jest to dowód taniej retencji przy dużej liczbie nowych poprawnych kandydatów. Nie zwiększamy limitów.

## Czego ten pomiar nie rozstrzyga

- Rzeczywista latencja Spotify/Last.fm/D1, 429/retry, wolne Wi-Fi oraz praca na innym PC nie były mierzone.
- Mock /api/state mierzy serializację i pracę klienta, nie serwerowe /me, SQLite ani konflikty CAS istniejących wykluczeń.
- Nie odtwarzamy każdej kombinacji gustów, napływu nowych ID, współwykonawców, pełnej historii 90 dni ani wszystkich limitów 90/120/150.
- Nie dowodzimy, że spowolnienie na live wynika wyłącznie z D. Pomiary potwierdzają lokalne koszty, które warto ograniczyć; nie zastępują pomiaru tego samego generowania na urządzeniu użytkownika.

## Proponowane kolejne osobne PR-y optymalizacyjne

1. **P.1 — snapshot/index dowodów Last.fm dla końcowej kwalifikacji i diagnostyki.** Jeden snapshot danego etapu, indeksy zachowujące pierwszą pasującą pozycję. Zgodność z datowanym recentCount, ownership, feedbackiem i blokadami. Osobny świeży snapshot po każdym await/modyfikacji źródeł; nie używać starego snapshotu od początku generowania do końca.
2. **P.2 — współdzielenie diagnostyki finalnych utworów.** Raz wyliczony zestaw do snapshotu i UI, z zachowaniem dotychczasowej treści. Bez zapisywania lub traktowania wygenerowanej playlisty jako odsłuchu. Jeśli P.1 istotnie zmniejszy ten koszt, ponownie zmierzyć zasadność P.2.
3. **P.3 — ponowne użycie acquisitionCoverage.** Dopiero po P.1/pomiarze, cache po wersji stanu puli i wszystkich wejść: profile, Last.fm, historia, feedback, blokady, ustawienia/filtry. Unieważnianie po modyfikacjach i asynchronicznym oczekiwaniu. Większe ryzyko stale data niż pierwsze dwa PR-y.

Nie łączymy tych zakresów w jeden PR. Pierwsza rekomendacja: P.1. Kryteria dla każdego: identyczne kwalifikowalne ID, oceny indywidualne/grupowe, treść diagnostyki i finalne ID/kolejność na zamrożonym stanie/zegarze; pełne A/E/F2/F3/D/B/C regresje; brak wzrostu HTTP, zmian retry/gap/budżetu/limitów. Cel pomiarowy, nie obietnica: co najmniej 20% mniej lokalnego czasu warm dla P.1 i zdecydowanie mniej odczytów dużych pul. Wycofać przy dowolnym błędzie świeżości, utracie blokady/preferencji, zmianie wyników poza zamierzonym samym czasem lub wzroście 429. Brak migracji/SQL.

## Uruchomienie i dane

`node tests/benchmarks/generation-pipeline.mjs > /tmp/generation.json`

Konfiguracja: OMM_BENCH_REPETITIONS=1..20 (domyślnie 5), OMM_BENCH_API_DELAY_MS=0..1000 (domyślnie 0), OMM_BENCH_INSTRUMENT=0 dla minimalnej kontroli. Opóźnienie transportu jest symulacją, nie pomiarem sieci. Uruchamiać osobno od npm test i innych benchmarków. Program odrzuca niespodziewane endpointy i sprawdza pełne pule, wynik zapisu, minimum 35, discovery cap, limit artysty, budżet API i rozmiar stanu. Brak realnych żądań na podstawie fixture'ów.

Surowe próbki i kontrola: [generation-pipeline-performance.json](fixtures/generation-pipeline-performance.json). Instrumentacja istnieje tylko w procesie benchmarku, nie w kodzie produkcyjnym. Rollback PR pomiarowego: revert narzędzia/raportu i kolejna widoczna wersja, bez zmian danych. Scalenie wymaga zgody użytkownika; optymalizacje P.1–P.3 nie są jeszcze implementowane.

## Walidacja PR pomiarowego

Lokalnie: 278/278 pełnych regresji, bez fail/skipped/cancelled; składnia obu HTML, state API i benchmarku poprawna. Końcowy smoke v43.20.P uruchomił 8 generowań (2/4 profile × cold/warm × warmup/próbka) i potwierdził wszystkie niezmienniki. GitHub Regression uruchamia również ten smoke po npm test, bez progu czasowego; zwiększa to czas CI o około minutę, zależnie od runnera. Kod index.html/taste.html porównano z main po znormalizowaniu wersji — jest identyczny.
