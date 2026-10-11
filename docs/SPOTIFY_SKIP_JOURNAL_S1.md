# S1 — v43.40.S1: dziennik prawdopodobnych pominięć

## Zakres i aktywacja

Osobny PR po pozytywnym smoke V2. Użytkownik potwierdził test regulacji (powrót głośności, zatrzymanie monitora; końcowy odczyt 58%, 2 zmiany i 3 odczyty potwierdzające) i autoryzował scalenie/wdrożenie S1 po testach.

S1 jest wyłącznie diagnostyczny. Nie tworzy ocen, nie nalicza kar, nie czyta ani nie zmienia ręcznego feedbacku, statystyk wykonawców, blokad, progów, discovery ani algorytmu selekcji. Nie steruje Spotify, nie dodaje elementów do kolejki i nie zmienia volume V2. Zdarzenia S1 nie są zgodą na późniejsze automatyczne naliczenie kar; S2 wymaga osobnego opt-in i projektu danych, bez automatycznego backfillu z diagnostyki.

Panel „Narzędzia i dane → Prawdopodobne pominięcia — diagnostyka”: jawny wybór jednej z trzech zapisanych playlist OMM i „Rozpocznij obserwację”. Wymagane ID/URI Spotify oraz lista dokładnych Track ID ze snapshotu, aktualnie zweryfikowane konto/sesja. Samo członkostwo w dowolnej dawnej playliście nie wystarcza. Brak nowych GET playlisty ani historii; jawny lokalny snapshot jest źródłem monitorowanego kontekstu, nie weryfikacją właściciela playlisty przez API.

Domyślnie off po otwarciu/reloadzie, bez automatycznego wyboru playlisty. Sesja do zatrzymania lub maks. 8 h. „Zakończ obserwację”, pagehide, logout/zmiana sesji, generowanie i zmiana urządzenia kończą sesję. Dane diagnostyczne pozostają. Lokalna awaria zapisu zatrzymuje zbieranie, nie usuwa innych danych. Obserwacja działa na przypiętej karcie także w tle; uśpienie/throttling nie daje prawa do odtwarzania brakujących zdarzeń.

## Mechanizm i ograniczenia

`spotify-skip-journal.js` korzysta z konsumenta `skip-journal` istniejącego M (`active:true, background:true`). Brak własnej pętli HTTP, nowych scopes i usług. V2 i S1 dzielą single-flight, scheduler 5 s/30 s, Web Locks/atomową dzierżawę/BroadcastChannel oraz backoff/OAuth. Brak S1/V2 sesji oznacza brak dodatkowego cyklicznego odpytywania. S1 sam nie wykonuje dodatkowego read ani żadnego write Spotify. Koordynacja nie obejmuje innych przeglądarek/komputerów; używać jednej sesji sterującej.

Dziennik dopuszcza A→B wyłącznie gdy oba są Track ID/URI z wybranej playlisty, kontekst URI dokładnie zgodny, playing=true, znany aktywny ten sam device i konto/sesja, aktualna prowadząca karta. Typ episode/RMF, local/unknown/brak ID, poza playlistą, nieznany progress/duration i utwory ≤30 s są wykluczone. Błędny/pusty odczyt, pauza, follower/przejęcie lidera, seek, zmiana kontekstu i luki resetują anchor. Nowe A wymaga dwóch zgodnych obserwacji, odstęp do 10 s, stabilizacja co najmniej 1 s. Krótkie dodatkowe odczyty V2 nie zastępują stabilizacji. Deduplikacja observationId, serializacja odbioru i ID instancji playback zapobiegają powtarzaniu zdarzenia. Kolejne rzeczywiste odtworzenie tego samego ID dostaje nową instancję.

Szacowany przedział pozycji przy przejściu uwzględnia progress A, monotoniczny odstęp, latencję obu żądań i margines 2 s. Musi w całości mieścić się w jednej kategorii: early <20%, middle 20%–<70%, late ≥70%. Gdy przedział przecina granicę, zapis pomijamy. Upper bound musi być wcześniej niż duration−12 s (margines naturalnego końca/crossfade); sprzeczny postęp B również odrzucamy. Kontrola świeżości ≤1 s, zgodności zegarów i latencji ≤5 s nie pozwala zapisywać z zaległej odpowiedzi. Po luce >10 s nie inferujemy przejścia — stabilizujemy nowy utwór.

Spotify API nie ujawnia intencji kliknięcia „Dalej”. Seek do końca i zmiana źródła między pollami mogą pozostać niewidoczne; autoplay, Automix i crossfade ograniczają pewność. Zapis jest **prawdopodobnym** pominięciem, nigdy gwarantowanym ręcznym skipem. Obserwowany seek wyklucza przejście; nie obiecujemy wykrywania przewinięć, których API nie pokazało. Konserwatywne filtry mogą pominąć wiele rzeczywistych pominięć — to akceptowalne w S1.

## Dane, bezpieczeństwo i retencja

Oddzielna lokalna baza IndexedDB `omm_skip_journal_v1`, store `events`, compound key `[account,id]` i index account. Event zawiera wyłącznie version=1, account, id instancji, Track ID, Playlist ID, at, durationMs, fromMs, toMs i kind. Bez score/penalty, nazw/ID wykonawców, urządzeń, tokenów, surowych payloadów lub error body. Store waliduje kategorię/przedział, ID/URI engine, czas i scope, odbudowuje whitelistę. Nie dopisuje żadnego klucza synchronizacji/D1 ani eksportu JSON. UI przypomina, że dziennik pozostaje na tym komputerze. Reload zachowuje wpisy, ale odrzuca anchor.

Append jest pojedynczą atomową transakcją z deduplikacją ID, deterministycznym sortowaniem czas/ID i max. 100 zdarzeń na konto. Widok obejmuje ostatnie 30 dni; wygasłe wpisy fizycznie usuwa kolejny poprawny append. Brak aktywności nie uruchamia sprzątającego HTTP ani tła. Nie nadpisujemy kolizji ID z innym eventem. Quota/abort zachowuje poprzedni dziennik. Nieobsługiwany przyszły schemat lub znacząco przyszły timestamp blokuje append, bez usuwania danych. Read/list jest account-scoped, a późne wyniki po logout/zmianie konta nie aktualizują widoku nowej sesji. IDB nie jest trwałą chmurową kopią; wyczyszczenie danych witryny usuwa dziennik.

Przyjęte zdarzenie, którego lokalna transakcja zaczęła się przed stop/logout, może dokończyć zapis w starym koncie. Nie naliczy licznika nowej sesji i nie pokaże starych wpisów nowemu kontu. Kolejne spóźnione snapshoty mają odrzucany epoch. Równoległe karty z tym samym event ID zapisują jeden wpis; zmiana lidera nie przenosi anchoru.

## Testy, wpływ i rollback

Unit: early/middle/late, granice 20%/70%, naturalny koniec/crossfade, brak stabilizacji, pauza/seek, device/context/session/leader, błędy API, brak ID/progress, RMF/podcast, krótkie utwory, luki/clock, sprzeczny progress B, duplikaty/race/replay/reload, wygaśnięcie sesji, storage failure, late store i brak score. Chromium: rzeczywisty shared monitor i IndexedDB, default off/selector, zapis i reload, whitelist i izolacja kont, idempotencja/retencja, rollback transakcji, zachowanie future schema, hidden timer, współpraca V2 oraz brak modyfikacji localStorage/feedbacku i Spotify writes przez S1. Pełny `npm test`, CI i porównanie generowania 2/4 profili na zimnych/ciepłych pulach.

Długość i jakość playlist nie powinny się zmienić, ponieważ algorytm nie korzysta z dziennika. Nowe GET playback występują tylko po ręcznej aktywacji; dzielone z V2, nie podwajane. Wycofanie: zatrzymać obserwację i revert PR; nowa baza zostaje zachowana i ignorowana, bez migracji i bez odwracania ocen. Jeżeli jednocześnie działają Fakty, przed reload/revertem rozwiązać ewentualny intent V2. Fałszywe pozytywy w smoke lub niekontrolowany wzrost GET są warunkiem wyłączenia S1 i audytu przed S2.

Smoke: v43.40.S1, wybrana zapisana playlista OMM faktycznie odtwarzana z jej kontekstu w desktop Spotify, uruchomić obserwację. Odczekać dwa odczyty (ok. 10–15 s), pominąć wcześnie utwór (<20% i daleko od progu), sprawdzić jeden wpis Track ID i brak ręcznej oceny. Pauza, naturalny koniec i Fakty nie powinny tworzyć wpisów. Stop kończy konsumenta S1; V2 może pozostać aktywny niezależnie. Kolejny krok dopiero po obserwacji jakości detekcji: osobny projekt S2, bez automatycznego użycia wcześniejszych wpisów S1 do kar.
