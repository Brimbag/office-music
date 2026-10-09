# P.3 — pozyskiwanie, postęp i niezawodność OAuth

Kandydat **v43.23.P3**, baza main `f0c5ea5` / wdrożona v43.22.P2. Draft; bez scalenia i produkcji przed zatwierdzeniem. Bez zmian schematów danych, migracji, D1, konfiguracji produkcyjnej i RMF.

## Diagnoza

Kod P.2 już wykorzystuje lokalną pulę i cache przed nowym Search, ocenia kwalifikowalne sygnatury i pomija artystę z co najmniej dwoma kwalifikowalnymi utworami. Surowa liczba jego utworów nie wystarcza. Artyści wzorcowi mają limit 3 wyszukiwań; gatunki 6 do celu 60 (7/8 przy 90/120), wspólne źródła do 3, globalnie 12/14/16. Odstęp Search to 700 ms. Priorytety wewnątrz etapu uwzględniają braki po kwalifikacji, kolejność wspierających profili i dotychczasową rotację.

Problem obliczeniowy: acquisitionCoverage ponownie buduje model i kwalifikuje całą pulę podczas tworzenia acquisition, przed reuse cache, podczas wyboru następnego zapytania oraz w końcowym podsumowaniu. Przed reuse wykonywał pełny przebieg nawet wtedy, gdy cache nie zawierał nowych ID.

W istniejącym syntetycznym pomiarze P.2 siedem wywołań coverage kosztowało łącznie około 0,8–1,0 s inclusive; cache Search 7–17 ms warm, a odstępy Search około 2,2 s cold. Nie wolno sumować zagnieżdżonych inclusive. Te pomiary nie wyjaśniają same w sobie długiego generowania live: rzeczywiste Last.fm/Spotify, 429, CPU, synchronizacja i stan karty mogą dominować. Panel dostarcza pomiarów konkretnego przebiegu.

## Bezpieczny reuse

Cache pokrycia jest polem jednego acquisition. Nie jest globalny ani zapisywany. getAcquisitionCoverage porównuje surowe wartości pul Spotify/Last.fm, historii, feedbacku, blokad feedbacku i Spotify ID, konta Last.fm, ankiety, obiektu wybranych profili, zestawów blokad oraz ustawień filtrów/discovery/rozpoznawalności/cooldownu. Zmiana dowolnej zależności wymusza pełne przeliczenie.

Wyliczony termin ważności uwzględnia najbliższe granice TTL wszystkich trzech pul, daty scrobbli (również przyszłe), okna historii utworów i wykonawców oraz retencję historii. Cofnięcie zegara również unieważnia cache. Niezmieniony wynik można współdzielić także po await, ponieważ przed użyciem ponownie sprawdzamy wartości wejściowe i granice czasu. Generator odświeża zestawy blokad na podstawie historii i profili przed sprawdzeniem cache; standalone wywołania zachowują jawnie przekazane zestawy.

Nie współdzielimy końcowego modelu selekcji ani diagnostycznych snapshotów P.1/P.2 przez await. Końcowa kwalifikacja i diagnostyka nadal tworzą ich własne świeże dane. Wybrane profile są wejściem danego generowania jak w P.2; cache nie przechodzi do nowego generowania po zmianie obecnych osób. Modyfikacja obiektu profili także zostaje wykryta.

Przed kosztownym reuse cache sprawdzamy, czy są nowe ID. Strategia, kolejność etapów, rotacja i liczby żądań pozostają bez zmian przy niezmienionym stanie. Po await obowiązują również aktualne blokady i silny feedback przy następnym wyborze zapytania, zamiast wyłącznie początkowej kopii.

## Panel postępu i pomiary

Panel buduje DOM raz. Pokazuje 11 prawdziwych etapów, ich stany (oczekuje/w toku/ukończony/błąd), bieżący czas i czas całkowity, wykorzystany budżet nowych Search, strony cache, rozmiar puli oraz ostatnio obliczoną liczbę kwalifikowalnych wykonawców i utworów. Liczniki etapowe obejmują sprawdzone zapytania i pominięcia po potwierdzeniu wystarczającego pokrycia. Nie pokazujemy procentu ani przewidywanego końca.

Szczegóły techniczne: odczyty puli, cache (trafienia/braki), obliczenia i reuse pokrycia, kwalifikacja, sieć Spotify i Last.fm, odstęp Search, oczekiwanie po 429, OAuth oraz czasy inclusive/exclusive. Pomiar synchroniczny odejmuje mierzone dzieci; async transport jest osobnym spanem, a etapy obejmują całą pracę. Inclusive i równoległych spanów nie sumujemy jako czasu całkowitego. Nie logujemy każdego utworu ani nie zapisujemy tożsamości, zapytań lub tokenów w raporcie.

Odświeżanie DOM jest ograniczone do 150 ms, poza zmianami etapów i istotnymi komunikatami. Zegar opiera się na performance.now, nie liczbie ticków. Jednosekundowy timer jedynie odświeża zegar widocznej karty; nie steruje pracą. Zdarzenia i visibilitychange odświeżają rzeczywisty stan, niezależnie od throttlingu timerów. W obsługujących przeglądarkach scheduler.yield przed kosztownymi etapami pozwala pomalować status; w tle go nie oczekujemy. Nie ma oczekiwania na requestAnimationFrame, wake locka ani sztucznego utrzymywania aktywności.

Przejście w tło nie zatrzymuje generatora, lecz zamrożenie/hibernacja karty przez przeglądarkę może wstrzymać cały JavaScript. Panel komunikuje to ograniczenie; zamknięcie/odrzucenie karty nie zapewnia wykonania w tle. Nowe uruchomienie odtwarza zapisane playlisty, bez deklarowania, że poprzednie generowanie nadal działa.

Guard blokuje równoległe generowanie. Błąd wskazuje etap i czy potwierdzono utworzenie playlisty. Jeśli create POST utraci odpowiedź, nie potwierdzamy utworzenia: należy sprawdzić Spotify przed ponowną próbą. Jeśli zapis utworów zawiedzie, utworzona playlista może być częściowa. Poprzedni lokalny wynik jest zachowywany; błąd D1 po udanym zapisie nie usuwa nowej playlisty ani widoku.

## Niezawodność OAuth — osobny zakres korzyści

Przyczyna rzeczywistego 401: generator przechwytywał access token na początku i przekazywał go również po długim odświeżaniu i oczekiwaniu na 429. Search nie odnawiał sesji po 401. refreshAccessToken kasował sesję przy dowolnym nieudanym HTTP, a init robił to również przy błędzie połączenia.

Wspólny wrapper żądań używa aktualnego ważnego tokenu z sesji, proaktywnie odświeża wygasły token, a po jawnym Spotify 401 odnawia go i ponawia tylko odrzucone żądanie raz. Search współdzieli limit jednego auth retry przez wszystkie próby 429. Retry auth także respektuje 700 ms; nie zużywa drugiej jednostki budżetu nowego wyszukiwania. Panel rozróżnia nowe wyszukiwania od żądań z retry.

Dotyczy Search, profilu używanego do porządków, odczytu/usuwania starych playlist, historii Spotify, tworzenia playlist i wszystkich porcji zapisu utworów. Retry zapisu jest dozwolone wyłącznie po jawnym 401 z API, które odrzuca uwierzytelnienie przed wykonaniem operacji. Błędy połączenia, 5xx i niejednoznaczny wynik zapisu nie są ponawiane. Generator nie startuje od początku i nie odtwarza udanych porcji. Dotychczasowy Retry-After, limit retry 429 i budżety pozostają zachowane.

Jedno odświeżenie jest współdzielone przez równoległe żądania w karcie. Web Locks serializuje rotację refresh tokenu między kartami tego samego origin; po uzyskaniu blokady odczytujemy bieżącą sesję. Na przeglądarce bez Web Locks działa single-flight w karcie, ale pełna ochrona między kartami nie jest gwarantowana: nie należy uruchamiać OMM równolegle w kilku kartach. Współczesny Chromium/Vivaldi na HTTPS obsługuje Web Locks.

Przejściowe błędy sieci, HTTP 429/5xx i nieprawidłowa odpowiedź odświeżenia zachowują sesję. Dopiero jawny invalid_grant (400/401) usuwa odrzucone dane. Kontrola sesji przed zapisem zapobiega nadpisaniu nowszej rotacji/logowania i przywróceniu sesji po wylogowaniu. Nie wypisujemy odpowiedzi OAuth ani tokenów. Raport zawiera tylko liczbę prób, sukcesów i błędów. D1 otrzymuje aktualny token; nie dodano automatycznego replay żądań D1.

OAuth zwiększa niezawodność, nie jest obiecywanym przyspieszeniem. Ważny token nie powoduje dodatkowego żądania sieciowego; odnowienie i retry po błędzie mogą wydłużyć generowanie, ale są widoczne w panelu.

## Benchmark i regresje

Podstawowy benchmark: 24 warianty × 3 mierzone próbki po rozgrzewce = **72 pary**. Porównano kod aktualnego main z P.3, przy tych samych danych, modelowym zegarze i losowaniach. Macierz: 2/4 osoby, cele 30/60/120, pule 80/2000, cache cold/warm. Last.fm pozostaje pełny (1800/3000), historia 600 starych wpisów. W wybranych wariantach 4 osób seed Good0 ma dwa kwalifikowalne utwory; pozostałe mają brakujące pokrycie. Syntetyczny katalog zawiera do 100 kwalifikowalnych utworów, więc cel 120 świadomie daje krótszy poprawny wynik.

Ścisły comparator potwierdził identyczność wszystkich 72 par: ID/kolejność, wyniki modelu, discovery i limity wykonawców, diagnostykę, pule, zapytania HTTP oraz payload chmury. Warianty z celem 60/full mają coverage 7→3 cold i 7→1 warm. Żaden zmierzony wariant nie skrócił playlisty ani nie pogorszył wyników jakości; spadek mediany w całej macierzy wyniósł 1,9–52,6%.

| Osoby | Cel | Pula | Cache | Mediana P.2 → P.3 (s) | Spadek | Coverage P.2 → P.3 | Maksimum prób P.2 → P.3 (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 30 | 80 | cold | 3.473 → 3.406 | 1.9% | 7 → 3 | 3.574 → 3.501 |
| 2 | 30 | 2000 | cold | 3.827 → 3.575 | 6.6% | 7 → 3 | 3.839 → 3.612 |
| 2 | 60 | 80 | cold | 3.599 → 3.413 | 5.2% | 7 → 3 | 3.630 → 3.420 |
| 2 | 60 | 2000 | cold | 4.043 → 3.800 | 6.0% | 7 → 3 | 4.048 → 3.825 |
| 2 | 120 | 80 | cold | 3.568 → 3.480 | 2.5% | 7 → 3 | 3.604 → 3.499 |
| 2 | 120 | 2000 | cold | 4.204 → 3.980 | 5.3% | 7 → 3 | 4.291 → 3.982 |
| 2 | 30 | 80 | warm | 0.897 → 0.425 | 52.6% | 7 → 1 | 0.903 → 0.464 |
| 2 | 30 | 2000 | warm | 1.396 → 0.720 | 48.4% | 7 → 1 | 1.494 → 0.735 |
| 2 | 60 | 80 | warm | 0.938 → 0.543 | 42.0% | 7 → 1 | 0.947 → 0.574 |
| 2 | 60 | 2000 | warm | 1.583 → 0.907 | 42.7% | 7 → 1 | 1.682 → 0.924 |
| 2 | 120 | 80 | warm | 1.024 → 0.567 | 44.6% | 7 → 1 | 1.026 → 0.608 |
| 2 | 120 | 2000 | warm | 1.691 → 1.127 | 33.3% | 7 → 1 | 1.788 → 1.154 |
| 4 | 30 | 80 | cold | 2.852 → 2.730 | 4.3% | 7 → 3 | 2.861 → 2.731 |
| 4 | 30 | 2000 | cold | 3.299 → 3.145 | 4.7% | 7 → 3 | 3.376 → 3.254 |
| 4 | 60 | 80 | cold | 3.609 → 3.391 | 6.0% | 7 → 3 | 3.672 → 3.483 |
| 4 | 60 | 2000 | cold | 4.113 → 3.820 | 7.1% | 7 → 3 | 4.142 → 3.942 |
| 4 | 120 | 80 | cold | 2.977 → 2.857 | 4.0% | 7 → 3 | 3.033 → 2.922 |
| 4 | 120 | 2000 | cold | 3.743 → 3.572 | 4.6% | 7 → 3 | 3.971 → 3.594 |
| 4 | 30 | 80 | warm | 1.044 → 0.506 | 51.5% | 8 → 1 | 1.090 → 0.513 |
| 4 | 30 | 2000 | warm | 1.616 → 0.900 | 44.3% | 8 → 1 | 1.670 → 0.936 |
| 4 | 60 | 80 | warm | 0.970 → 0.651 | 32.9% | 7 → 1 | 0.982 → 0.654 |
| 4 | 60 | 2000 | warm | 1.608 → 1.086 | 32.5% | 7 → 1 | 1.755 → 1.115 |
| 4 | 120 | 80 | warm | 1.075 → 0.642 | 40.3% | 8 → 1 | 1.083 → 0.678 |
| 4 | 120 | 2000 | warm | 1.894 → 1.250 | 34.0% | 8 → 1 | 1.913 → 1.252 |

Pełne surowe czasy oraz hashe zgodnych wyników: [p3-generation-performance.json](fixtures/p3-generation-performance.json). JSON ma zwięzły zapis, zawiera wszystkie mierzone próbki. Maksimum przy trzech próbach nie jest wiarygodnym produkcyjnym p95; podajemy je jako rozrzut prób. Wszystkie sieci to zamknięte mocki, a Search ma rzeczywiste odstępy 700 ms. Cache cold oznacza brak świeżych cache/TTL przy istniejących pulach; Last.fm mock zwraca poprawne puste dane. Nie gwarantujemy takiego zysku na produkcji. Czas obejmuje nowy panel i instrumentację; nie włączono osobnej zmiany strategii. Porównanie uruchomiono kolejno, bez równoległych testów regresji.

Dodatkowo **36 zgodnych par** (12 przypadków × 3 próby): puste nowe wyniki, twarda blokada, wygasły cache Search, zmiana wejściowych preferencji profilu podczas await, pojedynczy 429 z Retry-After 1 s oraz błąd połączenia przy Search. Łącznie **108 par**. Przypadki zmiany profilu i błędu połączenia kończą się kontrolowanym przerwaniem bez zapisu utworów, identycznie co do wyników/P.2; nie interpretujemy krótkiego czasu błędu jako poprawy generowania. 429 rzeczywiście oczekuje według dotychczasowych reguł. Pozostałe zachowują 60 utworów.

| Osoby | Przypadek | Długość P.2/P.3 | Mediana P.2 → P.3 (s) | Coverage P.2 → P.3 | Maksimum P.2 → P.3 (s) |
| --- | --- | --- | --- | --- | --- |
| 2 | no-results | 60 | 4.003 → 3.732 | 7 → 1 | 4.036 → 3.818 |
| 2 | blocked | 60 | 4.134 → 3.768 | 7 → 3 | 4.135 → 3.781 |
| 2 | expired-cache | 60 | 4.007 → 3.774 | 7 → 3 | 4.039 → 3.799 |
| 2 | changed-profiles | 0 | 3.324 → 3.215 | 6 → 4 | 3.326 → 3.243 |
| 2 | 429 | 60 | 5.287 → 5.060 | 7 → 3 | 5.366 → 5.068 |
| 2 | network | 0 | 0.399 → 0.294 | 2 → 1 | 0.416 → 0.295 |
| 4 | no-results | 60 | 4.037 → 3.873 | 7 → 1 | 4.045 → 3.915 |
| 4 | blocked | 60 | 3.985 → 3.857 | 7 → 3 | 4.056 → 3.880 |
| 4 | expired-cache | 60 | 4.045 → 3.791 | 7 → 3 | 4.099 → 3.872 |
| 4 | changed-profiles | 0 | 3.313 → 3.196 | 6 → 4 | 3.322 → 3.289 |
| 4 | 429 | 60 | 5.268 → 5.053 | 7 → 3 | 5.271 → 5.072 |
| 4 | network | 0 | 0.391 → 0.319 | 2 → 1 | 0.411 → 0.329 |

Pełne wyniki: [p3-generation-edge-performance.json](fixtures/p3-generation-edge-performance.json). Normalna ścieżka nie zwiększa liczby HTTP, nawet po dodaniu panelu i OAuth. Wygaśnięcie/401 sprawdzamy osobnymi testami kontrolowanego transportu, nie jako przyspieszenie.

Lokalne pełne regresje: **315/315**, zero fail/skipped/cancelled. Nowe testy obejmują 2/4 profile, parytet selekcji, pokrycie/rotację i reuse cache, wszystkie zależności i granice TTL/scrobbli/zegara, rzeczywisty nowy feedback i historię, uszkodzone rekordy, panel/liczniki, tło, podwójny start, zachowanie poprzedniego wyniku i błąd D1. OAuth: 401, ważny token bez dodatkowego HTTP, wygaśnięcie podczas Retry-After i przed oboma zapisami, brak replay niepewnych zapisów, invalid_grant, sieć/503, dwa równoległe żądania, dwie karty, rotacja, wylogowanie w trakcie oraz drugie 401. Syntax obu HTML, modułu postępu, API stanu, testów i benchmarków oraz git diff --check: PASS. Wyniki CI konkretnego HEAD zapisuje PR.

Audyt potwierdził niezmienione funkcje scoringu, kwalifikacji i selekcji, feedbacku, wariantów, Last.fm evidence, P.1/P.2, limity i trzy funkcje primingu. Jedyna korekta decyzji podczas pozyskiwania dotyczy aktualnych twardych blokad/feedbacku po await; nie tworzy nowej strategii ani budżetu.

Reprodukcja (bez równoległego npm test):

```sh
OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_MATRIX=1 OMM_BENCH_REPETITIONS=3 OMM_BENCH_BASELINE=tests/fixtures/p3-baseline-v43.22.json node tests/benchmarks/generation-pipeline.mjs > /tmp/p3-before.json
OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_MATRIX=1 OMM_BENCH_REPETITIONS=3 node tests/benchmarks/generation-pipeline.mjs > /tmp/p3-after.json
node tests/benchmarks/compare-generation.mjs /tmp/p3-before.json /tmp/p3-after.json
OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_EDGES=1 OMM_BENCH_REPETITIONS=3 OMM_BENCH_BASELINE=tests/fixtures/p3-baseline-v43.22.json node tests/benchmarks/generation-pipeline.mjs > /tmp/p3-edge-before.json
OMM_BENCH_FIXED_CLOCK=1 OMM_BENCH_EDGES=1 OMM_BENCH_REPETITIONS=3 node tests/benchmarks/generation-pipeline.mjs > /tmp/p3-edge-after.json
node tests/benchmarks/compare-generation.mjs /tmp/p3-edge-before.json /tmp/p3-edge-after.json
npm test
```

Baseline podmienia zamrożone funkcje zmienione w PR, a nie cały checkout. Nie zmienia się źródło algorytmu. Domyślny benchmark CI zachowuje cztery warianty 2/4 i cold/warm przy celu 60/full, jedną próbkę smoke bez progu czasu; rozbudowana macierz jest osobnym kontrolowanym pomiarem.

## Strategia wyszukiwania

Nie zmieniono kolejności seed → genre → common ani priorytetów rotacji. Odsetek czasu CPU i dominujący koszt oczekiwania różnią się w scenariuszach; sam porządek etapów nie daje dowodu poprawy jakości. Osobny proponowany PR może porównać przeznaczenie części budżetu na największy deficyt kwalifikowalnych wykonawców dla osób najsłabiej reprezentowanych. Warunki: te same 12/14/16, minimum 35, discovery i maksimum dwóch utworów wykonawcy; większa różnorodność bez istotnego skracania i pogorszenia ocen. Nie wdrażamy tej strategii w P.3.

## Ryzyko i rollback

Główne ryzyka: brak zależności w invalidacji, błędne powiązanie czasów lub liczników, przejęcie blokady OAuth oraz niejednoznaczny wynik zapisu Spotify. Testy chronią granice czasu, świeży feedback/historię, konta, zmiany profili, różne długości/cache/pule, retry i rotację.

Wycofać przy stale coverage, rozbieżności wyników tego samego stanu, pominięciu blokad, duplikatach po retry, utracie sesji przy przejściowym błędzie, wzroście normalnych API, istotnym pogorszeniu czasu albo zawieszeniu/nieprawdziwym statusie. Revert całego PR oraz nowa wersja nagłówka; bez czyszczenia D1, preferencji, historii, pul i tokenów.
