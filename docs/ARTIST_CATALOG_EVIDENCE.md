# Diagnostyka dopasowania Spotify–Last.fm — v43.12.F3

## Zakres

To drugi etap po rollbacku ręcznego wiązania wykonawców i po blokadach ID z PR #11. Nowy moduł `artist-catalog-evidence.js` automatycznie porównuje całą dostępną lokalną bazę. Raport uruchamia przycisk „Porównaj lokalną bazę” w panelu Last.fm; odpowiedni fragment raportu pojawia się również po wybraniu „Nie ten wykonawca”. Nie trzeba przypisywać poszczególnych artystów. Raport pokazuje katalogi, dowody tytuł/album, propozycje i przyczyny nierozstrzygnięcia. Podsumowanie obejmuje całą bazę, a widok listy ogranicza się do 100 wyników; filtr nazwy pozwala znaleźć dowolnego wykonawcę bez przeglądania listy.

**Diagnostyka nie aktywuje powiązań.** Nie wpływa na dobór, punktację, rozpoznawalność, discovery, limity wykonawcy, historię, feedback, wzorce ani RMF. Nie przenosi ocen, nie odwołuje blokad i nie zmienia stanu Spotify. Nie wyszukuje dodatkowych kandydatów w API. Brak innego ID w lokalnej puli oznacza brak porównania tego katalogu, a nie potwierdzenie jedynego widocznego ID.

## Dowody i reguły

Źródłem są ważne rekordy lokalnych pul Last.fm, pula Spotify i ostatnie trzy snapshoty. Snapshoty bywają pozbawione albumów — takie rekordy dostarczają jedynie tytułów. Nazwa służy do ograniczenia zbioru porównania, nigdy sama nie uzasadnia propozycji. Popularność i miesięczni słuchacze nie są kryterium identyfikacji.

Propozycja wymaga co najmniej dwóch różnych tytułów solo, z odpowiadającymi im albumami zgodnymi w obu źródłach, oraz braku drugiego lokalnego ID tej nazwy z choć jednym zgodnym tytułem solo. Zgodność u kilku ID daje nierozstrzygnięcie bez wybierania „najlepszego” wyniku. Tytuły utworów współwykonawców są pokazywane jako słaby sygnał, nie dowód właściciela katalogu. Niepełna lista ID współwykonawców nie jest uznawana za solo.

Porównanie zachowuje akcenty, znaki tytułów i oznaczenia alternatywnych wersji, w tym Rework, live i wersje orkiestrowe. Normalizuje wyłącznie NFKC, wielkość liter i odstępy; nie stosuje stratnej kanonizacji używanej do deduplikacji playlist. Album dłuższy niż 300 znaków nie jest dowodem — nie porównujemy obciętych wspólnych prefiksów. Ponieważ dotychczasowy klucz puli Last.fm usuwał część znaków, nowe dowody zachowują oryginalną nazwę i tytuł; muszą one pasować do aktualnego rekordu.

Kilka MBID artysty, ten sam MBID nagrania pod różnymi tytułami albo obcięta historia dowodów dają `lastfm_ambiguous`. Zgodność katalogu zgłoszonego przez użytkownika jako niewłaściwy daje `negative_conflict`, bez propozycji i bez odblokowania. Zgłoszenie nie uprawnia do automatycznego wybrania dowolnego drugiego ID. „Nie lubię” może współistnieć ze zgodnością repertuaru — katalog pozostaje zablokowany.

## Dane i plan migracji

Nie ma migracji preferencji, D1, schematu lub konfiguracji. Istniejące rekordy pozostają użyteczne dla obecnego generatora. Nowe pola są opcjonalne i zbierane przy dotychczasowym pobieraniu Last.fm:

- Cache `tag.getTopArtists` zachowuje poprawny MBID. Cache `tag.getTopTracks` i `user.getRecentTracks` zachowuje album i poprawne MBID artysty/nagrania.
- Pula wykonawców dodaje `catalogMbids`, maksymalnie cztery, oraz znacznik obcięcia historii.
- Pula utworów dodaje `catalogEvidence`: oryginalną nazwę i tytuł, album i MBID, maksymalnie cztery różne rekordy, oraz znacznik obcięcia historii.

Odpowiedź bez albumu/MBID nie usuwa wcześniej zachowanego dowodu. Stary cache nie otrzymuje zmyślonych danych. Nie wykonujemy dodatkowego pobrania ani backfillu: odpowiednie pola pojawią się przy zwykłym odświeżaniu. Limity pul i TTL pozostają dotychczasowe. Dane Last.fm pozostają lokalne i są objęte istniejącym eksportem/importem, nie nowym kluczem chmurowym. Zapis quota zachowuje poprzednią wartość. Archiwum F v2 jest ignorowane i zachowane.

Przed kolejnym etapem aktywacji należy zebrać raporty na rzeczywistej bazie: pokrycie, przypadki nierozstrzygnięte, sprzeczności z „nie ten wykonawca” i ręcznie zweryfikowaną próbkę zarówno propozycji, jak i braków. Dopiero osobny PR może wykorzystywać sprawdzone powiązania do gatunków lub wyszukiwania. Migracja dawnych ocen po nazwach wymaga odrębnej, jawnej decyzji; nie może być skutkiem propozycji.

## Pokrycie i trafność

Raport podaje liczbę nazw Last.fm, nazw z katalogiem Spotify, liczbę ID, homonimy, propozycje i pokrycie `propozycje / nazwy Last.fm`. Brak danych daje 0%, bez dzielenia przez zero. Sprzeczności z jawnymi zgłoszeniami są osobnym licznikiem. **Pokrycie nie jest trafnością.** `verifiedFalseMatchRate` pozostaje `null`: bez zweryfikowanych etykiet na live nie deklarujemy skuteczności. Testy kontrprzykładów zapobiegają znanym pomyłkom, ale nie dowodzą poprawności dowolnych katalogów.

Starsza baza może początkowo dawać bardzo mało propozycji: brakuje albumów, lokalnego repertuaru właściwego Spotify ID albo są różnice między wydaniami. Konserwatywne nierozstrzygnięcie jest zamierzone. Last.fm sam może mieszać homonimów; zgodność dwóch piosenek i albumu również nie jest dowodem pełnej tożsamości. Aktywacja automatycznego przypisania pozostaje wyłączona.

## Regresje, długość i wycofanie

Testy obejmują dwa ID „Days of the New”, brak dowodów poza nazwą, tylko jeden utwór, drugi ID ze zgodnym repertuarem, duplikaty scrobbli, różne wydania, niespójne MBID, współwykonawców, zgłoszony błędny katalog, alternatywne wersje, oryginalne pisownie, kolejność danych, cold start, brak API, stronicowanie Last.fm, quota i bezpieczne wyświetlanie tekstu.

Kontrolowane dane dla dwóch i czterech profili przed/po metadanych i diagnostyce dają identyczne 12 utworów, identyczne oceny i diagnostykę selekcji; każda osoba ma średnią 56,04. Nie jest to pomiar playlist live. Budżet dla celu 60 pozostaje 12 wyszukiwań Spotify i 24 wywołania tagowe Last.fm. Nowe porównanie jest lokalne i nie wywołuje API.

Rollback: revert tylko tego PR-a oraz nowy numer nagłówków/modelu/eksportu. Opcjonalne pola można zostawić — wcześniejszy kod ich nie wykorzystuje. Blokady ID z PR #11 nadal obowiązują. Nie kasować D1 ani preferencji. Wycofać przy zmianie punktacji lub doboru, utracie cache/preferencji, blokowaniu pracy przez raport albo prezentowaniu niejednoznacznego wyniku jako pewnego. Zwiększony rozmiar lokalnego cache jest ryzykiem, objętym ograniczeniem liczby dowodów i regresją quota. Raport korzysta tylko z bazy danej przeglądarki; wyniki na dwóch komputerach mogą się różnić.
