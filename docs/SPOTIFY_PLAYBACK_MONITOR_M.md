# M — wspólny monitor odtwarzania Spotify

Wersja **v43.36.M**. Infrastruktura tylko do odczytu, bez regulacji głośności, automatycznych ocen, zmian rekomendacji, kolejki/harmonogramu RMF i migracji D1. Podstawą był zatwierdzony projekt wspólnego monitora. Produkcyjny smoke test LOG1/LOG2 z 2026-10-11 pozostaje pozytywny; migracji dziennika nie ponawiamy.

## Audyt i integracja

Obecny watcher RMF sprawdza publikację odcinka w istniejących oknach, z dotychczasowym limitem częstotliwości. Nie jest monitorem przebiegu odtwarzania. `getSpotifyPlaybackState` zachowuje kontrakt używany przez RMF (`available`, `isPlaying`, device/context/item URI), korzystając teraz ze wspólnego odczytu `/me/player?additional_types=track,episode`. Dodanie odcinka do kolejki nadal nie oznacza rozpoczęcia odtwarzania. Dwa diagnostyczne GET kolejki, POST dodania i reguły wyboru regularnych Faktów pozostają bez zmian.

Oba OAuth scopes `user-read-playback-state` i `user-modify-playback-state` już są zadeklarowane; M ich nie zmienia. Odczyt 403 nie dowodzi uprawnień istniejącego tokena, a samo desktop Spotify nie dowodzi obsługi głośności. Nie wykonano rzeczywistego PUT player ani odczytu urządzenia użytkownika w ramach implementacji/testów.

`spotify-playback-monitor.js` zawiera niezależny rdzeń, scheduler i koordynację kart. Snapshot jest niemodyfikowalny i ograniczony do konkretnych pól: kontekst konta/sesji, ID/URI/typ elementu i show ID, urządzenie, playing, progress/duration, volume/supportsVolume/active/restricted (brakujące możliwości są null), czasy rozpoczęcia i otrzymania oraz ciągłość obserwacji. Unknown/local/brak ID, urządzenia, postępu lub kontekstu nie stanowią podstawy pewnego wnioskowania. Rdzeń nie rozpoznaje intencji pominięcia ani samych Faktów po tytule.

## Aktywacja i budżet

**W PR M nie ma uzbrojonych konsumentów. Zero dodatkowego cyklicznego GET odtwarzania po wdrożeniu.** RMF wykonuje dotychczasowe odczyty na żądanie. Single-flight łączy równoległe odczyty tej samej instancji; cache ma najwyżej 1 sekundę i tylko udane odpowiedzi. Odczyt z `fresh:true` omija cache, lecz nie trwające żądanie ani backoff. Nie korzystamy ze starego urządzenia po błędzie.

API dla przyszłych osobnych PR-ów: `subscribe(name, listener, {active:true})` jest jawnym uzbrojeniem pollingu. Domyślnie subskrypcja jest pasywna; zwrócona funkcja usuwa konsumenta. Dwóch aktywnych konsumentów otrzymuje identyczny snapshot. Listener otrzymuje też `{leader}` — karta obserwująca nie ma uprawnienia do przyszłych efektów ubocznych. Sam ten znacznik nie zastępuje dzierżawy/intentów głośności ani idempotentnego zapisu feedbacku, które należą do V/S.

Podczas odtwarzania na urządzeniu interwał wynosi co najmniej 5 s (do 12 zwykłych cyklicznych GET/min łącznie), podczas pauzy/braku urządzenia/błędu co najmniej 30 s. Pierwszy odczyt po uzbrojeniu jest natychmiastowy. Retry po 401 i świadome odczyty na żądanie/konfirmacje liczymy osobno; nie obiecujemy globalnego limitu całej aplikacji ani bezpiecznej stałej liczby dla Spotify. Przyszłe włączenie V/S zwiększy ruch względem M, który nie polluje.

Generowanie playlisty, ukrycie karty, pagehide, logout i zmiana sesji wstrzymują pętlę, anulują odczyt i unieważniają ciągłość. Powrót nie nadrabia zaległych cykli. Przy blokadzie lokalnego stanu scheduler zatrzymuje się bez kolejnego GET; ponowne uzbrojenie/wake jest konieczne po usunięciu blokady. Brak nowych background GET kolejki, katalogów RMF, Search lub Last.fm.

## Koordynacja i ciągłość

Web Locks wybiera lidera na tym samym origin/konto. Oba tryby, także fallback bez Web Locks, korzystają ze **wspólnej atomowej dzierżawy IndexedDB**: `omm_playback_coordination_v1`, store `leases`, owner i expiry 15 s, odnowienie przy ticku co 5 s. Dzięki wspólnej bramce także karty o różnych możliwościach nie tworzą dwóch pętli. IndexedDB nie przechowuje playback, tokenów, historii ani ocen; nie jest częścią eksportu/D1. Brak dostępu do koordynacji zatrzymuje polling, pozostawiając pasywny helper RMF.

BroadcastChannel przekazuje wyłącznie znormalizowany bieżący snapshot dla danego konta, nie surowy payload ani token. Odbiorca sprawdza konto i świeżość, odbudowuje whitelistę i nie uznaje ciągłości lidera za własną. Bez BroadcastChannel lider nadal odpytywałby sam; pozostałe karty nie dostają streamu do czasu przejęcia. Zmiana lidera, device/context, seek, pauza, luka >10 s, błąd i zmiana zegara unieważniają anchor. Zmiana Track ID przy ciągłych, świeżych obserwacjach nie jest sama w sobie dowodem ręcznego pominięcia.

Te mechanizmy nie koordynują drugiej przeglądarki/komputera ani nie rozwiązują istniejącego kolejkowania RMF między niezależnymi klientami. Pasywne żądania RMF w różnych kartach nie są globalną kolejką operacji; koordynacja dotyczy automatycznej pętli. Zatrzymanie procesu/uśpienie nie gwarantuje wykonania kodu anulowania; spóźnione odpowiedzi i preflight są odrzucane na podstawie czasu/sesji. W V nadal potrzebna będzie ochrona przed pozostawieniem podwyższonej głośności.

## Błędy i sesja

Odczyt ma deadline 5 s obejmujący preflight, fetch i JSON. 401 uruchamia istniejący współdzielony OAuth PKCE i ponawia tylko GET maksymalnie raz; drugi 401 zatrzymuje automatyzację do ponownego zweryfikowania sesji. Definitywne odrzucenie refresh tokenu korzysta z obecnego logout; przejściowy błąd nie usuwa sesji. Nie zapisujemy tokenów ani raw błędów w diagnostyce.

403 i QUOTA_EXCEEDED zatrzymują automatyzację. 429 stosuje Retry-After (sekundy lub data); bez nagłówka używa backoff 30 s z jitter i narastaniem do 5 min. 5xx/sieć/timeout/nieprawidłowy payload przerywają ciągłość i stosują backoff. Żaden błąd nie powoduje play/pause/transfer/volume/queue. Odrębna diagnostyka RMF pokazuje wyłącznie status, liczniki GET i przerwę, bez nazw/ID elementów i urządzeń.

Zmiana tokenu w innej karcie może oznaczać nowe konto. Prywatne porównanie aktualnego tokenu ze zweryfikowaną sesją chroni też okno przed dostarczeniem zdarzenia storage; porównywana wartość nie trafia do snapshotu, przekazu ani diagnostyki. Snapshot zostaje anulowany, a następny pasywny odczyt wymaga jednego współdzielonego potwierdzenia `/me`. Odpowiedź profilu/odtwarzania dla nieaktualnej sesji nie może przypisać odczytu poprzedniemu kontu. Zwykła rotacja tokenu w tej karcie zachowuje sesję monitora. Publiczne `id/account_id` frontend wykorzystuje tak jak dotąd; backendowy kontrakt i preferencje nie są migrowane.

## Weryfikacja, ograniczenia i rollback

Testy fake clock: normalizacja/null/capabilities/typy, single-flight/cache/deadline, 204/401/403/429/QUOTA/5xx/sieć/nieprawidłowy JSON, backoff, urządzenie/kontekst/pauza/seek/gap, stare odpowiedzi/sesja, whitelisty przekazu, zero polling, 12 cyklicznych GET/min dla dwóch konsumentów, 30 s podczas pauzy, hidden/resume/generation oraz wznowienie w czasie anulowanego żądania.

Chromium: adapter/OAuth i zachowanie refresh tokenu, brak default pollingu, dwie karty Web Locks/lease/mieszane/bez kanału, zamknięcie lidera i expiry, brak koordynacji, zmiana konta podczas identyfikacji, logout, dotychczasowa kolejka RMF (1 player GET, 2 queue GET, 1 queue POST), brak zmiany preferencji/feedbacku oraz brak modułu. Pełne `npm test`, CI i benchmark wymagane przed scaleniem. M nie zmienia długości/jakości playlist; test porównawczy obejmuje 2/4 osoby i cold/warm.

Weryfikacja lokalna: **560/560 testów**, w tym 53 nowe monitora. Porównanie z main `780d16a`: 2/4 osoby, cold/warm, identyczne dane/zegar/losowanie; cztery razy 60 utworów, identyczne ID/kolejność, selekcja, stan pul i żądania API (nie porównujemy czasu wykonania mocków). Zero `/me/player` podczas generatora przy nieuzbrojonych konsumentach. Fixture jest testem izolacji, nie prognozą długości playlist na rzeczywistej bazie.

Rollback: revert PR M, powrót do starego odczytu playback i poprzedniej wersji nagłówka. Nie usuwać wpisów generation_logs, preferencji ani historii, nie ponawiać SQL. Lokalna dzierżawa wygasa po 15 s i jest ignorowana przez starszy kod. Wycofać przy dodatkowym default pollingu, pętlach 401/429, jednoczesnych aktywnych liderach, świeżym odczycie przypisanym złemu kontu, naruszeniu queue/RMF albo zmianie playlist.

Kolejny osobny zakres: **V — opcjonalna względna głośność Faktów**. Najpierw potwierdzić na urządzeniu użytkownika supports_volume/Premium/scopes i zaakceptować best-effort przywrócenie po zamknięciu karty; mock nie zastępuje tego testu. Gain +10% (0–20%), cap podbicia 70%, bez ściszania baseline ≥70; ręczna zmiana i inne urządzenie mają pierwszeństwo. Automatyczny feedback S1/S2 i jego zasady wygasania pozostają późniejszym, osobnym projektem.
