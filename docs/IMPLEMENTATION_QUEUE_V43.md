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
| 13 | **COVER — automatyczna okładka (17–18), v1.0.0-rc.1** | Zastępuje COVER1/COVER2 jednym prostym PR: 2 × 2, końcowe dopasowanie, inicjały i OMM w osobnej stopce, automatyczny upload best effort. Bez dodatkowego UI. |

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

L2 wdrożono jako v43.28.L2 (#26). L2.1, v43.29.L2.1, koryguje wyścig kończenia testu importu oraz adnotacje CI, bez zmiany aplikacji. Kolejny zakres pozostaje U3.

## LF1 / LF3 — jedna para kont (2026-10-09)

LF1 (#28, v43.30.LF1) rozdziela próby/sukcesy Last.fm oraz częściowe wyniki i backoff. Kolejny osobny LF3 (v43.31.LF3) monitoruje parę zalogowane Spotify → skonfigurowane Last.fm, bez przypisania do obecności profili i bez migracji D1. Dokument: LASTFM_SYNC_MONITORING_LF3.md. Nazwa P5 pozostaje zarezerwowana dla optymalizacji cache.

Po LF3: U3 (artyści w ankiecie) → LF2 (kompaktowa baza Last.fm w chmurze) → LOG1 → LOG2 → M → V / S1 / S2 → COVER1 → COVER2. Zakresy algorytmiczne pozostają osobnymi, późniejszymi decyzjami.

## U3 — artyści w ankiecie (2026-10-10)

v43.32.U3 przenosi edycję wzorców i blokowanych wykonawców do ankiety, zachowując klucze, domyślne/puste wartości, konflikty i synchronizację L2. Dodatkowe gatunki pozostają dotychczasowe. Dokument: ARTISTS_SURVEY_U3.md.

Następny zakres: LF2, kompaktowa baza Last.fm w chmurze. Najpierw ustalić kontrakt, limit rozmiaru, TTL, merge i zgodność starszych klientów, z wykorzystaniem rozdzielenia prób/sukcesów LF1 i obserwacji kont LF3. Raw cache i historia odsłuchów pozostają lokalne. Dalsza kolejność: LOG1 → LOG2 → M → V / S1 / S2 → COVER1 → COVER2; strojenie selekcji i T1 osobno.

## LF2 — v43.33.LF2

Kompaktowy katalog kandydatów Last.fm do 128 KiB przez osobne `/api/lastfm`, w istniejącej tabeli i z atomowym CAS. TTL oryginalnych danych, oznaczenie konta Last.fm, zgodność starszych klientów; raw cache, historia i świeże obserwacje pozostają lokalne. Brak migracji SQL, zmiany limitów i strojenia selekcji. Szczegóły: LASTFM_CLOUD_LF2.md.

Następny niezależny zakres: **LOG1 — backend dziennika generowań**. Najpierw kontrakt bez danych uwierzytelniających i surowej historii, izolacja przez account_id, retencja do 100 wpisów/konto, obsługa błędów bez przerywania playlisty, testy i rollback. Jeśli wymaga nowej tabeli, przygotowanie SQL i kodu jest oddzielne od zatwierdzanego wykonania migracji produkcyjnej. Potem LOG2 → M → V / S1 / S2 → COVER1 → COVER2. Zmiany algorytmu i T1 nadal osobno.

## LOG1 — v43.34.LOG1

Osobne GET/POST `/api/generations`, whitelisty zbiorczej diagnostyki i tabela `generation_logs`, limit 100/konto z atomową retencją i deduplikacją UUID. Minimalny zapis klienta po zakończeniu generatora; osobny wynik LF2 i ostatni lokalny wpis bez usuwania cache po quota. Bez zmian selekcji, progów, discovery, feedbacku ani RMF. Dokument: GENERATION_LOG_LOG1.md.

LOG1 wdrożono w PR #32, LOG2 w PR #33. Migracja migrations/0001_generation_logs.sql została osobno zatwierdzona i wykonana przez użytkownika; pozytywny produkcyjny smoke test zapis/odczyt odnotowano 2026-10-11. Nie ponawiać migracji. Dalej M → V / S1 / S2 → COVER1 → COVER2; Q1/F4/T1 i strojenie selekcji pozostają osobno.

## LOG2 — v43.35.LOG2

Chroniony widok w Narzędzia i dane → Historia generowań: odczyt na żądanie, filtry lokalne, czasy i ograniczenia doboru, osobny wynik LF2 oraz kopia ostatniej lokalnej próby. Bez strojenia algorytmu, nowej migracji i pollingu. Dokument: GENERATION_HISTORY_LOG2.md.

2026-10-11: użytkownik potwierdził wykonanie migracji w office-music-db, 1 wpis w generation_logs oraz odczyt tego wpisu po „Odśwież historię” w zalogowanym OMM. Produkcyjny smoke test LOG1/LOG2 pozytywny. Komunikat „Połącz Spotify” przed odświeżeniem nie uzasadnia zgłoszenia błędu sesji. Aktywacja zakończona; nie ponawiać migracji i nie zmieniać LOG1/LOG2 bez stwierdzonej potrzeby. Następny niezależny PR: M — wspólny monitor Spotify; dalej V / S1 / S2 → COVER1 → COVER2, z zachowaniem odrębnych zakresów.

## M — v43.36.M

Wspólny, wyłącznie odczytowy snapshot Spotify dla RMF i przyszłych konsumentów. Single-flight, jawnie uzbrajany polling, Web Locks/atomowa dzierżawa i BroadcastChannel, backoff/401/deadline, luki i izolacja sesji. Brak uzbrojonych konsumentów w M oznacza zero dodatkowego cyklicznego odpytywania po wdrożeniu. Kolejka RMF, algorytm playlist, feedback, discovery i produkcyjne D1 pozostają bez zmian. Dokument: SPOTIFY_PLAYBACK_MONITOR_M.md. Uzupełniono wyłącznie zapis przekazanego pozytywnego smoke testu LOG1/LOG2; migracja zakończona.

Następny niezależny PR: **V — opcjonalna względna głośność Faktów RMF**, z rzeczywistą kontrolą możliwości urządzenia i osobnym projektem dzierżawy/przywracania. Potem S1/S2 → COVER1/COVER2; automatyczne kary, zmiany selekcji i strojenie nie należą do M.

## V — v43.37.V

Opcjonalne względne podbicie regularnych Faktów, off po otwarciu strony, lokalny intent/CAS i jawne odzyskiwanie, ochrona ręcznej głośności/urządzenia. Jeden konsument M, bez zmian kolejki, algorytmu i D1. Limit 70%, gain 0–20%, default +10%; zamknięcie karty pozwala wyłącznie na best-effort restore. Dokument: RMF_VOLUME_V.md. Realne capabilities/Premium wymagają świadomego smoke testu po włączeniu, mock nie zastępuje urządzenia użytkownika.

Następny niezależny zakres: **S1 — dziennik prawdopodobnych pominięć bez wpływu na rekomendacje**. Wspólny monitor M, tylko jawnie wybrana playlista OMM i Track ID, niejednoznaczne przejścia pomijane, deduplikacja i izolacja od ręcznych ocen/wykonawców. S2 wymaga osobnej decyzji o wygasaniu, kumulacji i resetach oraz pomiaru długości/jakości dla 2/4 osób. Potem COVER1/COVER2; Q1/F4/T1 osobno. Produkcyjny smoke LOG1/LOG2 pozostaje pozytywny; żadnego ponawiania migracji.

## V.1 — naprawa diagnostyki przed S1

Po nieudanym smoke v43.37.V najpierw rozróżnienie braku intentu od błędów urządzenia/sesji oraz ograniczone potwierdzanie opóźnionego readback (wyłącznie GET, bez powtórzenia PUT). Szczegóły: RMF_VOLUME_V1.md. Nie stwierdzono jeszcze jednoznacznej przyczyny błędu live; po V.1 powtórzyć test urządzenia. S1 pozostaje następnym osobnym zakresem po weryfikacji V; S2 i zmiany rekomendacji nie są częścią poprawki.

## V2 — v43.39.V2: kolejka, tło i punkty procentowe

Użytkownik potwierdził pozytywny smoke V1: 49% → 54% podczas Faktów → 49% podczas muzyki. Odznaczanie checkboxa po ukryciu karty uznano za niezgodne z docelową pracą na przypiętej karcie. V2 oddziela preferencję od sesji po udanym dodaniu Faktów, opt-in background w M, maks. 60 min i 10 oczekujących ID, zakończenie po powrocie do muzyki. Suwak 0–30 p.p., default +10, max 100% (bez limitu 70%). Dokument: RMF_VOLUME_V2.md. Stare ustawienia i intent-y zachowane; brak zmian algorytmu/D1. Użytkownik autoryzował scalenie i wdrożenie po testach. Po publikacji smoke przypiętej karty, następnie niezależny S1 (bez kar); S2 i COVER1/COVER2 osobno.

## S1 — v43.40.S1: lokalny dziennik prawdopodobnych pominięć

Pozytywny smoke V2 potwierdzony przez użytkownika: przywrócony poziom i zatrzymany monitor, końcowe 58%, 2 zmiany / 3 odczyty potwierdzające. S1: jawna sesja jednej zapisanej playlisty OMM (do 8 h), wspólny background M, konserwatywne przedziały early/middle/late i stabilizacja, lokalny atomowy dziennik 100/konto z widokiem ostatnich 30 dni. Default off po reloadzie. Bez kar, feedbacku wykonawców, zmian selekcji, RMF i D1. Dokument: SPOTIFY_SKIP_JOURNAL_S1.md. Użytkownik autoryzował scalenie/wdrożenie po testach. Kolejny krok: realny smoke i audyt jakości detekcji, potem osobny S2 z zatwierdzonymi kumulacją/wygasaniem/resetem/synchronizacją; nie naliczać kar wstecz z S1. Dalej COVER1 → COVER2.

## S2 — v43.41.S2, 2026-10-11

Użytkownik potwierdził produkcyjny smoke S1: 4 wpisy (3 early, 1 middle), bez ocen; zatwierdził S2 i warunkowe scalenie/wdrożenie. Dawne/testowe wpisy nie są backfillowane. Nowy opt-in, osobny dokładny Track ID feedback z decay 30/90 dni i cap −250, trwały reset 👍, per-account atomowy local edit i osobny CAS endpoint w istniejącym app_state. Bez migracji D1/LOG, RMF lub zmian progów/discovery. Szczegóły, testy, wpływ i rollback: [AUTO_TRACK_FEEDBACK_S2.md](AUTO_TRACK_FEEDBACK_S2.md). Następny krok po smoke: COVER1 → COVER2, bez automatycznego rozpoczęcia tych prac.


### COVER — uproszczony zakres zatwierdzony 2026-10-11

Użytkownik zastąpił wcześniejsze COVER1/COVER2 jednym automatycznym mechanizmem i zatwierdził stopkę pod grafikami (bez nakładania tekstu/logo na albumy), nazwę v1.0.0-rc.1 oraz scalenie/wdrożenie po pełnych testach i CI. Historyczne wpisy COVER1/COVER2 powyżej są zastąpione tą decyzją. Dokument: [AUTOMATIC_PLAYLIST_COVER.md](AUTOMATIC_PLAYLIST_COVER.md). Bez zmian rekomendacji, ustawień użytkownika i migracji D1.
