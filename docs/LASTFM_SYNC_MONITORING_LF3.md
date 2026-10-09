# v43.31.LF3 — monitoring Spotify → Last.fm

## Diagnoza i model kont

Last.fm Spotify Scrobbling jest usługą Last.fm. OMM nie może odnowić jej autoryzacji ani potwierdzić jej stanu administracyjnego. Korzystamy z zatwierdzonego modelu jednej pary kont: zalogowane Spotify oraz skonfigurowana nazwa Last.fm. Diagnostyka dotyczy tej pary, nie osób zaznaczonych do playlisty. Zmiana konta wymaga nowych obserwacji; żadnych automatycznych przypisań starych historii do profili.

Spotify scope `user-read-recently-played` już istnieje. Odczyt `/me/player/recently-played?limit=50` daje ID, tytuł, wykonawców, długość i `played_at`; nie daje procentu rzeczywistego odsłuchu ani pełnego dziennika. Last.fm `user.getRecentTracks` daje wykonawcę, tytuł i `date.uts`; now-playing bez daty pomijamy. Timestampów nie traktujemy jako identycznych: tolerancja wynosi długość Spotify + 2 minuty, najwyżej 12 minut. To bufor dla różnic początku/końca, nie dowód naturalnego zakończenia. Odczyty nie pozwalają odróżnić wszystkich skipów i niescrobbowalnych odsłuchów.

## Logika i ograniczenia

Pure `lastfm-sync.js` zwraca healthy / insufficient_data / suspected_issue / api_error / not_configured. Świeżość obu obserwacji: 15 minut, historia porównania: ostatnie 6 godzin, z pominięciem ostatnich 30 minut. Podejrzenie wymaga końcowej serii minimum pięciu braków, rozciągniętej na minimum 30 minut. Dopasowanie późniejszego utworu przerywa serię. Pojedynczy brak i brak aktywności Spotify nie alarmują. Healthy oznacza obserwowane dopasowania, nie gwarancję kompletności wszystkich scrobbli.

Dopasowanie: pierwszy wykonawca, tytuł i czas, najbliższy pasujący scrobble, każdy wykorzystany najwyżej raz. Normalizacja NFKC, wielkość liter, odstępy, końcowe standardowe remastery / album version / `(feat. …)` lub `(ft. …)`. Live, Rework, cover, różne nagrania nie są automatycznie scalane. Odmienne aliasy wykonawców i nietypowe tytuły mogą ograniczać trafność; komunikat mówi o możliwej przerwie, nigdy o pewnej awarii.

Niepełne Last.fm oceniamy tylko po najstarszym odczytanym wpisie + 12 min bufora. Nie oceniamy Spotify sprzed najstarszego wpisu aktualnej odpowiedzi. Jeżeli lokalne przycięcie historii usunęło część zaobserwowanych scrobbli, zwracamy insufficient_data. Błąd API pozostaje osobnym stanem. Stare wpisy bez `sourceAccount` są zachowane dla dotychczasowej aplikacji, ale nie stanowią dowodu diagnostycznego.

## Odczyty, UI i przechowywanie

Przy logowaniu kontrola działa w tle, po istniejącej synchronizacji preferencji z chmurą. Korzysta z istniejących funkcji synchronizacji historii: maksymalnie 3 strony Last.fm i 1 odczyt Spotify, bez pobierania tagów. TTL historii wynosi 10 minut; ponowne generowanie wykorzystuje te dane/cache zamiast powielać odczyty. Równoczesne żądania Last.fm i Spotify współdzielą wynik. Błędy historii Spotify są izolowane i mają dwuminutowy backoff. Ręczne sprawdzenie omija TTL/backoff. Nie ma timera ciągłego odpytywania ani nowego OAuth scope.

Po istniejących etapach historii generator odświeża sam status bez dodatkowych żądań. Normalna selekcja, scoring, progi, feedback, discovery, limity kandydatów, RMF i cooldown nie zostały zmienione. Aktualizacja historii może oczywiście poprawić aktualność istniejących blokad odtworzonych utworów.

Status i link naprawy widoczne w pasku integracji; przyciski kontroli i zamknięcia w „Narzędzia i dane”. Ostrzeżenie można zamknąć na 24 godziny; przesuwające się okno 50 utworów nie tworzy kolejnych alertów. Potwierdzone dopasowania usuwają wcześniejsze ostrzeżenie. Link: https://www.last.fm/settings/applications. OMM nie nazywa sprawdzania naprawą.

Do istniejącej lokalnej historii dodajemy tylko `sourceAccount` i `durationMs`; nie tworzymy drugiej kopii historii. Osobne małe rekordy zawierają świeżość obserwacji Spotify oraz zamknięcie ostrzeżenia. Brak nowych zapisów D1, SQL, tokenów w diagnostyce ani migracji produkcyjnej. Rollback: revert PR; poprzedni klient ignoruje nowe metadane, preferencje i historia pozostają dostępne.

## Weryfikacja

Deterministyczne testy pokrywają zgodność, serie braków i granice czasowe, opóźnienie, wersje tytułów, dopasowanie jeden-do-jednego, duplikaty, niepełne/stare/przyszłe dane, izolację kont, zamknięcie/24h/odzyskanie. Testy przeglądarkowe sprawdzają rzeczywistą synchronizację, brak powielania żądań, błędy obu API i zmianę konta podczas oczekiwania. Pełna regresja oraz benchmark generatora wymagane przed scaleniem.
