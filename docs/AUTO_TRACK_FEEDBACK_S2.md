# S2 — v43.41.S2: opcjonalne automatyczne kary za nowe pominięcia

## Zgoda i zakres

Pozytywny smoke S1 od użytkownika 2026-10-11: cztery prawdopodobne pominięcia, trzy wczesne i jedno środkowe, bez ocen. Użytkownik zatwierdził kolejny etap oraz scalenie/wdrożenie po testach, wyraźnie zakazując oceniania testowych pominięć. **Nie czytamy dziennika S1 do naliczania ocen, nie wykonujemy backfillu ani migracji tych czterech wpisów.** Dotychczasowa diagnostyka pozostaje nietknięta. S2 przyjmuje tylko nowy callback aktywnej obserwacji rozpoczętej po opt-in.

Osobny moduł `auto-track-feedback.js` oraz `/api/auto-feedback`. Bez zmian RMF/V2, monitora, playlist endpoints, Spotify scopes, discovery, progów jakości, limitów artystów ani ręcznych ocen. Wybrana playlista/context/Track ID i konserwatywna detekcja pozostają S1. Podcasty/RMF, pauza, seek, nieobserwowane luki, naturalny koniec, granice kategorii i zmiana urządzenia nie tworzą automatycznych ocen. Spotify nie ujawnia intencji: to nadal prawdopodobne pominięcia; niewidocznego seek do końca nie można niezawodnie wykluczyć.

## Produkt i kary

Przełącznik „Naliczaj automatyczne kary za nowe pominięcia” domyślnie off, per zweryfikowane konto i komputer. Włączenie/wyłączenie kończy dotychczasową obserwację; trzeba jawnie rozpocząć nową. Zapobiega to wykorzystaniu pending callback sprzed opt-in. Nie włączamy monitora automatycznie. Ustawienie zachowuje się po restarcie, ale zbieranie nadal wymaga uruchomienia obserwacji S1 (max 8 h). Wyłączenie usuwa wpływ auto na punktację, nie usuwa danych ani manual feedbacku.

Reguły dla całego szacowanego przedziału S1:
- <20%: pierwsze wczesne −100, kolejne −50;
- 20%–<70%: każde −50;
- ≥70%: brak kary, tylko diagnostyka S1.

Kumulacja w kolejności timestamp + event ID, cap −250 po każdym kroku: nie magazynujemy nadmiarowych punktów ponad cap. Między zdarzeniami i po nich wpływ maleje z half-life 30 dni. Zdarzenie wygasa przy dokładnie 90 dniach. „Pierwsze wczesne” liczone w zachowanych zdarzeniach po resecie. Bez utożsamiania innych wydań/ID, artystów, tytułów ani współwykonawców.

Ręczne 👎 zachowuje istniejące wykluczenie utworu i działanie na wykonawców. Ręczne 👍 zachowuje istniejący efekt i zapisuje reset dla dokładnego Track ID, również gdy auto jest off lub klient nie ma jeszcze auto danych z chmury. Ponowne kliknięcie 👍 zdejmujące ręczną ocenę również zachowuje reset. Manual track value !=0 ma pierwszeństwo przed auto. Błąd resetu nie kasuje ręcznej oceny: komunikat prosi ponowić 👍 przed zdjęciem oceny. Bez zweryfikowanego immutable account_id nie przypisujemy automatycznych danych do publicznego id.

## Wpięcie do modelu

`feedbackScore` może pokazać łączny feedback w diagnostyce i dawnym rankingu. `groupTrackFeatures` przechowuje osobno `feedback` (dotychczasowy ręczny) i `autoFeedback` (dokładny Track ID, tylko gdy brak ręcznej oceny utworu). Dotychczasowy mnożnik 0.08 i clamp −20/+16 dla wyniku grupowego pozostają: auto −100 daje ok. −8, −50 ok. −4, cap −250 maks. −20 punktów grupowych.

**Nie kierujemy auto do istniejącego fallback guard feedback ≤−40.** Gate nadal używa ręcznego `features.feedback`; bez tego rozdzielenia auto skip byłby ukrytą blokadą bezpiecznego fallbacku. Nie zmieniamy stałej −40. `feedbackArtistStats`, blokady artystów i `trackFeedbackValue` czytają wyłącznie stare manual dane. Oceny poszczególnych osób i ich minimum 35 nie zmieniają się; niższy wynik grupowy może zmienić kolejność lub wykluczyć utwór przy niezmienionym progu grupowym.

Cache pozyskiwania invaliduje się po zmianie danych/opt-in, ma maks. minutę dla ciągłego wygasania i dokładne granice przyszłych timestampów/90 dni. Nie skanujemy całej puli na każdą milisekundę. Końcowa selekcja buduje świeży kontekst; cache pokrycia może chwilowo niedoszacować poprawy wskutek decay. Budget Search i progi pozostają bez zmian.

## Dane i synchronizacja

Nowy lokalny klucz `office_auto_track_feedback_v1:<encoded account_id>`, osobna lokalna flaga `_enabled:<account_id>`. JSON: version=1, account, floor, mapa event ID → {trackId,at,kind}, mapa Track ID → reset timestamp. Max 512 zdarzeń, 512 resetów, 128 KiB stanu/konto. Ścisłe pola, brak nazw artystów/tokenów/payloadów/kar zapisanych jako manual value. Po limitach odmawiamy nowego zapisu, zachowujemy istniejące dane. Pruning po 90 dniach z trwałym floor zabezpiecza przed wskrzeszeniem wygasłych rekordów. Reset watermark usuwa zdarzenia o at ≤ reset; przyszłe rzeczywiste pominięcie po resecie może działać ponownie, o ile manual 👍 nie jest aktywne. Zegary urządzeń muszą być poprawne; backend toleruje do 5 min skew, większe przyszłe timestampy odrzuca. Nie rozstrzygamy intencji/causal order przy błędnych zegarach.

Lokalny zapis używa istniejącego `OmmLocalState.edit` z Web Locks i trwałym fence, bounded retry 3 po konflikcie. Import waliduje schemat/account przed zastąpieniem preferencji; eksport/import zachowuje nowe klucze, ale ich użycie wymaga zgodnego zweryfikowanego konta. Starszy klient zachowuje nieznane klucze, nie korzysta z nich.

Backend korzysta z istniejącej tabeli app_state, wiersz `(account_id, office_auto_track_feedback_v1)`. **Bez migracji SQL, nowych bindingów ani zmian LOG1/LOG2.** To osobny endpoint, poza allowlistą ogólnego `/api/state`: starszy klient nie nadpisze lub usunie nowego stanu. GET zwraca base; PUT atomowy CAS w pojedynczym SQL, 409 na concurrent insert/update/deletion. Backend scala poprawny predecessor z incoming; nie gubi starych zdarzeń przy błędzie klienta. Union po ID, konflikt payloadu tego samego ID odrzucany, reset=max, floor=max. Nieobsługiwany przyszły schemat pozostaje zachowany. Klient po 409 GET/merge/retry max 3. Nie powtarza zapisów po niejednoznacznym błędzie sieci; kolejne jawne sync jest idempotentne. Dane kont nie są przenoszone przy zmianie sesji.

Sync uczestniczy w istniejącym autosync/chmurowym zapisie, oddzielnie od manual stanu i LF2; opcjonalny błąd nie przerywa generowania. Bez auto danych/opt-in/resetów brak nowych żądań. Przy danych: memo 10 min, single-flight, timeout, 401 maks. jedno odnowienie; 429 respektuje Retry-After (maks. 1 h); inne błędy wstrzymują opcjonalny autosync na 2 min, bez pętli retry i bez raw body. Spóźniony wynik/błąd starego zapisu nie aktualizuje ani nie zatrzymuje nowej obserwacji. Sam playback pozostaje jednym wspólnym monitorem z V2. S1 IDB pozostaje lokalne i nie jest źródłem chmurowych kar.

## Weryfikacja i ryzyka

Regresje: early/middle/late i progi S1; eskalacja/decay/cap, reset, restart, exact ID/homonimy, brak artystów, opt-in/off, brak backfill, konto/public id, local collision i quota, import, CAS SQLite insert/update/delete, union/reset i stary klient, future schema, API auth/429/network, współdzielony monitor i RMF. Pełna regresja i CI obowiązkowe. Benchmark pipeline 2/4 profili, cold/warm: S1 vs S2 off, oraz syntetyczne nowe zdarzenia early/cap. Wyniki: S1 vs S2 off identyczne IDs, długość, pule i sekwencje API. Dla 2 i 4 osób, cold i warm, każdy z wariantów off / 20 utworów po jednym early / 100 utworów na cap dał 60/60 utworów, 60 wykonawców, min profilu 56,04 i 0% discovery w syntetycznej znanej bazie; Search 5 cold / 0 warm. Włączenie ocen było zweryfikowane asercją rzeczywistej kary ~−100/~−250. Nie jest to pomiar live gustu. Osobne graniczne testy dla 2 i 4 osób: kandydat z bazą grupową 36 po early −8 wypada (1→0); silniejszy z bazą 60 pozostaje (1→1); cap nie blokuje bezpiecznego fallbacku z bazą 40. Skala wpływu zależy od dostępnych bezpiecznych zamienników.

Wartości kary nie są oceną gustu konkretnej obecnej osoby; jedno współdzielone konto Spotify/Last.fm daje feedback całego konta. Krótsza playlista jest dopuszczalnym skutkiem mniejszej liczby kwalifikowalnych utworów, bez obniżania progów; zmiana nie gwarantuje poprawy live jakości lub utrzymania długości. To funkcja opt-in.

Rollback: odznaczyć auto (natychmiast usuwa wpływ), zatrzymać obserwację; ewentualnie revert tego PR. Nowe local/chmurowe dane pozostają ignorowane, ręczne oceny i S1 bez migracji wstecznej. Warunki wyłączenia/audytu: oceniony dawny test S1, kara wykonawcy, podwójne eventy, wskrzeszony reset, fałszywe skipy lub nieakceptowalne skrócenie/opóźnienie. Przed reload/revert przy aktywnych Faktach rozwiązać regulację V2.

Smoke: nagłówek v43.41.S2, stare cztery wpisy S1 bez ocen. Włączyć auto, jawnie rozpocząć nową obserwację właściwej playlisty, dwa stabilne odczyty i jeden rzeczywisty wczesny skip. Tylko nowy event oznaczony „Automatyczna kara zapisana oddzielnie”; brak manual 👎/blokady artysty. 👍 dla tego dokładnego utworu resetuje wpływ; po synchronizacji/reload nie odradza się. Do kolejnych czysto diagnostycznych prób wyłączyć auto. Po pozytywnym smoke kolejny niezależny zakres: COVER1 → COVER2.
