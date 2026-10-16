# Odczyt historii odsłuchów i końcowa kontrola przed zapisem

Baza audytu: stabilne 1.0.13, `93844adf3c57bbef53cd5a94c213bc9c01e999c9`.
Zakres: zgodny odczyt istniejącego `office_music_history_v1`, scalanie oraz
egzekwowanie blokady po odtworzeniu. Bez zmiany wag, minimum osoby,
fairness/xQuAD/MMR, discovery, limitów/API i mechanizmu pominięć.
PR nie upoważnia do scalenia ani wdrożenia.

## Potwierdzone błędy implementacji

Odniesienia do linii dotyczą bazowej wersji 1.0.13:

1. `index.html:3594–3604`, `loadHistory()`: walidacja poprzedzała
   `compactPlayedHistoryItem()`. Datowany wpis Last.fm z nazwą i wykonawcą,
   bez Spotify ID i bez wyliczonej sygnatury, odpadał przed normalizacją.
   `saveHistory()` (3609) miało tę samą kolejność. Nowy odczyt najpierw
   normalizuje bezpieczne pola, następnie kwalifikuje potwierdzony odsłuch.
2. `compactPlayedHistoryItem()` (3574) przekazywało niepoprawne typy do
   normalizacji. Jeden rekord z obiektem zamiast tytułu i obecnym ID
   powodował wyjątek; zewnętrzny catch `loadHistory()` zamieniał całą
   historię na pustą. Normalizacja odtąd sprawdza typy pól pojedynczego
   rekordu. Niepoprawne pole nie usuwa pozostałych poprawnych odsłuchów.
3. `mergeHistoryEntries()` (3725) kluczowało surowe rekordy przed
   normalizacją. Dwa bez ID/sygnatury, z tym samym czasem i źródłem,
   dostawały klucz `unknown|czas|źródło`. Teraz oba otrzymują właściwą
   sygnaturę przed deduplikacją.
4. `generateOfficePlaylist()` (6609–6618): po `await createPlaylist()`
   końcowy guard sprawdzał wyłącznie osobny rejestr pominięć. Odsłuch
   dopisany do historii podczas oczekiwania nie zatrzymywał `addItems`.
   Przed zapisem ponownie odczytywane są blokady odsłuchów i pominięć.
   W razie zmiany lista nie jest wysyłana; pojawia się jawny komunikat.

`historyBlocksTrack()` współdzieli istniejące dopasowanie ID/sygnatury
między selektorem i końcową kontrolą. Nie zmienia normalizacji nazw.
`buildHistoryBlocklists()` wymaga teraz poprawnego JSON-tablicy historii:
uszkodzona cała wartość blokuje generowanie zamiast udawać pustą historię.
Widok historii nadal może wyświetlić diagnostykę bez przerwania startu UI.

## Granice wniosków o zgłoszonej playliście

Analizę prywatnego backupu i pełnej listy wykonano lokalnie. Nie są one
częścią repozytorium ani fixture'ów. Istniejące kanoniczne wpisy dla pięciu
zgłoszonych przykładów przechodzą czytnik 1.0.13 i uruchamiają blokadę.
W minimalnych odpowiednikach wszystkie pięć testów przechodziło już przed
poprawką. **Nie dowodzi to, że wymienione błędy brzegowe spowodowały incydent.**

Backup wcześniejszy niż generowanie nie jest snapshotem wejścia generatora.
Różne liczniki źródeł historii w backupie i raporcie wskazują różnicę stanu,
ale nie wyjaśniają jej przyczyny. Dla konkretnego utworu narzędzie oddziela:
potwierdzone dopasowanie/czas, oczekiwane wykluczenie, decyzję filtra na
podanych danych oraz brak dowodu dostępności tego wpisu podczas generowania.
Nie przypisuje bez dowodu winy fallbackowi, cache ani kwocie storage.

## Sprawdzona ścieżka danych

`generateOfficePlaylist()` przed doborem wywołuje
`refreshLastFmBeforeGeneration()` i `syncSpotifyRecentHistory()`.
Spotify: ostatnie 50 wpisów, TTL 10 min. Last.fm: maks. 3 × 200 w 14-dniowym
oknie; wynik częściowy nie gwarantuje pełnego pokrycia. Historia jest
wspólna dla jednej pary kont Spotify/Last.fm, a nie pobierana osobno dla
każdego profilu obecności. Nie wprowadzamy takiej nowej integracji.

`mergeHistoryEntries()` zachowuje źródła Spotify/Last.fm osobno, a duplikaty
tego samego źródła, tożsamości i daty scala. `saveHistory()` zachowuje do
1500 najnowszych zdarzeń, mniej przy quota; ten limit nie daje gwarancji
pełnych 14 dni. Nie zmieniamy go ani nie zwiększamy zapytań w tym PR.

`generationBlocklists()` → `eligibleGroupCandidates()` wyklucza historię
przed punktacją; po pozyskiwaniu jest świeży odczyt. `selectGroupPlaylist()`
ponownie sprawdza historię; fallback i naprawa discovery używają wyłącznie
bezpiecznej puli. Cache pozyskiwania/pokrycia uwzględnia historię i granice
czasu. Nowy guard zamyka również okres oczekiwania na utworzenie playlisty.

Blokada pozostaje twarda przez 14 × 24 h, niezależna od 👍 i wyłączenia kar.
Wygenerowanie playlisty nie jest odsłuchem. Zachowana jest wdrożona reguła
kwalifikujących pominięć z [1.0.13](TRACK_COOLDOWN_1_0_13.md); opis jej jako
wyłącznie punktowej kary w nowym zleceniu jest rozbieżny z ostatnią decyzją
produktową. Ten PR nie zmienia jej po cichu.

## Lokalny audyt całej playlisty

```sh
node scripts/audit-play-history.mjs --backup /lokalnie/backup.json \
  --playlist /lokalnie/raport.txt --out /lokalnie/audyt
```

Obsługiwane: wklejony raport OMM, snapshot JSON, Spotify JSON `tracks.items`
oraz backup z `office_recent_playlists_v1`. Przy wielu snapshotach konieczne
jest `--playlist-id ID` lub jawne `latest`. JSON bez czasu wymaga
`--generated-at 2026-10-16T20:41:25+02:00`; `added_at` nie jest czasem
generowania. Czas polskiego raportu jest przeliczany przez Europe/Warsaw;
niejednoznaczny czas zmiany DST wymaga jawnego offsetu.

Raport tekstowy nie dostarcza Track ID playlisty. Narzędzie może odzyskać
listę współwykonawców po dokładnym nagłówku z katalogu backupu, ale nie
udaje, że ID kandydata jest ID utworu faktycznie wybranego do playlisty.
Nowe pliki zawierają JSON, CSV wszystkich pozycji i CSV naruszeń okna.
Odsłuchy późniejsze niż generowanie nie są liczone jako naruszenia.

Opcjonalne porównanie z oryginalnymi regułami bez sieci:

```sh
git show 93844ad:index.html > /lokalnie/index-1.0.13.html
node scripts/audit-play-history.mjs --backup /lokalnie/backup.json \
  --playlist /lokalnie/raport.txt --baseline-rules /lokalnie/index-1.0.13.html \
  --out /lokalnie/audyt
```

`--baseline-rules` przyjmuje wyłącznie zaufany lokalny kod aplikacji.
Narzędzie wykonuje w izolowanym VM funkcje produkcyjnego czytnika i
normalizacji. Backup/playlisty są danymi JSON/tekstem, nigdy kodem.
Nie ma żądań sieciowych ani dostępu do produkcyjnych API/D1. Wyniki mogą
zawierać prywatną historię — nie commitować ich do repozytorium.

## Regresje i ręczna weryfikacja

`play-history-audit.test.mjs`: pięć minimalnych przypadków, Spotify/Last.fm,
brak ID/sygnatury, uszkodzony rekord/JSON, scalanie równoczesnych odsłuchów,
2/13/14 dni, przyszłe daty, samo członkostwo playlisty, Unicode, remaster,
radio edit/album version/featuring, brak fałszywego dopasowania innych
tytułów/wykonawców, świeża historia i cache oraz wyścig przed zapisem.
`play-history-cli.test.mjs`: audyt, strefa czasu/DST, wiele snapshotów,
ignorowanie późniejszych odsłuchów, pochodzenie ID, CSV i różnice stanów.

Przed poprawką pierwsze 22 testy: 18 poprawnych, 4 błędne. Pięć zgłoszonych
minimalnych przypadków: 5/5 poprawnych już w 1.0.13. Po poprawce pierwsze
22: 22/22; pełny wynik rozszerzonej walidacji podany w PR.

Ręcznie: przed generowaniem wykonać nowy lokalny eksport, zachować czas i
wyeksportować wynik; uruchomić narzędzie dla tego samego origin/profilu
przeglądarki. Sprawdzić brak wybranych utworów z aktywnymi potwierdzonymi
odsłuchami. Nie kasować historii/cache i nie naliczać testowych pominięć.
Sprawdzić źródła i obserwacje Last.fm/Spotify. Jeśli historia zmieni się
podczas zapisu, komunikat ma zatrzymać dodanie utworów; może pozostać
pusta playlista Spotify, tak jak przy dotychczasowym guardzie pominięć.
