# Aktualna architektura OMM

Stan: 2026-10-12, `1.0.6-rc`, baza main `9894d9a`. Ten dokument zastępuje opis v42 z historycznego handoffu; szczegółowe dokumenty PR pozostają historią decyzji.

## Aplikacja i integracje

`index.html` zawiera generator, Spotify OAuth PKCE, pozyskiwanie i punktację, zapis playlisty oraz integrację modułów. `taste.html` edytuje ankietę, artystów wzorcowych i blokady. Samodzielne skrypty JS są ładowane bez bundlera; Node i Playwright służą wyłącznie narzędziom/testom. CI i automatyczne wdrożenia są w `.github/workflows/`.

Spotify dostarcza katalog, historię i odtwarzanie; Last.fm dostarcza historię, katalog i tagi. Profile obecności nie są osobnymi kontami Spotify/Last.fm: obecny model operuje jedną parą kont. OAuth obejmuje odczyt/modyfikację playback oraz `ugc-image-upload`. Dostępność sterowania urządzeniem wymaga rzeczywistych capabilities i uprawnień, sama instalacja Spotify na PC nie wystarcza.

Transport generatora korzysta z aktualnej sesji podczas długich operacji. Nieudany 401 może wywołać jedno odświeżenie i ponowienie wyłącznie tego żądania; refresh jest koordynowany. Przejściowa awaria refresh nie usuwa sesji. Nie ponawiamy niejednoznacznych zapisów po błędzie sieciowym; 429 respektuje Retry-After. Szczegóły: [P3](GENERATION_OPTIMIZATION_P3.md).

## Dane lokalne i chmurowe

| Obszar | Implementacja i kontrakt |
| --- | --- |
| Preferencje, import, ankieta | `local-state.js`, `taste-state.js`: bezpieczne zapisy/odzyskiwanie oraz konflikty między kartami; [L1](LOCAL_STATE_L1.md), [L2](LOCAL_STATE_L2.md). |
| Stan trwały | `functions/api/state.js`: GET/PUT, whitelist, konto z `/me.account_id`, limit body 2 MiB. Pole `id` ani identyfikator body nie wybierają partycji. [Kontrakt](STATE_API.md). |
| Kandydaci | Spotify do 2000 rekordów; Last.fm do 1800 wykonawców i 3000 utworów. `pool-retention.js` chroni zróżnicowaną retencję; lokalna historia pozostaje historią faktycznych odsłuchów. [Retencja](POOL_RETENTION.md). |
| Last.fm | `lastfm-sync.js`: osobne próby/sukcesy i backoff; `lastfm-cloud.js` i `/api/lastfm`: kompaktowy katalog do 128 KiB, TTL 45 dni, CAS w istniejącym `app_state`. Surowy cache, historia i recentCount nie trafiają do katalogu. [LF1](LASTFM_RELIABILITY_LF1.md), [LF2](LASTFM_CLOUD_LF2.md), [LF3](LASTFM_SYNC_MONITORING_LF3.md). |
| Dziennik generowań | `generation-log.js`, `generation-history.js`, `/api/generations`: zbiorcze dane, whitelist, do 100 wpisów/konto w `generation_logs`. Widok odczytuje na żądanie. Migracja wykonana, produkcyjny odczyt/zapis potwierdzony przez użytkownika. [LOG1](GENERATION_LOG_LOG1.md), [LOG2](GENERATION_HISTORY_LOG2.md). |
| Automatyczne oceny | `auto-track-feedback.js`, `/api/auto-feedback`: osobny ograniczony stan per account_id, CAS w `app_state`, bez nowej migracji. [S2](AUTO_TRACK_FEEDBACK_S2.md). |

Cache nie jest backupem wszystkich danych. LF2 przesyła reprezentatywny podzbiór, nie pełną bazę. Eksport nie zawiera uwierzytelnienia; nie należy publikować prywatnych backupów. Błąd chmury nie unieważnia udanego utworzenia playlisty.

## Generowanie i jakość

Przepływ: profile/sesja → porządki → Last.fm i historia Spotify → artyści wzorcowi/gatunki/wspólne preferencje → kwalifikacja i wybór → zapis Spotify → diagnostyka → synchronizacja. `generation-progress.js` rozdziela czasy etapów i operacji; pomiary inclusive mogą się nakładać i nie są pomiarem CPU.

Punktacja łączy ankietę, wzorce i dowody Last.fm/Spotify, następnie least misery, fairness, xQuAD i MMR. Dowody gatunkowe dziedziczą wagę tylko właściwych aspektów kategorii. Wszystkie ścieżki wymagają minimum 35 każdej obecnej osoby przed bonusami. Ręczna kara dowolnego współwykonawcy ≤ −40 odrzuca utwór; nie przypisuje kary pozostałym. Maksymalnie dwa utwory na wykonawcę. Kontekstowe filtry wersji chronią zwykłe tytuły i klasykę. Historia odsłuchu, a nie wygenerowane listy, blokuje powtórki.

Discovery domyślnie 30%: dolne 25% miękkie, górne 35% twarde dla faktycznej długości (zaokrąglenie w dół). Preferowane są bezpieczne zamiany i uzupełnienia, bez skracania tylko dla dolnego celu; 0%/100% mają osobną świadomą semantykę. [Minimum](INDIVIDUAL_MINIMUM.md), [feedback](ARTIST_FEEDBACK.md), [discovery](DISCOVERY_QUOTA.md), [wersje](ALTERNATIVE_VERSIONS.md).

Q1.2–Q1.7 poprawiają wykorzystanie istniejącego budżetu: ukierunkowane pozyskiwanie, kwalifikacja cache, diagnostyka Search, paginacja według wiarygodnego total i kontekstowa rotacja. `search-rotation.js` czasowo obniża priorytet po dwóch potwierdzonych zerach bezpiecznych kandydatów; nie blokuje zapytań i nie ocenia utworów. Bezpieczny kandydat niewybrany nie jest porażką. Pamięć ograniczona, lokalna, poza eksportem/D1; zmiana kontekstu neutralizuje stare obserwacje. [Q1.7](Q1_7_CONTEXTUAL_SEARCH_ROTATION.md). Pełna długość nie jest gwarantowana dla dowolnej grupy.

## Odtwarzanie, RMF i okładki

`spotify-playback-monitor.js` współdzieli odczyty i koordynację kart. Bez aktywnego konsumenta nie odpytuje w tle. RMF pozostaje osobną kolejką, niezależną od selekcji muzyki.

`rmf-volume*.js` (V2) uzbraja opcjonalną automatykę po dodaniu regularnych Faktów do kolejki; działa w tle i kończy obserwację po powrocie do muzyki. Wzmocnienie **0–30 punktów procentowych, domyślnie 10, maksimum 100%** zastępuje stare względne procenty/cap70. Ochrona urządzenia, ręcznej zmiany i potwierdzenia zapisu ogranicza restore; zamknięta/uśpiona karta nie gwarantuje przywrócenia. [V2](RMF_VOLUME_V2.md).

`spotify-skip-journal.js` (S1) obserwuje jawnie wybraną listę OMM do 8h; lokalny dziennik 100 zdarzeń/30 dni. S2 wymaga osobnego opt-in i używa tylko nowych zdarzeń, bez backfillu/testowych pominięć. Kary wczesne/środkowe −100/−50, cap −250, half-life30 dni, wygaśnięcie90 dni; ręczne oceny mają pierwszeństwo, 👍 resetuje auto. Nie są to twarde blokady wykonawcy. Niejednoznaczne przejścia i podcasty nie tworzą kar. [Monitor](SPOTIFY_PLAYBACK_MONITOR_M.md), [S1](SPOTIFY_SKIP_JOURNAL_S1.md).

`playlist-cover.js` automatycznie wybiera cztery najlepiej dopasowane utwory, preferuje różne albumy i renderuje kolaż ze stopką inicjałów/OMM. Stopka jest poza grafikami albumów. Upload JPEG jest best effort; brak grafik/scope/API nigdy nie przerywa playlisty. Brak edytora i dodatkowej obsługi. [Okładki](AUTOMATIC_PLAYLIST_COVER.md).
