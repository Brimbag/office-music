# P.2 — jeden wynik diagnostyki do zapisu i widoku

Kandydat **v43.22.P2**, baza main `99cec78` / wdrożona v43.21.P1.

## Mechanizm i zakres

Po zakończeniu obu zapisów Spotify generator tworzy świeży snapshot dowodów P.1, a następnie `buildPlaylistDiagnostics` oblicza tekst diagnostyki każdego utworu. Lokalna mapa przypisuje wynik do obiektu utworu; nie do jego nazwy ani ID. Dzięki temu różne obiekty o tej samej nazwie, brakującym ID lub z różnymi współwykonawcami nie nadpisują się. Powtórzony obiekt wymaga tylko jednego obliczenia. Pusty tekst pozostaje prawidłowym wynikiem.

Ta sama mapa jest przekazywana do `saveRecentPlaylistSnapshot` oraz `renderPlaylistResult`. Te dwa etapy pozostają synchroniczne. Nie ma globalnego cache, ponownego użycia pomiędzy generowaniami ani przekazywania mapy przez await. Wywołania bez mapy i brakujący wpis zachowują dotychczasowe obliczanie diagnostyki. Przywracanie ostatniej playlisty nadal wyświetla zapisany tekst; oceny i blokowanie nadal działają jak wcześniej.

Mapa nie jest serializowana. Schemat ostatnich trzech playlist, preferencje, historia, pule localStorage, payload chmury i API stanu pozostają bez zmian. Tekst opisuje stan po zapisach Spotify, a wyniki modelu w groupResult moment selekcji, zgodnie z P.1.

Nie zmieniają się trackDiagnostic, selekcja, progi, feedback, discovery, RMF, pozyskiwanie, retencja i budżety API. Nie indeksujemy tu dodatkowo Spotify candidate pool i nie buforujemy acquisitionCoverage: te zakresy nie należą do P.2. Dla 60 różnych obiektów wywołania trackDiagnostic spadają z 120 do 60.

## Regresje

Cztery nowe regresje porównują zapis i widok z zamrożonym kodem P.1 dla 2/4 osób (dokładny tekst, dane utworów, feedback, współwykonawcy i szczegóły ocen modelu), sprawdzają odtworzenie snapshotu bez ponownego obliczania i kliknięcie oceny. Przypadki graniczne obejmują homonimy Days of the New z różnymi Spotify Artist ID, brak Track ID, powtórzony obiekt, pusty tekst, pustą listę, niepełną mapę oraz świeży fallback przy niezależnych wywołaniach.

Rozszerzona regresja pełnego generowania z P.1 potwierdza nowe dane po pozyskiwaniu i po await zapisu Spotify, brak reuse w następnym generowaniu oraz dokładnie 10 wywołań diagnostyki dla dwóch playlist po pięć utworów. Pozostałe istniejące testy chronią filtry, discovery, historię, blokady, 429, storage quota, eksport/import i D1.

Lokalnie: **290/290**, zero fail/skipped/cancelled; syntax checks obu HTML, state API, testu i benchmarku oraz git diff --check: PASS. Wyniki CI dla konkretnego HEAD podaje PR.

## Pomiar

Porównanie pełnego generowania wykorzystuje tę samą metodologię co [P.1](LASTFM_EVIDENCE_SNAPSHOT.md): pełne syntetyczne pule 2000/1800/3000, 600 starych wpisów historii, 2/4 profile, cel 60, zimny/ciepły cache, pięć próbek po warmup. Kod trzech zmienionych funkcji P.1 jest zamrożony w `tests/fixtures/p2-baseline-v43.21.json`. Losowanie i modelowy czas są ustalone; search nadal ma rzeczywisty odstęp 700 ms. Wszystkie HTTP to mocki. Benchmarki uruchamiamy kolejno, bez równoległych regresji.

| Osoby | Cache | Mediana przed → po | Spadek mediany | Maksimum / empiryczne p95 przed → po |
| --- | --- | --- | --- | --- |
| 2 | zimny | 4.129 → 4.051 s | 1.9% | 4.280 → 4.146 s |
| 2 | ciepły | 1.731 → 1.627 s | 6.0% | 1.748 → 1.671 s |
| 4 | zimny | 4.177 → 3.999 s | 4.3% | 4.262 → 4.069 s |
| 4 | ciepły | 1.855 → 1.621 s | 12.6% | 1.918 → 1.639 s |

Ścisły comparator sprawdził **20 par**: identyczne ID/kolejność, minimum indywidualne, discovery, liczby wykonawców, pełne teksty diagnostyki, liczbę i kolejność HTTP, pule oraz rozmiar payloadu chmury. Wszystkie warianty zachowują 60/60, minimum 56,04 i discovery 0 (miękkie minimum nie skraca listy). Liczba trackDiagnostic spada 120→60, loadCandidatePool o 60: cold 148→88 / 152→92 (2/4), warm 145→85 / 149→89. Pozostałe odczyty Last.fm oraz coverage pozostają bez zmian.

Surowe czasy, liczby wywołań i hash wyników: [p2-generation-performance.json](fixtures/p2-generation-performance.json). Spadek czasu całego generowania jest mniejszy niż po P.1: 6,0–12,6% warm i 1,9–4,3% cold. Przy pięciu próbkach p95 oznacza maksimum próbki; rozrzut i opóźnienia innych etapów wpływają na całkowity czas. To kontrolowany scenariusz syntetyczny z mockami, a nie pomiar live lub gwarancja poprawy na każdym komputerze. Pewny wynik strukturalny to połowa wywołań diagnostyki, bez zmiany wyników.

## Reprodukcja

```sh
OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_BASELINE=tests/fixtures/p2-baseline-v43.21.json node tests/benchmarks/generation-pipeline.mjs > /tmp/p2-before.json
OMM_BENCH_FIXED_CLOCK=1 node tests/benchmarks/generation-pipeline.mjs > /tmp/p2-after.json
node tests/benchmarks/compare-generation.mjs /tmp/p2-before.json /tmp/p2-after.json > /tmp/p2-comparison.json
npm test
```

## Ryzyko i wycofanie

Najważniejsze ryzyko to zastosowanie diagnostyki do innego utworu lub późniejszego generowania. Ograniczają je klucze obiektowe, lokalny czas życia mapy i testy. Wynik przechowywany w pamięci jest tym samym tekstem, który trafiał już wcześniej do zapisu i DOM; brak nowego trwałego stanu i migracji. Nie zwiększamy długości playlist ani nie obniżamy jakości: oczekiwany zestaw pozostaje ten sam, przy mniejszej pracy po selekcji.

Wycofać przy rozbieżności zapisanej/wyświetlanej diagnostyki, użyciu starego feedbacku lub historii, błędzie renderowania/ocen, wzroście zapytań albo zmianie wyników selekcji. Revert całego PR i nowy numer wersji nagłówka; bez kasowania danych D1, preferencji, historii i pul. Scalenie i wdrożenie wyłącznie po potwierdzeniu użytkownika.
