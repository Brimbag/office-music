# Audyt limitów i rotacji pul — uzupełnienie PR D

**Stan po wdrożeniu D.1/D.2:** poniżej zachowano historyczną diagnozę sprzed tych poprawek. Obie naprawy są już na main `e7a7b21`; testy charakteryzujące zastąpiono oczekiwaniami poprawnego zachowania. #13 jest ponownie weryfikowany na tej bazie. Aktualne polityki: [D.1](LASTFM_RECENT_WINDOW.md), [D.2](POOL_RETENTION.md).

Audyt kodu v43.12.F3 (`9169cf2`) oraz proponowanego v43.13.D (`9bd51a8`). Pomiary dotyczą kontrolowanych danych w Chromium, nie produkcyjnych baz. Nie zmieniono limitów, aplikacji ani danych produkcyjnych w ramach tego uzupełnienia. PR #13 pozostaje do zatwierdzenia; poniższe naprawy nie są zaimplementowane.

## 1. Bilans rekordów

Same liczniki 2000/2000, 1800/1800 i 3000/3000 nie pozwalają ustalić liczby dodanych i usuniętych rekordów podczas rzeczywistej generacji. Brakuje eksportu stanu przed/po oraz dziennika zapisów. Nie podajemy takich liczb jako pomiaru live.

Testy wywołują rzeczywiste funkcje zapisu każdej pełnej puli, oferując jedną aktualizację i dziesięć nowych rekordów:

| Pula | Limit | Dodane | Aktualizowane | Usunięte | Odrzucone nowe |
|---|---:|---:|---:|---:|---:|
| Spotify | 2000 | 10 | 1 | 10 | 0 |
| Last.fm wykonawcy, stare liczniki 0 | 1800 | 10 | 1 | 10 | 0 |
| Last.fm utwory | 3000 | 10 | 1 | 10 | 0 |

To jedna operacja zapisu, nie typowa liczba na generację. Osobny test pełnej puli wykonawców Last.fm ze starym `recentCount=10` daje **0 przyjętych z 20 nowych**, mimo świeżych wyników tagowych.

Helper `tests/helpers/pool-audit.mjs` rozróżnia rekordy oferowane, nowe przyjęte, stare aktualizowane, faktycznie zmienione, usunięte i nowe odrzucone. Docelowa diagnostyka powinna mierzyć każdy zapis i bilans końcowy oddzielnie: rekord dodany i usunięty w tej samej generacji znika z bilansu netto. Powinna także rozdzielać przyczyny usunięć: TTL, nadmiar ponad limit i walidację. Błąd quota musi być liczony względem faktycznie zachowanego stanu, nie planowanego zapisu. Diagnostyka może pozostać lokalna; nie wymaga telemetrii ani zmian D1.

## 2. Retencja i rotacja

| Pula | Tożsamość i TTL | Obecna retencja | Ryzyko |
|---|---|---|---|
| Spotify | ID utworu, 30 dni | Najnowsze `savedAt`, limit 2000; cloud merge również według świeżości | Odrzucane warianty mogą wypierać kwalifikowalne nagrania; kolejne odczyty cache odświeżają wiek |
| Last.fm wykonawcy | Znormalizowana nazwa, 45 dni | `recentCount` malejąco, potem świeżość, limit 1800 | Historyczne liczniki blokują nowe nazwiska; homonimy pozostają wspólną nazwą |
| Last.fm utwory | Znormalizowana nazwa i sygnatura tytułu, 45 dni | Świeżość, limit 3000 | Napływ wielu nagrań jednego wykonawcy wypiera różnorodność; brak ochrony jakości i mniejszościowych gatunków |

PR D chroni kwalifikowalne rekordy podczas ponownego użycia cache. **Nie chroni ich przy zapisie świeżych odpowiedzi Spotify ani cloud merge.** Test świeżego zapisu usuwa jedyny kwalifikowalny utwór na rzecz odrzucanego Rework: liczba kwalifikowalnych wykonawców spada 1 → 0. Test merge potwierdza wypieranie najstarszego rekordu. TTL usuwa rekordy logicznie podczas odczytu; fizycznie dopiero przy kolejnym zapisie.

Tagi Last.fm rotują po całej kolejce. Budżet tagów 24/28/32 obejmuje zwykle parę zapytań artists/tracks; wyniki cache też zużywają licznik tego etapu. Pobierane są pierwsze strony: do 40 wykonawców i 50 utworów na tag. Niepełny sukces może odświeżyć termin synchronizacji bez pełnego odświeżenia wszystkich źródeł.

`lastFmArtistsForTags` losuje tylko z pierwszych `3 × limit` wykonawców uporządkowanych według licznika i świeżości. Przy limicie 18 oznacza to 54 z 1800. Powtarzanie nie daje szansy pozostałym. Utwory losowane z całej pasującej puli nadal nadreprezentują wykonawców z licznymi rekordami. Planowanie według małej użytecznej pojemności w D nie zastępuje pełnej rotacji i pamięci nieskutecznych zapytań.

Prototyp **wyłącznie testowy**, bez importu przez aplikację, zachowuje wartościowy rekord oraz najpierw jedno nagranie na wykonawcę. Przy napływie 20 utworów jednego nowego wykonawcy:

| Limit | Różni wykonawcy: świeżość | Prototyp | Utrata wartościowego rekordu: świeżość / prototyp |
|---|---:|---:|---:|
| 2000 | 1981 | 2000 | 1 / 0 |
| 3000 | 2981 | 3000 | 1 / 0 |

Zysk 19 dotyczy skonstruowanego scenariusza. Nie dowodzi poprawy live ani bezpieczeństwa retencji dla nieobecnych profili. Docelowa polityka musi chronić pokrycie wszystkich profili/gatunków i uwzględnić współwykonawców oraz nierozstrzygnięte homonimy. Limit dwóch utworów na wykonawcę dotyczy playlisty; nie należy bez analizy narzucać takiego samego twardego limitu całej bazie kandydatów.

## 3. `recentCount` nie jest aktualnym oknem historii

`addLastFmArtists` używa `Math.max(stary, nowy)`: licznik nie maleje. Synchronizacja nie zeruje nieobserwowanych wykonawców. Odświeżenie tagów odnawia `savedAt`, zachowując stary licznik. Test potwierdza zarówno zachowanie 20 mimo jednego nowego odsłuchu, jak i odnowienie starego 99 przez wynik tagowy.

Odczyt historii jest ograniczony do trzech stron po 200 wpisów, a do puli aktualizowane jest tylko 40 najczęstszych wykonawców. Brakuje jawnego znacznika kompletności, właściciela, czasu i zakresu obserwacji. Zmiana użytkownika Last.fm nie izoluje istniejących liczników. Lokalna historia też jest ograniczona i przy quota może zostać skrócona: nie stanowi automatycznie kompletnego okna 14 dni.

Licznik wpływa również na rozpoznawalność, discovery i punktację. Naprawa wymaga osobnego PR oraz porównań playlist, mimo zachowania progów. Nie wolno zerować nieobserwowanych wykonawców po częściowej synchronizacji ani traktować odnowienia tagów jako odnowienia historii.

## 4. Skutki zwiększenia limitów

Symulacja krótkich nazw ASCII, jednego dowodu katalogowego na utwór Last.fm i ograniczonych metadanych; rzeczywiste rekordy mogą być większe. Rozmiar żądania obejmuje tylko pulę Spotify, **nie pozostały stan**.

| Mnożnik, tylko symulacja | Szacunek UTF-16 trzech pul + shadow | JSON żądania Spotify, UTF-8 | Kodowana wartość Spotify, UTF-8 |
|---|---:|---:|---:|
| 1× | 2,65 MiB | 0,56 MiB | 0,56 MiB |
| 1,5× | 3,99 MiB | 0,84 MiB | 0,84 MiB |
| 2× | 5,33 MiB | 1,12 MiB | 1,12 MiB |

Szacunek localStorage nie jest przenośną gwarancją quota. Należy doliczyć historię, cache, preferencje, diagnostykę i pozostałe klucze; eksport/import zwiększa także chwilowe zużycie pamięci. Shadow **nie duplikuje puli Spotify**. Pule Last.fm nie należą do `cloudStateKeys`, więc ich powiększenie obecnie nie zwiększa bezpośrednio ruchu D1; zwiększa lokalne przechowywanie, eksport i obliczenia.

API D1 ogranicza liczbę kluczy do 32, kodowaną wartość do 1,5 MiB oraz całe żądanie do 2 MiB. Liczyć należy rzeczywisty UTF-8 po JSON, w tym escape znaków. CAS blokad wykonawców dodaje `artistExclusionsBase` obok nowego dziennika: obie kopie zużywają budżet żądania. Samo zmieszczenie puli w limicie wartości nie gwarantuje zmieszczenia całego stanu. Większa pula zwiększa też odpowiedź GET i koszt merge.

Powiększenie baz samo nie zwiększa liczby wywołań ani rozmiaru zapytania Spotify search. Zebranie nowych kandydatów wymaga kolejnych generacji w istniejącym budżecie. Większe lokalne pule zwiększają parsowanie i ocenianie; powtarzane odczyty Last.fm przy ocenie utworów mogą potęgować koszt. Mikrobenchmark parsowania nie mierzy pełnej generacji i nie uzasadnia zwiększenia limitów. Najpierw poprawić retencję i zmierzyć p95 obliczeń dla 2/4 profili.

## 5. Zaktualizowany plan niezależnych PR-ów

1. **D.1 — aktualność historii Last.fm.** Jawne metadane właściciela, okna, czasu i kompletności. Kompletna obserwacja pozwala zmniejszyć/wyzerować licznik; częściowa nie udaje kompletnej i nie przedłuża wiarygodności dawnych danych. Aktualizacja tagów nie odnawia historii. Bez dodatkowych API i automatycznego transferu preferencji. Testy: spadek 99 → 1, nieobecny wykonawca → 0 przy pełnym oknie, częściowe 600 wpisów, awaria, upływ okna, zmiana użytkownika, odświeżenie tagów. Przed scaleniem porównać długość i jakość dla 2/4 osób oraz udział discovery. Możliwa krótsza lub dłuższa playlista wskutek poprawnej klasyfikacji; wycofać przy fałszywym zerowaniu, mieszaniu użytkowników lub niewyjaśnionej utracie jakości.
2. **D.2 — wspólna retencja i sprawiedliwa rotacja przy stałych limitach.** Objąć świeże wyniki, cache i cloud merge; zachować wartościowe nagrania oraz pokrycie profili/gatunków, ograniczyć koncentrację i zapewnić szansę wykonawcom poza pierwszymi 54. Rozdzielić czas pozyskania od ponownego użycia; rozważyć pamięć nieskutecznych zapytań w istniejącym budżecie. Testy: pełne trzy pule, flood wariantów/jednego wykonawcy, duplikaty, współwykonawcy, homonimy, mniejszościowe gatunki, nieobecne profile, TTL, quota, kolejność cloud merge i cold/warm cache. Oczekiwany wzrost dostępnych różnych wykonawców i długości bez słabszych progów; nie jest gwarantowany. Wycofać przy utracie chronionego pokrycia, nowych błędach synchronizacji lub istotnym wzroście kosztu.
3. **D — ponowna weryfikacja #13 na aktualnym main.** Obecny PR zachowuje osobny zakres pozyskiwania. Audyt i testy charakteryzujące dodane teraz nie implementują D.1/D.2. Zalecenie: rozwiązać powyższe ryzyka przed wdrożeniem D, następnie powtórzyć porównanie 2/4 profili oraz pełne CI. Nie włączać B, C ani aktywacji dopasowań F3.

Każdy PR osobno, z wersją nagłówka dla swojego wdrożenia, bez automatycznego scalenia. Rollback przez revert danego PR i nową wersję nagłówka; nie kasować baz ani preferencji. Nowe metadane muszą być opcjonalne i zrozumiałe dla starszego kodu; przed wdrożeniem przygotować lokalny eksport do porównania. Nie podnosić limitów w tych PR-ach.

## Kryteria poprawy do zatwierdzenia

- Niezmienione limity 2000/1800/3000, budżety Spotify 12/14/16 i Last.fm 24/28/32 oraz progi i limit dwóch utworów playlisty.
- Zero utraconych chronionych kandydatów w scenariuszach, gdzie istnieje bezpieczna alternatywa usunięcia; brak regresji pokrycia któregokolwiek profilu/gatunku.
- Na minimum 10 stałych replayach odpowiedzi dla 2/4 osób: mediana liczby kwalifikowalnych wykonawców co najmniej +10%, brak spadku długości przy tym samym budżecie i progach. To proponowany cel, jeszcze nie zmierzony live.
- Koncentracja top 1/top 5 wykonawców w puli nie większa niż baseline; deterministyczna rotacja propozycji źródeł obejmuje całe pasujące 1800 nazw w 100 turach po 18, bez obietnicy wywołania API dla każdej nazwy w tej samej turze.
- Pełna generacja: proponowany limit p95 czasu obliczeń +20% względem baseline na tej samej maszynie i danych. Mierzyć osobno API i obliczenia; nie stosować kruchego progu czasu jako jednostkowego testu CI.
- Przed publikacją mierzyć pełny zakodowany stan z CAS i rzeczywiste localStorage. Zachować zapas; próg przeglądu 80% limitów API, bez zakładania uniwersalnej pojemności przeglądarki.

Nowe testy charakteryzujące wykazują istniejące wady, a nie zatwierdzają ich jako docelowej polityki. Po naprawie należy zastąpić odpowiednie oczekiwania poprawnym zachowaniem. Automatyczne regresje obejmują bilans każdej puli, starvation, stale counts, limity historii, rotację, TTL, wyparcie przez API/cloud oraz symulację rozmiarów i prototyp na kopii. Produkcyjny bilans i wpływ na realną długość pozostają niezmierzone bez porównywalnych eksportów.
