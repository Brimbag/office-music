# S3 — automatyczna obserwacja playlist, 1.0.11-rc

Użytkownik zatwierdził implementację oraz scalenie/wdrożenie po testach. UI ma jeden przełącznik obserwacji zamiast select/start/stop. Obserwujemy poprawny playlist context Spotify z istniejącego monitora M, także playlisty spoza OMM. Nie pobieramy ich list utworów, nazw lub właścicieli i nie zakładamy, że kolejka wskazuje oryginalną przynależność utworu. Dziennik zapisuje kontekst odtwarzania, nie dowodzi przynależności do katalogu playlisty.

Bezpieczny wariant pierwszego wdrożenia: off po reload/pagehide, brak trwałej preferencji/sesji. Włączenie wymaga zweryfikowanej istniejącej sesji; bez niej wykonuje dotychczasowe uwierzytelnienie, bez nowej usługi/scopes. Brak ręcznego wyboru playlisty, aktywne także w tle max8h od włączenia. Po wyłączeniu brak cyklicznych odczytów dla tego konsumenta; inny aktywny konsument M może nadal potrzebować odczytu. Domyślnie brak dodatkowego pollingu.

Zmiana playlisty lub urządzenia resetuje anchor, nie tworzy zdarzenia i nie wyłącza automatycznej obserwacji. Zmiana konta/sesji zatrzymuje ją. Niepełny/nieplaylist context, album/radio, podcasty/RMF, pauza/seek/luki/niejednoznaczny koniec są nadal pomijane. Reguły przedziałów, deduplikacja, lider karty, idempotentny zapis IndexedDB, 100 wpisów/30 dni pozostają. Stare `arm(playlist)` zachowane dla zgodności modułu, UI używa `armAll()`.

Generowanie pauzuje konsumenta bez przedłużania deadline; wznawia go po zakończeniu tylko przy nadal ważnej sesji i nowym baseline. Off, pagehide, deadline, zmiana konta lub błąd zapisu anulują wznowienie. Reakcja na włączenie kar S2 zatrzymuje dotychczasową obserwację jak wcześniej, aby stare pending nie naliczały ocen; przełącznik obserwacji trzeba włączyć ponownie.

## Oceny i dane

Obserwacja nie włącza kar. Osobny istniejący opt-in S2 teraz jawnie opisany jako kary na playlistach OMM. Do callbacku S2 trafia zdarzenie tylko gdy zapisany lokalny snapshot OMM ma zgodne playlist ID/URI **i dokładny Track ID/URI**. Sama nazwa lub zgodny artysta nie wystarczają. Dla obcych playlist/utworów poza snapshotem zapisujemy wyłącznie diagnostykę, nawet gdy S2 jest on. To zachowuje dotychczasowe ograniczenie do potwierdzonych snapshotów, nie jest zdalną weryfikacją własności playlisty. Zniknięcie snapshotu spośród ostatnich zapisanych może uniemożliwić naliczenie oceny; nie poszerzamy uprawnień i nie pobieramy katalogu dla obejścia tej granicy.

Bez backfillu/testowych ocen, migracji danych/D1, zmian progów/discovery/feedbacku wykonawcy/RMF lub generowania. Wpływ na rekomendacje wynika wyłącznie z wcześniej zatwierdzonego S2 dla nowych potwierdzonych zdarzeń OMM; rozszerzenie obserwacji na zewnętrzne playlisty samo nie zmienia scoringu.

## Raport U4 i walidacja

Przy okazji kopiowanie etapów ol/li i nagłówków nested details dodaje separatory nowych wierszy; nie zmienia widoku/liczników/danych raportu. Test potwierdza osobne wiersze etapów i nagłówka pomiarów.

Regresje: automatyczne contexty nieznanych playlist, granice/null/album/radio, zmiana kontekstu/device, generowanie/pause/resume/off/deadline, stary arm, nowe i powtarzane zdarzenia, przywództwo/tło/401/403/429, konto, off/reload, brak kar dla obcych playlist i zachowanie S2/👍/👎. Istniejące M/RMF testy pilnują współdzielenia odczytów. Pełne testy/CI i benchmark neutralnego generatora 2/4 cold/warm.

Rollback: revert PR bez usuwania dziennika/ocen i bez migracji; na live wyłączyć obserwację. Wycofać przy karach obcych utworów, zdarzeniach na zmianie context/device, duplikatach, pollingu po off lub naruszeniu deadline/retencji/jakości.

Smoke: 1.0.11-rc, kary S2 off na czas testu; włączyć obserwację, uruchomić dowolną playlistę Spotify, pominąć utwór po kilku stabilnych odczytach, sprawdzić dziennik. Zmienić playlistę: samo przejście nie powinno tworzyć wpisu. Off i reload kończą obserwację. Karta może być w tle. Nie uruchamiać oceny testowych pominięć. Raport generatora kopiować przyciskiem i sprawdzić nowe wiersze.
