# S3.1 — nazwy w dzienniku i stabilizacja, 1.0.12-rc

Zatwierdzony PR stabilizacyjny z małą poprawką dziennika; scalenie/wdrożenie po testach. To kandydat przed krótkim smoke i osobną decyzją o wydaniu stabilnym, bez zmian algorytmu.

Monitor M zachowuje z istniejącego playback GET opcjonalny tytuł (do300 znaków) i do5 nazw wykonawców (do160 znaków każda). Wyłącznie track, bez pól albumu/OAuth/URL-i lub pełnej odpowiedzi Spotify. Puste, zbyt długie i kontrolne wartości pomijamy. BroadcastChannel odtwarza tę samą whitelistę, nie przyjmuje dowolnych metadanych. Brak dodatkowego API, pollera, scopes lub zmian ciągłości odtwarzania.

S1 zapisuje opcjonalny `display:{name,artists}` z **poprzedniego**, pomijanego TrackID. Nazwy są tylko prezentacją, nie identyfikacją: link i feedback nadal używają dokładnego SpotifyID. Lokalny IndexedDB ma istniejącą wersję1 i tabelę; optional field nie wymaga migracji. Odczyt sanitizuje metadata; uszkodzony display nie unieważnia prawidłowego zdarzenia. Starsze wpisy pozostają bez zmian, bez backfillu/nowych zapytań. Starszy klient ignoruje display. W UI nazwa zdarzenia ma pierwszeństwo, dalej dotychczasowy snapshot OMM, na końcu TrackID. Renderowanie przez textContent, nie HTML.

Nazwy pozostają na komputerze w ograniczonym dzienniku100/30dni; nie trafiają do localStorage eksportu, D1 ani stanu feedbacku S2. Nie naliczamy ocen za stare/testowe wpisy; zakres S2/S3, deadline, pause/resume, progi, discovery i RMF pozostają.

## Odnotowane smoke

Użytkownik potwierdził S3: trzy nowe prawdopodobne pominięcia, obserwacja zatrzymana, kary off, dawny dziennik zachowany. ID bez nazw dotyczą playlist spoza OMM, nie błędu identyfikacji. U4 kopiuje pełny raport; S3 poprawił separatory. Seria Q1.9/Q1.10: prawidłowe wyniki2/3/4 profili, udane uczenie przy stabilnym kontekście, poprawna quota i chmura. Q1.7 obniżanie priorytetów nadal potwierdzone automatycznie, nie zaobserwowane live. Te smoke nie dowodzą globalnego optimum/długości na dowolnej bazie.

Regresje: bounds/whitelist, podcast/missing labels, współdzielony snapshot, poprzedni vsnastępny utwór, prawidłowy starszy event, lokalny zapis/reload obcej playlisty, brak dodatkowego API, S2 nie przenosi metadanych; pełne testy/CI i neutralny generator2/4 cold/warm. Rollback revert bez czyszczenia dziennika lub migracji. Wycofać przy błędnym przypisaniu nazw, ujawnieniu danych, regresji odczytu starych wpisów/ocen lub dodatkowych API.

Smoke: 1.0.12-rc, kary off, obserwacja on, playlista spoza OMM, po stabilnych odczytach pominąć utwór. Nowy wpis ma tytuł/wykonawców, link wskazuje pomijany utwór, „Bez naliczenia oceny”. Starsze ID pozostają dopuszczalne. Off/reload kończy obserwację; ręczne odświeżenie dziennika pokazuje zachowane nazwy. Po tym decyzja o stabilnym wydaniu; P5/T1/F4/E.2 pozostają zaparkowane i wymagają osobnych zakresów.
