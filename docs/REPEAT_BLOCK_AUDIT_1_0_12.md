# Audyt blokady powtórek 1.0.12 — 2026-10-16

Baza: `f8d5c1c9ac351238537cd66ad2e7257e7f1677b9` (stabilne 1.0.12,
main potwierdzony przez GitHub API). Zakres PR: audyt i regresje obecnego
kontraktu. Bez zmiany algorytmu, wersji, produkcyjnych danych, migracji,
scalenia ani wdrożenia.

## Przyczyna i granice ustalenia

**Pominięcie z automatyczną karą nie uruchamia w 1.0.12 twardej blokady
14 dni.** S2 zapisuje osobne zdarzenie i obniża punktację grupową. Filtr
powtórek czyta inną bazę: historię odsłuchów Spotify/Last.fm. Utwór z karą
może przejść kwalifikację i zostać wybrany, jeżeli nadal spełnia progi.

To rozbieżność oczekiwania z dotychczasową specyfikacją, nie dowód zgubionego
zapisu kary ani obejścia istniejącej blokady przez cache. Dokument
[S2, „Wpięcie do modelu”](AUTO_TRACK_FEEDBACK_S2.md) mówi wprost:
„Nie kierujemy auto do istniejącego fallback guard feedback ≤−40” i wyjaśnia,
że miałoby to stworzyć ukrytą blokadę. Opisuje też przypadek silniejszego
kandydata, który po pominięciu pozostaje wybrany. [Architektura](ARCHITECTURE.md)
określa historię odsłuchu jako źródło blokady; wygenerowanie listy nie jest
odsłuchem. [Wydanie stabilne](STABLE_1_0_12.md) zmienia domyślne uzbrojenie
obserwacji/kar, nie ten kontrakt S2.

Regresja odtwarza oba czasy i przedziały zgłoszenia (przy założeniu strefy
Europe/Warsaw): 15.10 17:07:42, early 7,3–13,3%, oraz 16.10 16:27:11,
middle 21,4–26,8%. Syntetyczna długość 200 s służy wyłącznie zachowaniu
tych proporcji. Dwa profile i dowody gatunkowe są syntetyczne: to nie jest
rekonstrukcja gustów ani całej produkcyjnej playlisty. Pierwsza kara wynosi
−100, przed drugim zdarzeniem około −97,8, po nim około −147,8. Wkład do
wyniku grupowego wynosi odpowiednio około −7,82 i −11,82. Żadna z tych
wartości nie jest flagą wykluczenia.

**Nie mamy eksportu historii, odpowiedzi API ani raportu generowania z tej
sesji.** Nie można ustalić, czy Spotify/Last.fm zwróciły ten odsłuch, czy
wystąpiła awaria synchronizacji, jak był ustawiony filtr ani jaki był wynik
dopasowania. Udowodniono mechanizm pozwalający na zgłoszony powrót nawet przy
poprawnym zapisie i odczycie S2. Jeżeli historia zawierała wówczas aktywny
pasujący wpis, normalna ścieżka powinna była odrzucić utwór; taki wariant ma
osobną regresję. Przyczyna braku takiego wpisu w konkretnej sesji pozostaje
niepotwierdzona.

## Siedem sprawdzeń

1. **Zdarzenie i okno.** `index.html:buildHistoryBlocklists()` (3797) wylicza
   `now − trackBlockDays × 86400000`; 14 dni jest domyślnym ustawieniem UI,
   nie stałym okresem wszystkich kar. Czyta `loadHistory()` i tylko źródła
   `spotify`/`lastfm`, według `playedAt`. Nie używa daty wygenerowania,
   zapisu kary ani aktualizacji cache. Porównanie `time >= trackCutoff`
   obejmuje dokładnie czternastą dobę; blokada ustaje 1 ms później.
   Kolejny pasujący odsłuch odnawia okres. Cooldown wykonawcy jest osobny.
2. **Pominięcia i kary.** `index.html:onEvent` w integracji
   `OfficeSkipJournal.create()` (7327–7330) sprawdza snapshot OMM i oba
   Track ID przejścia, po czym wywołuje `autoTrackFeedback.record()`.
   Nie wywołuje `mergeHistoryEntries()`/`saveHistory()`.
   `auto-track-feedback.js:add()` zapisuje early/middle;
   `score()` stosuje cap −250, half-life 30 dni i wygaśnięcie 90 dni.
   `groupTrackFeatures()` (5207, pole `autoFeedback` przy 5290) oraz
   `groupCandidateStatic()` stosują wpływ 0,08, clamp −20/+16.
   Ręczne oceny utworu mają pierwszeństwo. Kary wykonawców pozostają osobne.
3. **Dziennik S1.** `spotify-skip-journal.js:createStore()` przechowuje
   diagnostykę w IndexedDB `omm_skip_journal_v1` (`[account,id]`, do 100
   zdarzeń/30 dni). Generator jej nie odczytuje. Nie jest to źródło historii
   ani źródło backfillu S2. Late pozostaje tylko diagnostyką.
4. **Trwałość.** `auto-track-feedback.js:create()` czyta lokalny JSON per
   zweryfikowane `account_id`; zapis przez `OmmLocalState.edit`, odczyt przez
   `state()` z invalidacją memo przy zmianie surowego JSON. Reload nie usuwa
   zdarzeń. `syncAutoTrackFeedback()` (1375) scala GET/PUT z
   `functions/api/auto-feedback.js`, CAS i retry konfliktu. Flaga włączenia
   jest lokalna; dane S2 są synchronizowane osobnym endpointem, S1 nie.
   `loadHistory()`/`saveHistory()` (3549/3564) używają odrębnego
   `office_music_history_v1`, retencja 90 dni, do 1500 wpisów, mniej przy
   quota. Historia odsłuchów nie jest na allowliście ogólnego `/api/state`;
   na innym komputerze odbudowuje się z API, a nie z pełnego backupu historii.
   Regresja potwierdza zachowanie S1/S2/historii po reload.
   Nie jest to potwierdzenie zapisu do produkcyjnego D1.
5. **Wszystkie ścieżki.** `generateOfficePlaylist()` (6447) pobiera historię,
   buduje `generationBlocklists()`, a po pozyskaniu kandydatów buduje świeże
   blocklisty i kontekst. `eligibleGroupCandidates()` (5622) usuwa historię
   przed punktacją. `reuseQualifyingCache()` (6270) również korzysta z tej
   kwalifikacji; samo przechowywanie utworu w Search cache nie daje prawa
   wyboru. `getAcquisitionCoverage()` invaliduje pamięć po historii/S2/
   ustawieniach i uwzględnia granice czasu (`acquisitionCoverageExpiry()`).
   `selectGroupPlaylist()` (5860) używa tylko wejściowego `eligible`;
   normalne wybory, fallback i `OfficeDiscoveryQuota.repair()` czerpią z
   `remaining`/`safeCandidates`. Nie wczytują ponownie odrzuconych wierszy
   z puli. Starszy `collectFromQueries()` również sprawdza ID i sygnatury historii;
   główny generator go nie wywołuje.
6. **Tożsamość.** S1, snapshoty i S2: dokładny Spotify Track ID. Historia
   Spotify: ID **oraz** sygnatury. Historia Last.fm w
   `syncLastFmSources()` zapisuje puste ID i sygnaturę wykonawca–tytuł, więc
   nie jest wszędzie używany wyłącznie Track ID. Deduplikacja i ręczny
   feedback także korzystają z sygnatur. To istniejący kontrakt, którego
   ten PR nie zmienia; nie wolno łączyć nowych wydań/ID przy naliczaniu S2.
7. **Kolejność i ograniczenie.** W głównej ścieżce kwalifikacja i wybór
   następują synchronicznie po sobie, bez `await`. Sekwencjonowanie zmienia
   tylko kolejność. Nie znaleziono ponownego dodania odrzuconego utworu.
   Sam `selectGroupPlaylist()` ponownie sprawdza wykluczenia artystów i
   minimum osoby, ale **nie historię**: bezpośredni caller z kandydatem
   zakwalifikowanym przed zmianą historii może go wybrać. Regresja pokazuje
   tę lukę oraz odrzucenie po świeżej kwalifikacji. Nie ma dowodu użycia
   takiej ścieżki w zgłoszonej generacji. To ograniczenie trzeba zamknąć
   przy wprowadzaniu twardego cooldownu, zamiast zakładać ochronę selektora.

Ograniczenia źródeł historii: `syncSpotifyRecentHistoryOnce()` (3700)
pobiera jednorazowo ostatnie 50 wpisów, TTL 10 min, po błędzie zachowuje
historię i kontynuuje. Last.fm pobiera maks. 3 × 200 zdarzeń z ostatnich
14 dni, ignoruje przyszłe/niedatowane rekordy i nie gwarantuje pełnego okna
przy większym ruchu. Monitor lokalny nie domyka tych luk. Dlatego „utwór
zaobserwowany jako pominięty” nie implikuje „utwór obecny w historii API”.

## Minimalna propozycja — do decyzji, bez implementacji

Nowa reguła produktowa: **zaakceptowane early/middle S2 blokuje dokładny
Track ID na 14 × 24 h od `event.at`, niezależnie od wyniku dopasowania.**
Nie dodawać fikcyjnych odsłuchów do historii i nie czytać S1 w celu
retroaktywnego karania starych/testowych zdarzeń.

Najmniejszy wariant korzysta z już trwałych/chmurowych `events` S2:

- Dodać w module S2 odczyt aktywnych Track ID: `event.at <= now <
  event.at + 14*DAY`; ostatnie kwalifikujące pominięcie odnawia okres.
  Nie porównywać wartości kary z progiem wyniku — decay nie skraca blokady.
- Dołączyć je do osobnego zbioru wykluczeń w `generationBlocklists()` i
  sprawdzać we wspólnej kwalifikacji oraz na wejściu `selectGroupPlaylist()`
  przed utworzeniem `safeCandidates`. Tym samym chronić fallback/naprawę.
- Dodać dokładną granicę 14 dni do `acquisitionCoverageExpiry()`;
  zachować istniejącą invalidację po zmianie stanu S2. Zapewnić odczyt/
  merge S2 przed kwalifikacją na nowym urządzeniu, jeśli wymagana jest
  gwarancja między urządzeniami. Obecny opcjonalny sync, memo i błędy nie
  stanowią takiej gwarancji.
- Uzgodnić jawnie reset 👍 i wyłączenie auto. Wariant najmniej zmieniający
  kontrakt S2: reset usuwa również cooldown, a off wyłącza wpływ auto.
  Blokada obowiązująca mimo 👍/off wymaga osobnego trwałego rejestru,
  ponieważ obecny reset usuwa zdarzenia i nie da się ich odzyskać samym
  filtrem. Dotychczasowe dane S2 uruchamiałyby nową blokadę od razu;
  wyłącznie przyszłe zdarzenia wymagałyby jawnej granicy aktywacji.

Nie zmieniać identyfikacji historii Last.fm, wag gustów, progów jakości,
limitów pul, API ani kar wykonawców w tej poprawce. Nie aktywować propozycji
bez zatwierdzenia zmiany semantyki.

## Regresje

`tests/repeat-block-policy.test.mjs` odtwarza daty i zapis obu kar,
rzeczywistą kwalifikację/selekcję, restart strony z zachowaniem IndexedDB
i localStorage, odczyt Search cache i `reuseQualifyingCache()`, blokadę
z historii mimo wysokiego dopasowania, granice 14 dni (−1/0/+1 ms),
utrzymanie decay po 14 dniach, różnice ID/sygnatur oraz bezpośrednie
wywołanie selektora ze starym kandydatem.
Osobny test uruchamia `generateOfficePlaylist()` 16.10 i potwierdza przekazanie
ukaranej piosenki do zapisu nowej playlisty przy pustej historii. Zapis Spotify,
chmura i pozyskiwanie są atrapami; filtry, punktacja, wybór i snapshot są prawdziwe.

Test „skip → brak wyboru przez 14 dni” nie jest włączony jako obowiązujący
kontrakt: przeczyłby zatwierdzonej S2. Po zatwierdzeniu propozycji należy
zmienić oczekiwanie powrotu w pierwszym teście i dodać macierz
early/middle/late, reset/off/konto, dwa zdarzenia i odnowienie okna,
normalny wybór/fallback/naprawę oraz nowy klient po chmurowym merge.
Scalenie tego audytu nie oznacza zatwierdzenia nowej reguły.
