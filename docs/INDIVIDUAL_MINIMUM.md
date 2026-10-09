# Minimum indywidualne — v43.17.B

## Zakres i reguła

PR B, na `main` bd3bb534 (v43.16.D). Każdy obecny profil musi mieć skończony liczbowy wynik ≥35 z `profileTrackSatisfaction`, bez zaokrąglenia i przed feedbackowym/rozpoznawalnościowym/wzorcowym bonusem grupowym, fairness, xQuAD, Polish boost i MMR. Wzór indywidualnej satysfakcji i wszystkie bonusy pozostają bez zmian. Próg dotyczy każdego utworu, nie średniej playlisty.

Wspólna funkcja `satisfiesIndividualMinimum` odrzuca kandydata w `eligibleGroupCandidates` i ponownie na wejściu `selectGroupPlaylist`. Ponowna bramka chroni także bezpośrednie wywołania i już obliczone rekordy; nie ufa samemu `minScore`. Obie normalne ścieżki i oba warianty fallbacku operują tylko na poprawnych kandydatach. Nieobecne osoby nie ograniczają wyniku. Brak oceny, NaN, Infinity lub tekst zamiast liczby odrzucają kandydata; pusty skład nie wybiera utworów. Diagnostyka `lowIndividualFit` jest osobną liczbą odrzuceń, bez podwójnego liczenia między kwalifikacją i selekcją.

Pozyskiwanie D korzysta z tej samej kwalifikacji, więc liczy i sprowadza kandydatów spełniających ochronę wszystkich obecnych osób. Retencja D.2 ocenia wartość dla wszystkich zapisanych profili i nie jest zaostrzana: utwór słaby dla aktualnego składu może nadal pozostać na przyszły skład. Próg grupowy 44, fallback 35, feedback −40, limity wykonawców/pul, quota discovery, budżety API i RMF nie zmieniają się. Brak nowych pól trwałych, migracji lub zapisu produkcyjnego D1.

## Regresje i pomiar wpływu

`tests/individual-minimum.test.mjs` porównuje zamrożone rzeczywiste funkcje kwalifikacji i selekcji z v43.16.D (`tests/fixtures/selection-v43.16.json`) z B, na identycznych danych i niezmienionym aktualnym wzorze ocen. Fixture jest lokalny, bez sieci; stała losowość i historie. Każdy scenariusz wykonano dla Bartka+Asi oraz wszystkich czterech profili. Pełne wyniki: `docs/fixtures/individual-minimum-impact.json`.

| Scenariusz, cel 16 | 2 osoby: D → B | 4 osoby: D → B | Wpływ jakościowy |
| --- | --- | --- | --- |
| Zgodne profile | 16 → 16 | 16 → 16 | Te same średnie; minimum 64 |
| 4 słabe dopasowania, brak zamienników | 16 → 12 | 16 → 12 | 4 wyniki 34 usunięte; średnia chronionej osoby 56,5 → 64; wykonawcy 8 → 6 |
| Te same 4 słabe utwory i 4 bezpieczne zamienniki | 16 → 16 | 16 → 16 | Minimum 64 i 8 wykonawców, bez spadku jakości |
| Każdy utwór słaby dla jednej obecnej osoby | 16 → 0 | 16 → 0 | Poprzedni wynik 34 niedopuszczalny; zero wierszy jest poprawnym wynikiem |

W tych scenariuszach liczba odkryć wynosi 0 i nie było wywołań API. Inne istniejące testy obejmują discovery, budżety, feedback, historię i filtry wersji. Nowe regresje obejmują 34,99 / 35 / 35,01 dla normalnej selekcji, fallbacku i rozluźniania sąsiedztwa przy 2 i 4 profilach; brak ocen; wszystkie osoby, w tym Bartka; wysoką średnią, nieprawidłowy `minScore` i bonusy maskujące słaby wynik.

To pomiar kontrolowany, nie prognoza dla puli użytkownika. Neutralny profil z ankietą ma w obecnym wzorze bazę 34; bez pozytywnego dowodu albo artysty wzorcowego może odrzucić utwór. Przy czterech rozbieżnych profilach skrócenie może być znaczące. Nie podnosimy sztucznie tej bazy, żeby obejść minimum. Lokalny pełny zestaw: 225/225 testów, zero błędów i pominiętych (Chromium, składnia obu stron i funkcji API, regresje algorytmu i synchronizacji). CI na ostatecznym commicie musi przejść przed propozycją scalenia.

## Wdrożenie i wycofanie

Nagłówki i tytuły obu stron, źródło eksportu i opis modelu pokazują v43.17.B. PR #16 zatwierdzono, scalono jako `a5b2364` i wdrożono v43.17.B; CI i Cloudflare potwierdziły ten commit. Następny niezależny zakres C opisuje [DISCOVERY_QUOTA.md](DISCOVERY_QUOTA.md).

Rollback: revert commitu/scalenia B na aktualnym `main`, nowy jednoznaczny numer wersji we wszystkich etykietach, regresje i osobno zatwierdzone wdrożenie. Nie usuwamy pul ani preferencji, nie zmieniamy schematu eksportu i D1. Kod nie ewakuuje ani nie kasuje istniejących kandydatów; normalna retencja D.2 nadal działa podczas pozyskiwania, więc revert nie odtwarza wcześniej wypartego rekordu. Przed wdrożeniem można zachować istniejący eksport jako punkt odniesienia.

Podstawy wycofania: wybranie utworu poniżej 35 dla obecnej osoby; zmiana wyników lub długości na zgodnym zestawie bez uzasadnienia filtrami; regresja blokad, synchronizacji lub czasu działania. Skrócenie spowodowane wyłącznie usunięciem niepoprawnych kandydatów jest zamierzonym działaniem, z widocznym licznikiem przyczyny.

## Obserwacja spowolnienia v43.16.D — osobny zakres

Log użytkownika z 09.10.2026: Bartek+Asia, 60/60 utworów, średnie 80/82, zero słabych dopasowań, 18/60 odkryć, 2000 kandydatów, 129 kwalifikowalnych, 87 → 87 wykonawców, 89 stron cache i 9 nowych wyszukiwań przy budżecie 12. Last.fm 1777 wykonawców/2628 utworów. Brak pomiaru czasu całego przebiegu i poszczególnych etapów; nie można przypisać opóźnienia do API albo CPU z tego logu. Ponieważ diagnostyka słabych ocen wynosi zero, ten zapis nie wykazuje naruszenia minimum 35; pełnej puli i niezaokrąglonych ocen nie ma do odtworzenia wyniku B.

Audyt kodu wskazuje powtarzane pełne `acquisitionCoverage` przed wyborem kolejnych źródeł oraz przegląd stron cache. To hipoteza kosztu lokalnego, nie zmierzona przyczyna. Oddzielny krok wydajnościowy: zmierzyć przygotowanie historii/tagów, odczyt cache, ocenę pokrycia, retencję, wyszukiwania Spotify, selekcję, zapis/synchronizację; porównać 2/4 profile przy pełnych pulach i ciepłym/zimnym cache. Ewentualne ponowne użycie ocen tylko przy niezmienionej puli, profilach, feedbacku, blokadach i dowodach Last.fm, z unieważnieniem po asynchronicznym oczekiwaniu. Kryteria: identyczni kwalifikowalni kandydaci i oceny, niezmienione limity/retry/API, krótszy lokalny czas p95. PR B nie implementuje tej optymalizacji. Następny zakres funkcjonalny to C: quota względem faktycznej długości i bezpieczne zastępowanie.
