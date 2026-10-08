# v43.9.F — tożsamość wykonawców i migracja preferencji

## Problem i zakres

Dwa Spotify Artist ID o tej samej nazwie były traktowane jak jeden wykonawca w feedbacku, wzorcach, cooldownie, tagach Last.fm, deduplikacji i limicie utworów. Regresja używa dwóch **syntetycznych**, różnych ID dla „Days of the New”. Nie ustalono jeszcze rzeczywistych ID obu katalogów; liczba miesięcznych słuchaczy nie jest dowodem tożsamości.

Spotify ID jest teraz kluczem wykonawcy; nazwa pozostaje etykietą i wskazówką wyszukiwania. Sygnatura nagrania łączy ID wykonawcy z dotychczasowym kanonicznym tytułem, więc różne wydania tego samego artysty nadal się deduplikują. Współwykonawcy mają własne klucze. Kara <= −40 dowolnego z nich wyklucza duet, ale nie przypisuje kary pozostałym.

Wyszukiwanie Spotify nadal korzysta z nazw, w istniejącym budżecie. Zgodna nazwa w wyniku wyszukania nie daje automatycznie bonusu wzorca ani dowodu z Last.fm. Limit dwóch utworów, progi jakości, wagi dowodów gatunkowych, quota discovery i RMF pozostają bez zmian. PR #5 nie został włączony do tej gałęzi.

## Dane i odczyt

Nowy, pojedynczy klucz `office_artist_identity_v2` zawiera wersjonowany dziennik jawnych decyzji:

- `link:seed:<profil>:<nazwa>` — konkretny Spotify wykonawca dla wzorca;
- `link:blocked:<profil>:<nazwa>` — konkretny wykonawca dla dawnej ręcznej listy blokad;
- `link:lastfm:<nazwa>` — osobno potwierdzone powiązanie katalogu Last.fm ze Spotify;
- `link:legacy-block:<nazwa>` — rozstrzygnięcie dawnego feedbacku 🚫;
- `legacy-feedback:<stara sygnatura>` — osobno przypisana dawna ocena konkretnego nagrania lub jawne pozostawienie jej w archiwum;
- `feedback:<sygnatura ID>` i `block:<Spotify klucz>` — nowe oceny i blokady;
- `rotation:<Spotify klucz>` — rotacja potwierdzonych wzorców.

Nowy feedback zachowuje `trackId`, tytuł, obiekty `{id, name}` wszystkich wykonawców i datę. Brak ID uniemożliwia zapis nowej oceny/blokady; nie zastępujemy go nazwą. Czytniki starych rekordów bez ID zachowują oddzielną nazwową przestrzeń; takie rekordy nie dowodzą tożsamości Spotify.

Stare `office_music_feedback_v1`, blokady, listy wzorców i rotacja pozostają w oryginale. Samo potwierdzenie wzorca nie migruje ocen ani Last.fm. Dawny dodatni feedback nie premiiuje automatycznie Spotify ID. Nierozstrzygnięta dawna blokada lub silna kara nazwowa powoduje ostrożne wykluczenie kandydatów z tą nazwą, **bez zapisania im kary**. Odrzucenia z nierozstrzygniętego ujemnego feedbacku mają osobny licznik; dawne blokady są widoczne w odpowiednim liczniku blokad i panelu powiązań.

Historia Spotify posiadająca ID używa wyłącznie tych ID i Track ID. Nie zestawiamy po indeksie osobnych tablic `artistIds` i `artistNames`. Last.fm bez potwierdzenia pozostaje nazwowym źródłem historii: odpowiednie odsłuchane utwory i wykonawcy są konserwatywnie chronieni przed powtórką. Po potwierdzeniu mostu historia dotyczy wskazanego ID. Wygenerowane playlisty nadal nie są odsłuchami.

MBID i URL dostarczone przez Last.fm są zachowywane w lokalnych agregatach. Nie tworzą same mostu do Spotify. Last.fm może łączyć homonimów na jednej stronie: użytkownik powinien potwierdzić wyłącznie znany katalog. Agregaty Last.fm nadal są nazwowe po stronie źródła; PR nie obiecuje oczyszczenia już wymieszanych tagów.

## Przebieg migracji i warunki wdrożenia

1. Przed wdrożeniem wykonać eksport z każdej używanej przeglądarki. Nie czyścić puli ani D1.
2. Najpierw na kopii bazy sprawdzić liczbę powiązań wymagających potwierdzenia oraz generowanie dla 2 i 4 profili. **Bez potwierdzonych mostów Last.fm wyniki mogą znacznie się skrócić, a nawet pozostać puste**: stare tagi nie są już pewnym dowodem dla każdego Spotify ID o tej nazwie. Nie maskować tego obniżaniem progów.
3. W panelu „Rozróżnianie wykonawców i dawne preferencje” wyszukać nazwę. Kandydaci z lokalnej puli pokazują ID, przykładowy utwór oraz link do katalogu Spotify. Można również wskazać Spotify Artist ID/link ręcznie. Nie ma automatycznego wyboru najpopularniejszego artysty ani dodatkowego pobierania katalogu API.
4. Potwierdzić osobno wzorzec, blokady i most Last.fm. Dawne oceny przypisywać do konkretnego nagrania z puli, sprawdzając wykonawców i link. Jeśli brak odpowiedniego nagrania, pozostawić ocenę nierozstrzygniętą; nie dopasowywać jej do przypadkowego ID. Można jawnie pozostawić ocenę wyłącznie w archiwum, nadal zachowując v1.
5. Potwierdzenia zapisują się atomowo w jednym kluczu. Nie jest wykonywana zbiorcza automatyczna migracja wszystkich nazw, nawet gdy w aktualnej puli występuje tylko jeden ID.
6. Sprawdzić synchronizację decyzji i konfliktów w drugiej przeglądarce, a następnie ponownie eksportować bazę v1+v2.

**Nie wykonano tego procesu na produkcyjnej bazie użytkownika. PR pozostaje do przeglądu, a produkcyjny wpływ na długość wymaga osobnego testu na kopii danych.**

## Synchronizacja i import

Dziennik zachowuje zdarzenia z unikalnym ID i odwołaniami do wcześniejszych decyzji. Merge łączy zdarzenia; konkurencyjne przypisania pozostają konfliktem, nie wybieramy zwycięzcy po dacie. Jawne rozstrzygnięcie obejmuje wcześniejsze gałęzie. Usunięcie oceny/blokady jest zdarzeniem z `null`, więc dawny snapshot jej nie odtwarza. Sprzeczne oceny z ujemnym głosem są ostrożnie wykluczane do rozstrzygnięcia. Niepoprawny lub niepełny dziennik zatrzymuje odczyt zamiast wracać do zgadywania nazw.

D1 wykorzystuje istniejącą tabelę `app_state`. **Brak SQL migracji, nowych tabel, zmiany `account_id` lub konfiguracji produkcyjnej.** Dodano jeden klucz do obu allowlist. PUT tego klucza wymaga `identityBase`; warunek SQL chroni przed zmianą pomiędzy odczytem a zapisem. Stara baza daje 409; frontend pobiera i scala ponownie, maksymalnie trzy próby. Zapisane w międzyczasie zmiany lokalne nadal oczekują kolejnego autosync. Stare klienty pomijające nowy klucz nie usuwają jego rekordu.

Ochrona przed konfliktami dotyczy rejestru tożsamości, nie zmienia dotychczasowej polityki synchronizacji innych kluczy. Przy konflikcie wykrytym dopiero w batch pozostałe klucze mogą już zostać zapisane; rejestr v2 nie jest nadpisywany, a klient ponawia scalanie. Potwierdzone na rzeczywistym SQLite oraz izolowanym lokalnym Miniflare D1, ze Spotify mockowanym.

Limit 32 kluczy, 1,5 MiB na wartość i 2 MiB na payload pozostaje. Frontend sprawdza rozmiar rejestru i całego PUT; przekroczenie zatrzymuje zapis/sync bez czyszczenia preferencji. Dziennik jest addytywny i rośnie: jego bezpieczna kompakcja nie wchodzi w ten PR. Do synchronizacji dochodzi odczyt `/api/state` przed PUT, czyli także dodatkowa autoryzacja `/me` na serwerze; budżet wyszukiwań muzyki nie rośnie.

Import JSON v1 nadal działa. Rejestr v2 scala się z obecną historią decyzji zamiast być zastępowany starym snapshotem. Ponowny import jest idempotentny. Po częściowym zapisie zakończonym błędem quota importer próbuje przywrócić całą wcześniejszą bazę. Eksport obejmuje oba formaty; tokeny pozostają poza kopią.

## Testy i wpływ na długość

Pełny zestaw: `npm test`, Node >=22.13 (CI Node 24), Chromium. Nowe regresje obejmują homonimów, duet, alias tego samego ID, osobne limity, progi −39/−40/−41/−55, wszystkie ścieżki selekcji, feedback, wzorce, Last.fm, E1, historię, blokady, panel, konflikty, tombstones, import v1, quota, rozmiar PUT i rzeczywisty SQL CAS z wyścigiem zapisów oraz rozdzieleniem kont.

Kontrolowana pula z jawnie potwierdzonymi danymi, cel 12:

| Scenariusz | 2 profile | 4 profile |
|---|---:|---:|
| Dwa ID o tej samej nazwie, osobne limity i właściwe dowody | 12 | 12 |
| Ujemny feedback ID A, brak bezpiecznych zamienników | 10 | 10 |
| Ujemny feedback ID A, dostępne bezpieczne zamienniki | 12 | 12 |

ID B pozostaje dostępny, limit każdego ID wynosi dwa, a wyniki zachowują progi jakości. To dowód na stałej puli testowej, **nie prognoza 60/60 dla rzeczywistej bazy**. Usunięcie fałszywych dowodów/bonusów może skracać wynik, a rozdzielenie limitów i cooldownów może go wydłużać.

## Wycofanie

Warunki: przeniesienie oceny między ID, przepuszczenie zablokowanego ID, nieodtwarzalny konflikt synchronizacji, utrata danych/importu albo nieakceptowalne skrócenie po prawidłowym przypisaniu dowodów.

Przed cofnięciem eksport v1+v2 ze wszystkich przeglądarek. Cofnięcie kodu/API przez revert PR przywróci v43.8.E1; żadnego DELETE w D1 ani czyszczenia `office_artist_identity_v2`. Stary kod nie czyta nowych ocen v2: pozostają w kopii/rejestrze, lecz nie wpływają na rekomendacje do ponownego wdrożenia F. Revert przywraca także wcześniejsze ryzyko homonimów; nie używać cofnięcia jako migracji nowych ocen do nazw v1. Powrót do F scala zachowane zdarzenia i tombstones.
