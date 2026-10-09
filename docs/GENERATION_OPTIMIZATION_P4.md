# P4 — koszt generowania i izolowany eksperyment A/B/C

Kandydat v43.24.P4, baza main `6fec793` / v43.23.P3. Osobny Draft PR. Bez scalenia i wdrożenia produkcyjnego przed zgodą. Bez zmian D1, danych produkcyjnych, budżetów, progów, feedbacku, discovery, RMF ani filtra wersji. „En Directo” pozostaje osobnym zakresem E.2.

## Diagnoza z rzeczywistego raportu P3

Przebieg dla dwóch osób: 510,1 s, 47/60 utworów, średnie 73/73, discovery 16/47. Etapy: Last.fm 41,4 s, artyści wzorcowi 102,1 s, gatunki 189,8 s, wspólne 166,8 s. 14 kwalifikacji zajęło 158,2 s; coverage 112,4 s inclusive jest częścią kwalifikacji, nie dodatkowym kosztem. Spotify 5,7 s i Last.fm 7,1 s obejmują zmierzone fetch, nie cały etap. 119 stron cache nie dodało kandydata; 12 Search zwiększyło kwalifikowalnych wykonawców 54→56. Raport nie dowodzi, że pozostały czas to CPU, sieć lub uśpienie. Zero prób OAuth nie sprawdza odnowienia tokenu.

W kodzie acquisitionContext tworzył częściowy snapshot bez artistByName. lastFmEvidenceForTrack wykonywał liniowe find z normalizacją nazw dla każdego utworu, również przy kolejnym coverage. P1 indeksował końcowy etap, lecz ten koszt pozostawał w pozyskiwaniu. Drugie takie miejsce: retencja przepełnionej puli Spotify.

## Zmiana aplikacji

- acquisitionContext tworzy świeży createLastFmEvidenceSnapshot i przekazuje go do niezmienionego modelu. Wyszukiwanie po nazwie korzysta z Map, bez dzielenia snapshotu przez await lub kolejne generowanie. Pierwszy duplikat jest dowodem rozpoznawalności/wersji, ostatni duplikat nadal jest rekordem tagów modelu.
- Retencja dodaje indeks istniejącej deduplikowanej listy artystów: ctx.artistPool. Zachowuje jej wcześniejszą semantykę ostatniego rekordu, ranking, reprezentację nieobecnych profili, TTL i limit.
- Retencja Last.fm normalizuje preferencje i nazwy seedów raz na profil, w obrębie pojedynczego synchronicznego przebiegu. Dotychczas robiła to ponownie dla każdego rekordu. Bez współdzielenia przez await ani pomiędzy przebiegami; nie zmienia listy chronionych osób ani kryteriów.
- Nie zmieniamy selekcji, priorytetów zapytań, rotacji, punktacji seedów/dawnych stylów ani liczby dopuszczalnych Search. Eksperyment B/C nie jest ładowany przez index.html ani taste.html.

## Pomiary P4

Oprócz poprzednich metryk mierzymy indeks Last.fm, model pozyskiwania, budowę modelu, retencję Spotify/Last.fm, zapis puli, kwalifikację nowych pozycji cache, blokady historii, dobór wykonawców dla tagów, podsumowanie historii, selekcję, kolejność odsłuchu, dopasowanie puli do zapytań, aktualizacje rekordów Last.fm oraz budowę wspólnych zapytań.

Bilans czasu działa jako rozłączny zegar stanów: mierzone synchroniczne operacje mają pierwszeństwo; poza nimi otwarty zmierzony await jest oczekiwaniem; reszta trafia do „pozostałego czasu”. Nakładające się oczekiwania są liczone raz, a synchroniczny kod wykonany podczas oczekiwania trafia do pierwszej kategorii. Takie same kategorie są dostępne dla każdego etapu. Nie odejmujemy sumy inclusive ani sumy async spanów od czasu całkowitego.

Czas karty w tle jest nakładką na bilans, nie czwartą kategorią do sumowania. Zdarzenia visibilitychange zamykają bieżący odcinek, a istniejący jednosekundowy timer podaje największą zaobserwowaną lukę. Brak dodatkowego pollingu API, timera sterującego pracą, wake locka czy gwarancji działania po hibernacji. Czas synchroniczny jest czasem ściennym; luka timera może wynikać z CPU, throttlingu lub uśpienia, nie dowodzi przyczyny. Raport pozostaje w pamięci, bez tożsamości i sekretów; nie powstaje nowy klucz synchronizacji.

## Eksperyment A/B/C — wyłącznie sandbox

Potwierdzona decyzja użytkownika:

| Wariant | Aktywne źródła | Punktacja obecnych osób |
| --- | --- | --- |
| A | Obecny seed → genre → common, obecne limity | Obecna ankieta, manual styles i seedy |
| B | Ankieta i Last.fm/Spotify; bez aktywnego odświeżania seedów i ręcznych dawnych stylów | Bez manual styles i seedów |
| C | Jak B | Bez manual styles; seedy pozostają w punktacji |

„Dawne style” to profile.manualGenres z ręcznych pól office_genres_*. Nie usuwamy gatunku, który niezależnie wynika z ankiety, ani istniejących dowodów/tagów z puli. Wyłączamy cały ręczny etap odświeżania seedów i nowe zapytania nazwowe dla tych samych seedów w innych etapach. Istniejąca pula pozostaje dostępna. Niewykorzystane trzy sloty ręcznego etapu nie są automatycznie przenoszone do innych etapów. W eksperymencie retencja obecnych osób widzi tę samą politykę B/C, a zapisane preferencje nieobecnych osób nadal są chronione. Wszystko odbywa się w jednorazowym kontekście przeglądarki.

Każdy wariant ma ten sam pierwotny stan, katalog odpowiedzi, zegar modelu, RNG, puste mockowane odpowiedzi Last.fm i odstęp Search 700 ms. Każdy request dozwolony jest tylko w zamkniętym mock transporcie. Warm cache jest wspólną sumą stron potrzebnych A/B/C, z identycznym TTL; nie tworzymy oddzielnego „łatwiejszego” cache dla B. SHA-256 wejść i cache musi zgadzać się przed każdym odpowiadającym przebiegiem. Startujemy każdy wariant od nowego kontekstu, nie od bazy zmodyfikowanej przez A.

Mierzymy czas, długość, discovery, różnych Spotify Artist ID (fallback po nazwie tylko przy braku ID), dopasowanie i minimum każdej osoby. Oprócz własnych ocen B/C pokazujemy ocenę ich playlist przez profil/model referencyjny A, aby usunięcie preferencji nie udawało poprawy jakości. Porównanie referencyjne używa oryginalnych preferencji A oraz dowodów dostępnych w końcowej puli danego wariantu.

Utwór „znany z historii” to ID lub sygnatura pasująca do zachowanego rzeczywistego odtworzenia Spotify/Last.fm, z poprawną datą nie późniejszą niż zegar modelu. Nie wystarcza wpis w tag.getTopTracks, sam wykonawca w historii, wygenerowany snapshot ani etykieta modelowego non-discovery. Mierzymy wyłącznie zachowaną historię; brak wpisu nie dowodzi, że użytkownik nigdy utworu nie słyszał.

Dane są jawnie syntetyczne: 2000 Spotify / 1777 Last.fm artists / 2628 Last.fm tracks / 657 historii, 400 zwykłych kandydatów i pozostałe wersje Rework, dwa/cztery rozbudowane profile. Nie są eksportem bazy użytkownika ani odtworzeniem playlisty 47/60. Wklejony wynik nie zawiera pełnej ankiety, rekordów, feedbacku i cache. Ocena na rzeczywistych danych wymaga lokalnego eksportu bez OAuth i zamrożonych odpowiedzi; bez dodatkowego zatwierdzenia B/C nie przechodzą do produkcji.

## Wyniki

### A/B/C — trzy próbki po warmup, dane syntetyczne

| Osoby/cache | Wariant | Mediana s | Search | Długość | Discovery | Różni artyści | Utwory z historii | Średnie Bartek/Asia wg A |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2/cold | A | 12.09 | 11 | 60 | 17/60 | 32 | 22/60 | 93.6/95.0 |
| 2/cold | B | 10.88 | 9 | 60 | 18/60 | 31 | 22/60 | 94.0/95.0 |
| 2/cold | C | 11.21 | 9 | 60 | 17/60 | 31 | 22/60 | 93.6/95.0 |
| 2/warm | A | 4.74 | 0 | 60 | 19/60 | 32 | 23/60 | 93.2/94.5 |
| 2/warm | B | 4.95 | 0 | 60 | 20/60 | 31 | 22/60 | 93.6/95.0 |
| 2/warm | C | 4.59 | 0 | 60 | 20/60 | 31 | 22/60 | 93.6/95.0 |
| 4/cold | A | 14.87 | 11 | 60 | 16/60 | 32 | 23/60 | 93.2/94.5 |
| 4/cold | B | 13.58 | 9 | 60 | 17/60 | 32 | 22/60 | 93.6/95.0 |
| 4/cold | C | 13.49 | 9 | 60 | 17/60 | 32 | 22/60 | 93.6/95.0 |
| 4/warm | A | 6.60 | 0 | 60 | 18/60 | 30 | 24/60 | 92.7/94.1 |
| 4/warm | B | 6.23 | 0 | 60 | 20/60 | 31 | 22/60 | 93.6/95.0 |
| 4/warm | C | 6.41 | 0 | 60 | 20/60 | 31 | 22/60 | 93.6/95.0 |

Wszystkie 36 mierzonych przebiegów A/B/C mają 60/60, minimum każdego profilu ≥35, poprawną końcową quota i limit dwóch utworów. Własne oraz referencyjne oceny wszystkich czterech profili, minima, surowe próbki i wspólne SHA-256 są w [p4-generation-variants.json](fixtures/p4-generation-variants.json). Każdy z 12 scenariuszy ma powtarzalne ID/kolejność/oceny we wszystkich trzech próbkach.

W tej fiksturze B/C oszczędzają dwa Search w cold, ale nie dają jednoznacznej przewagi różnorodności ani udziału historii. Warm B dla dwóch osób był wolniejszy od A; nie wybieramy zwycięzcy na podstawie jednego wymiaru. Wynik nie uzasadnia wyłączenia seedów/dawnych stylów na produkcji. Ocenę na rzeczywistej bazie należy wykonać osobno.

### P3 → P4 — trzy próbki po warmup

| Osoby/cache | Mediana P3 | Mediana P4 | Skrócenie |
| --- | ---: | ---: | ---: |
| 2/cold | 25,693 s | 11,297 s | 56,0% |
| 2/warm | 5,254 s | 4,521 s | 13,9% |
| 4/cold | 29,247 s | 12,971 s | 55,6% |
| 4/warm | 6,827 s | 6,491 s | 4,9% |

Wszystkie 12 par zachowało dokładnie te same ID i kolejność 60 utworów, oceny, diagnostykę selekcji, pule i żądania API. Wyniki i bilans etapów: [p4-generation-performance.json](fixtures/p4-generation-performance.json). Po rozszerzeniu pomiarów pozostały czas spadł w fiksturze do około 138–152 ms. Dopasowanie puli do zapytań pozostaje istotnym kosztem: około 2,3–4,2 s. P4 go mierzy, ale nie zmienia tej funkcji.

### Retencja Last.fm — trzy próbki, identyczne rekordy i kolejność

| Osoby/pula | Mediana P3 | Mediana P4 |
| --- | ---: | ---: |
| 2/wykonawcy | 901 ms | 67 ms |
| 2/utwory | 1481 ms | 121 ms |
| 4/wykonawcy | 1696 ms | 47 ms |
| 4/utwory | 2639 ms | 73 ms |

Pełne wyniki: [p4-lastfm-retention-performance.json](fixtures/p4-lastfm-retention-performance.json). Osobny stres przepełnienia puli Spotify nowymi wynikami Search zachował pełną zgodność, 60/60 i 11 Search: 94,990 → 12,015 s. To pojedyncza próbka po warmup, celowo kosztowny przypadek, a nie prognoza czasu live: [p4-generation-fresh-performance.json](fixtures/p4-generation-fresh-performance.json).

Pełny zestaw lokalny: **331/331 testów**. Końcowy smoke A/B/C dla dwóch osób z warm cache zachował wyniki zmierzonych wariantów. Testy obejmują świeżość snapshotów, duplikaty, retencję dla dwóch/czterech osób, granice pomiarów i izolację eksperymentu. CI jest wymagane przed propozycją scalenia.

## Reprodukcja

```bash
OMM_BENCH_REALISTIC=1 OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_REPETITIONS=3 OMM_BENCH_BASELINE=tests/fixtures/p4-baseline-v43.23.json node tests/benchmarks/generation-pipeline.mjs > /tmp/p4-before.json
OMM_BENCH_REALISTIC=1 OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_REPETITIONS=3 node tests/benchmarks/generation-pipeline.mjs > /tmp/p4-after.json
node tests/benchmarks/compare-generation.mjs /tmp/p4-before.json /tmp/p4-after.json
OMM_BENCH_VARIANTS=1 OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_REPETITIONS=3 node tests/benchmarks/generation-pipeline.mjs > /tmp/p4-variants.json
node tests/benchmarks/lastfm-retention-p4.mjs > /tmp/p4-lastfm-retention.json
npm test
```

Baseline zawiera zamrożone zmienione funkcje i moduł postępu P3 z commita 6fec793. Małe próbki nie dają wiarygodnego produkcyjnego p95. Rzeczywisty przebieg w przeglądarce użytkownika pozostaje konieczny po ewentualnym wdrożeniu.

## Ryzyko i wycofanie

Ryzyko: niezgodna semantyka duplikatów, snapshot po granicy czasu/konta lub narzut pomiarów. Testy porównują pełne wyniki i retencję, duplikaty, nowe konto, zagnieżdżenie pomiarów, równoległe await i tło. Istniejące regresje chronią min35, discovery, feedback, współwykonawców, quota storage, OAuth i D1.

Rollback: revert całego PR i nowa wersja nagłówka; bez kasowania lub migracji preferencji, historii, pul, OAuth i D1. Wycofać przy różnicy wyników dla tego samego stanu, pominięciu blokady, większym normalnym API, utracie danych albo istotnym regresie czasu/runtime. Eksperyment sam niczego nie wdraża i nie potrzebuje migracji/rollbacku danych.
