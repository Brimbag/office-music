# Kolejka OMM po v43.24.P4

Stan: 9 października 2026. Baza main `4c6e127`. Ta kolejka zastępuje historyczne statusy kolejki po v43.18.C. Każdy zakres ma osobny PR od aktualnego main, testy i CI, nową wersję nagłówka oraz zgodę przed scaleniem i wdrożeniem. Propozycje poniżej nie oznaczają zgody na implementację. Nie zwiększamy limitów pul, budżetu API ani limitu dwóch utworów wykonawcy.

## Stan pierwotnego planu

Wdrożone: 1 testy (#2), 2 API stanu (#3), 3 hierarchia ankiety (#4), 4 dowody gatunkowe (#5/G), 5 ujemny feedback (#6/A), 6 quota discovery (#17/C), 9 kontekstowe wersje (#7/E i #8/E.1). Pozycja 8 ma wdrożone pozyskiwanie D (#13), datowaną historię D.1 (#14) i retencję D.2 (#15); audyt zimnej/dojrzałej rzeczywistej bazy pozostaje do wykonania. Pozycje 7 i 10 są częściowe. Pozycja 13 ma lokalną diagnostykę, ale nie trwały widok logów. Pozycje 11, 12, 14, 15, 16, 17–18 nie były wcześniej ukończone.

Dodatkowo wdrożono B (minimum 35 każdej obecnej osoby, #16), F2 (powód blokady Spotify ID, #11), F3 (raport katalogów, #12) i P–P4 (#18–22). Pierwotne ręczne F (#9) wycofano w #10; nie wraca do kolejki. Historyczny handoff #1 wymaga aktualizacji, nie scalenia bez sprawdzenia.

## Aktualizacja po U1

U1 wdrożono jako v43.25.U1 (#23). Kolejny zatwierdzony zakres to U2 — dopasowanie do mockupu, v43.26.U2; testy/CI warunkiem scalenia. Przeniesienie artystów otrzymuje nazwę U3, żeby nie mylić go z adaptacją wizualną. Po U2 następne pozostają L1/L2.

## U1 / punkt 16

Kandydat `v43.25.U1`: kafelki obecności z klawiaturą, zwijane preferencje ręczne w tych samych polach, osobne CTA generowania, zwijane narzędzia i dane, krótkie podsumowanie wyniku, średnie dopasowanie osób i pełna diagnostyka w details. RMF pozostaje odrębnym panelem. Bez nowych zapisów, requestów, migracji i zmian algorytmu. Przeniesienie konfiguracji Last.fm i istniejących narzędzi pod details jest wyłącznie zmianą układu — nie nowym panelem administracyjnym ani mechanizmem synchronizacji.

## Proponowana kolejność

| Kolejność | Niezależny PR | Powód i warunki |
| --- | --- | --- |
| 1 | **U1 — generator (16)** | Bieżący PR. Testy klawiatury, układu mobilnego, dostępności narzędzi i zachowania diagnostyki/ocen. Wynik playlisty i zapisany stan identyczne. |
| 2 | **L1 — bezpieczne zapisy i import (10)** | Fundament przed przenoszeniem edycji. Quota przy zapisie ankiety/ustawień, odzyskiwalny import, kontrola utraty danych. Test awarii w połowie importu i awarii rollbacku; bez kasowania preferencji w celu zwolnienia miejsca. |
| 3 | **L2 — synchronizacja między stronami (10)** | Zdarzenia storage, świeży odczyt przed zapisem i jawne konflikty edycji. Test dwóch kart, starszego klienta, usunięcia i równoległego zapisu. L1 i L2 osobno, bez utożsamiania localStorage z D1. |
| 4 | **U3 — artyści w ankiecie (14)** | Po L1/L2. Zachować office_seed_* i office_blocked_*, domyślne blokady i ręczne gatunki. Test zgodności edycji starej/nowej strony. Nie wracać do ręcznego rozróżniania setek wykonawców. |
| 5 | **LF1 — Last.fm po błędach (7)** | Osobne attempt/success, retry/backoff, sukcesy częściowe. Dziś tag sync zapisuje czas także po błędach. Test wszystkich błędów, jednej udanej metody, pustej poprawnej odpowiedzi, 429 i zmiany konta. Nie zmienia selekcji. |
| 6 | **LF2 — kompaktowa baza w chmurze (11)** | Po LF1 i kontrakcie API. Projekt limitów, TTL, pochodzenia dowodów i deterministycznego merge dla dwóch komputerów. Raw cache pozostaje lokalny. Najpierw pomiary rozmiaru i zgodności klientów; bez automatycznej migracji produkcji. |
| 7 | **LOG1 — backend generowań (12)** | Osobny endpoint/tabela, account_id, sanitizacja, retencja do 100/konto, rollback. SQL i migracja produkcji do osobnego zatwierdzenia; błąd logowania nie przerywa playlisty. |
| 8 | **LOG2 — widok logów (13)** | Po LOG1. Historia wersji, czas, długość, profile, filtry i źródła. Lokalna diagnostyka pozostaje dostępna przy awarii backendu. |
| 9 | **M — wspólny monitor Spotify** | Jeden odczyt playback dla przyszłych konsumentów, urządzenia, luki, pauza/seek, background i 429. Najpierw projekt i test desktop Spotify; nie zakładać sterowania na każdym urządzeniu. Nie zmienia kolejki RMF. |
| 10 | **V — głośność RMF** | Po M. Off default, względne +10% (0–20%), cap podbicia 70%, baseline, ręczna zmiana, restore tylko na właściwym urządzeniu i supports_volume. Przy poziomie >70% nie obniżać głośności jako „podbicie”. Ograniczenia po zamknięciu karty wymagają akceptacji; browser nie gwarantuje restore. |
| 11 | **S1 — dziennik prawdopodobnych pominięć** | Po M, niezależnie od V. Track ID, deduplikacja zdarzeń, ownership, bez zmiany punktacji. Nie wyciągać kary z niejednoznacznego przejścia/gap/device change ani podcastów i odtwarzania poza OMM. |
| 12 | **S2 — automatyczna kara za pominięcie** | Po S1 i osobnej zgodzie na zmianę rekomendacji. Propozycja <20% −100, 20–70% −50, >=70% bez kary, kumulacja do −250. Granica dokładnie 70%, wygasanie i reset wymagają decyzji. Ręczne oceny mają pierwszeństwo, 👍 resetuje auto, bez twardych kar wykonawcy. Testy synchronizacji i restartu. |
| 13 | **COVER1 — metadane i render okładki (17)** | Niska pilność. Zachować obrazy albumów, CORS, kolaż bez powtórzeń, limit JPEG, Warszawa. Lokalny render przed uploadem. |
| 14 | **COVER2 — scope i upload (18)** | Po COVER1, aktualny kontrakt Spotify i reautoryzacja. Błąd okładki nie przerywa utworzonej playlisty; bez powtórnego tworzenia playlisty. |

## Odłożone zmiany mechanizmu i audyty warunkowe

Zgodnie z aktualną decyzją użytkownika pozostawiamy mechanizm generowania bez zmian. Poniższe tematy nie są częścią U1 i wymagają nowej zgody:

- **Q1 — długość playlisty i pozyskiwanie (8/6):** porównać P3/P4 na identycznym pełnym stanie. Raporty live P4: 2 osoby 35/60, 4 osoby 36/60; quota usuwa odpowiednio 7 i 9 odkryć. Zbadać dostępność non-discovery, bezpieczne zamiany i wykorzystanie istniejącego budżetu, bez obniżania min35/limitów. Samo pełne 12/12 Search nie rozwiązuje czteroosobowego wyniku. Nie obiecywać 60/60 ani traktować raportu jako dowodu globalnego optimum lub regresji P4.
- **P5 — sprawdzanie cache:** live 14,1 s dla 2 i 29,0 s dla 4 osób, zero dodanych kandydatów. Oddzielny PR optymalizacyjny dopiero po zgodzie, ścisła zgodność ocen/retencji/requestów i pełna invalidacja po historii, feedbacku i zmianie osoby. Nie łączyć z Q1. Czas ścienny i luka timera nie dowodzą CPU ani uśpienia.
- **T1 — gatunki tylko z ankiety (15):** po U3 i realnym eksperymencie A/B/C. B bez dawnych stylów i seedów, C z punktacją seedów bez ich aktywnego odświeżania. Dotychczasowe dane syntetyczne nie wskazały zwycięzcy. Zachować stare klucze dla rollbacku; zmiana funkcjonalna osobno od UX.
- **E.2 — En Directo i inne wersje:** potwierdzić błąd i fałszywe trafienia, osobny mały PR z ochroną zwykłych tytułów i klasyki.
- **F4 — użycie dopasowań katalogowych:** F3 tylko raportuje; najpierw próbka z rzeczywistej bazy i pomiar błędów. Bez automatycznego przenoszenia ocen po nazwie lub wybierania wykonawcy wyłącznie po popularności. Nie ma zatwierdzonej masowej migracji preferencji.
- **Dokumentacja:** aktualizacja AGENTS/ARCHITECTURE/ROADMAP do main i wycofanego F, niezależny PR bez wersji aplikacji. Warto wykonać przed rozszerzeniami danych/monitora. Nie nadpisywać historycznych, lokalnych plików użytkownika.

## Wspólne warunki

Każdy PR opisuje wpływ na długość/jakość, testy i rollback. UX i niezawodność nie zmieniają rekomendacji. Dla rozszerzeń danych preferujemy addytywność, zgodność starego klienta i brak destrukcyjnych migracji. Rollback kodu nie cofa automatycznie decyzji użytkownika ani nowych danych. Każda migracja ma własną procedurę; wyłączenie konsumenta monitora nie powinno uruchamiać innych funkcji. Po każdym wdrożeniu weryfikacja konkretnego SHA i widocznej wersji, potem obserwacja live przed kolejnym PR.

## Aktualizacja po U2 / L1

U2 wdrożono jako v43.26.U2 (#24). L1, v43.27.L1: trwała kopia sprzed importu, odzyskiwanie przed startupem, jawne błędy zapisu i cofanie niezapisanej oceny ankiety. Szczegóły i rollback: [LOCAL_STATE_L1.md](LOCAL_STATE_L1.md). Kolejny niezależny zakres: L2 — odświeżanie i konflikty między kartami; bez zmian algorytmu i kontraktu D1. Dalsza kolejność: U3 → LF1 → LF2 → LOG1 → LOG2 → M → V/S1/S2 → COVER1/COVER2.

## Aktualizacja L2

L1 wdrożono jako v43.27.L1 (#25). L2, v43.28.L2: synchronizacja widoków kart i merge niezależnych ocen z jawnym konfliktem; [opis i rollback](LOCAL_STATE_L2.md). Kolejny niezależny zakres: U3 — artyści wzorcowi i blokowani w ankiecie, bez zmiany preferencji, kluczy i selekcji. Dalej LF1 → LF2 → LOG1/LOG2 → wspólny monitor i jego osobni konsumenci → okładki.
