# Q1.1 — audyt długości, 1.0.1-rc

Wydanie audytowe: produkcyjna selekcja, wyniki, kolejność, progi, feedback, discovery, limity pul i API pozostają identyczne. HTML aplikacji względem bazy różni się wyłącznie nazwą wersji. Numeracja następnych wydań: 1.0.2-rc, 1.0.3-rc itd.; walidator logów zachowuje zgodność z v43.* i v1.0.0-rc.1. Brak migracji D1.

## Narzędzie i pomiary

`tests/benchmarks/generation-pipeline.mjs` z `OMM_Q1_AUDIT=1` uruchamia prawdziwy generator w izolowanym Chromium z zamkniętym, kontrolowanym transportem. Nie kontaktuje się z produkcyjnym Spotify, Last.fm ani D1. Funkcje w tests/helpers/q1-audit.mjs są obserwatorami, nie częścią aplikacji.

Raport rozdziela pierwszą przyczynę odrzucenia każdego rekordu (filtry) od wielokrotnych sprawdzeń podczas selekcji (selectionCounters). Liczy kwalifikowalnych/bezpiecznych kandydatów znanych i discovery, różnych wykonawców, oceny osób, faktycznie znane utwory z historii Spotify/Last.fm, korektę discovery i pozostałych kandydatów. „Non-discovery” nie oznacza automatycznie rzeczywistego odsłuchu.

Pozostałe rekordy dzielone są na niebezpieczne, duplikaty, limit wykonawcy, quota discovery i potencjalne uzupełnienia. To test koniecznych warunków, nie dowód optymalnego zestawu ani zezwolenie na pominięcie dynamicznej punktacji. Każdy rekord trafia do jednej pierwszej kategorii. Czasy pochodzą z istniejącego benchmarku etapów; dodatkowy obserwator ma własny koszt, a próba jednego pomiaru nie stanowi wiarygodnej statystyki p95 produkcji.

Górne granice są optymistyczne: liczba bezpiecznych rekordów, 2 × liczba ich wykonawców i floor(known / 0.65) dla celu 30%. Nie uwzględniają wszystkich konfliktów duplikatów, współwykonawców ani dynamicznego wyboru. Ustawienia 0/100 zachowują znaczenie; dolne 25% nie skraca zestawu. Raport sygnalizuje naruszenia minimum 35, quota lub limitu artysty.

## Wynik kontrolowany i ograniczenia

Nie otrzymaliśmy pełnego eksportu produkcyjnego stanu. Dawne logi 35/60 i 36/60 nie umożliwiają odtworzenia wszystkich kandydatów, preferencji i ustawień sesji. **Wyniki poniżej są syntetyczne, nie diagnozują przyczyny tamtych generowań.**

Dojrzała pula fixture P4: Spotify 2000, Last.fm 1777 wykonawców / 2628 utworów, 657 wpisów historii. Ankiety kontrolowane, nie rzeczywiste preferencje użytkownika. Zimny/ciepły cache to osobna oś, nie wiek bazy. Każdy przypadek: stały zegar i losowanie, cel 60, discovery 30%, jedno rozgrzanie i jeden mierzony przebieg.

| Profile | Cache zimny | Cache ciepły | Bezpieczni znani / discovery |
| --- | --- | --- | --- |
| Bartek, Asia | 60/60, 11 nowych Search | 60/60, 0 Search | 84 / 250 |
| Bartek, Asia, Edyta | 60/60, 11 nowych Search | 60/60, 0 Search | 84 / 250 |
| Bartek, Asia, Edyta, Monika | 60/60, 11 nowych Search | 60/60, 0 Search | 84 / 250 |

Końcowa korekta nie usuwała utworów. Szczegóły, oceny i czasy: [q1-length-audit.json](fixtures/q1-length-audit.json). Porównanie trzech profili z audytem włączonym/wyłączonym potwierdza identyczne ID, wyniki selekcji, diagnostykę, liczbę Search i końcowe pule.

Dodatkowy zimny start: wyzerowane pule Spotify/Last.fm i historia, pozostawione ankiety, zimny cache. Mock Last.fm zwraca puste odpowiedzi, Spotify ograniczony katalog fixture. Nie powstaje bezpieczna playlista; dostępne odkrycia nie wystarczają do zachowania twardej quota bez znanych utworów. To kontrolowany scenariusz braku danych, nie prognoza zachowania realnych usług po pierwszym logowaniu.

Eksport przetestowano na **syntetycznej kopii**, również z kontem innym niż mock-owner i włączonym S2. Potwierdza mechanikę odtwarzania, nie wynik produkcyjnego konta.

## Ponowny odczyt historycznych raportów użytkownika (v43.24.P4)

Raporty tekstowe dostarczone wcześniej w rozmowie zostały ponownie sprawdzone. Nie zawierają pełnego stanu i nie są kontrolowanym porównaniem tego samego wejścia.

| Profile | Kandydaci po filtrach | Przed / po korekcie | Znane w wyniku | Pozostałe: limit artysty / quota |
| --- | --- | --- | --- | --- |
| Bartek, Asia | 55 | 42 (19 discovery) → 35 (12 discovery), −7 | 23 | 12 / 8 |
| Bartek, Edyta, Asia, Monika | 71 | 45 (21 discovery) → 36 (12 discovery), −9 | 24 | 18 / 11 |

Pozostałe rekordy nieblokowane limitem artysty były według raportu blokowane quota bieżącej długości; nie ma dowodu na prostą możliwość dopisania kolejnych znanych. Nie wyklucza to lepszych kombinacji/wymian, bo nie znamy wszystkich rekordów i powiązań wykonawców.

Dla 60 utworów przy max 35% potrzeba co najmniej 39 znanych. W porównaniu z wybranymi 23/24 brakuje odpowiednio 16/15 znanych w docelowym zestawie, przy zachowaniu wszystkich twardych warunków. Jest to warunek konieczny, nie liczba udowodnionych braków w całej bazie.

Filtr rozpoznawalności odrzucił 943/880 rekordów, minimum osoby 161/222, historia utworu 369/367, cooldown wykonawcy 141/128, warianty 303/294. Reguły mają kolejność, więc wartości nie są niezależnymi przyczynami dla każdego utworu. Search wykorzystano 10/12 oraz 12/12: sam większy budżet nie jest uzasadnioną odpowiedzią. Średnie końcowe: 2 osoby 70/70; 4 osoby Bartek 76, Edyta 68, Asia 74, Monika 75, wszyscy bez wyników <35.

Hipoteza priorytetowa: dostępność znanych wykonawców/utworów po filtrach oraz nasycenie limitu artysty. Najpierw odtworzyć tę hipotezę na pełnej bazie; nie luzować rozpoznawalności, cooldownów ani minimum 35 na podstawie samych liczników.

## Odtworzenie eksportu offline

```
OMM_Q1_AUDIT=1 OMM_Q1_EXPORT=/tmp/omm-export.json OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_REPETITIONS=1 OMM_BENCH_PEOPLE=3 OMM_BENCH_CACHE=cold node tests/benchmarks/generation-pipeline.mjs > /tmp/q1-private-report.json
```

Dla dojrzałej fixture zamiast OMM_Q1_EXPORT: OMM_BENCH_REALISTIC=1. Dla zimnego startu: dodatkowo OMM_Q1_EMPTY_POOL=1 i cache=cold. Liczba osób: 2, 3 lub 4; domyślne grupy jak w tabeli. Zegar opiera się na exportedAt. Nie importujemy tokenów; autoryzacja i odpowiedzi API są symulowane. Przed odtworzeniem właściwego przypadku potwierdzić skład osób i ustawienia sesji (np. blokada historii), których eksport może nie zawierać. To replay przy kontrolowanych odpowiedziach, nie symulacja całego aktualnego katalogu Spotify. Eksport oraz prywatny raport pozostają poza repozytorium.

## Kolejny etap i rollback

Najpierw odtworzyć krótki wynik na prawdziwym eksporcie, z tymi samymi osobami, ustawieniami i kontrolowanymi odpowiedziami. Dopiero wtedy Q1.2:
1. Jeśli zostają bezpieczne znane utwory: osobny PR naprawiający ich wykorzystanie lub wymiany discovery.
2. Jeśli ich brakuje: osobny PR ukierunkowujący istniejący budżet pozyskiwania. Nie łączyć obu zakresów.

Kryteria: więcej utworów na odtworzonych przypadkach, brak naruszeń twardych warunków, porównanie średnich/minimów osób, diversity, historii i czasu. Brak potwierdzonego błędu oznacza brak strojenia na podstawie samej fixture.

Rollback: revert PR. Brak zmian danych. Po zapisaniu nowych logów zachować obsługę formatu 1.0.x-rc w walidatorze, aby starszy kod nie odrzucał tych wpisów; dane pozostają zachowane. Audyt nie zwiększa czasu produkcyjnego generatora, bo nie jest do niego dołączony.
