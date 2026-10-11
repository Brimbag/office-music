# Q1.4 — skuteczność Search, 1.0.4-rc

## Problem i zachowanie

Smoke Q1.3 dał 46/60 utworów w 17,4 s. Z 12 nowych stron Search tylko Haken i Halsey dostarczyły wybrane utwory (po dwa). Pięć stron miało pusty cache po filtracji nazw; dotychczas nie można było odróżnić pustej odpowiedzi Spotify od odrzucenia wszystkich wyników przez OMM. Odtworzenie końcowej kwalifikacji wskazało także nieskuteczne zapytania metalowe, ale nie było pomiarem przy otrzymaniu odpowiedzi.

Q1.4 dodaje pomiary, bez zmian zapytań, paginacji, kolejności losowania, kwalifikacji, rankingu, retencji, feedbacku, discovery, RMF i budżetu API. Nie jest poprawką długości playlist. Numeracja następnego wydania: 1.0.5-rc.

## Dane i znaczenie

W panelu „Szczegóły techniczne” każda faktycznie wykonana operacja `searchTracks` pokazuje etap, źródło Spotify/cache, zapytanie, offset, status, liczbę surowych wyników, `tracks.total`, liczbę wyników po filtracji pól artist/track i odrzuceń tego filtra. Nowe/aktualizowane rekordy są unikalnymi Spotify Track ID w danej stronie, liczonymi przed retencją. Wyniki bez ID/URI nie są dodawane. Powtórzenie ID nie zwiększa liczników rekordów.

Końcowe pola: rekordy zachowane w puli, bezpieczni kandydaci (w tym nowe rekordy), różni kwalifikowalni wykonawcy (w tym nieobecni w początkowym pokryciu), wybrane utwory oraz pierwszy powód odrzucenia podczas istniejącej końcowej kwalifikacji. Wykonawcy obejmują wszystkich współwykonawców zgodnie z istniejącym `trackArtistKeys`; nie jest to liczba wolnych miejsc w playliście. Bezpieczny kandydat nie musi zostać wybrany: nadal obowiązują duplikaty, limit dwóch utworów, discovery i zamówiona długość.

Wkład stron może się nakładać: nie sumować liczby bezpiecznych/wybranych jako globalnego przyrostu. „Nowi wykonawcy” oznacza różnicę względem początkowego kwalifikowalnego pokrycia, nie pierwszy wpis wykonawcy w bazie. „Wybrane” oznacza wynik selekcji OMM, nie potwierdzenie zapisu w Spotify — status generowania osobno pokazuje błędy zapisu.

Powody odrzuceń dotyczą końcowego stanu po pozyskiwaniu. Nie kwalifikujemy ponownie każdej strony podczas wyszukiwania. Rekordy usunięte przez retencję nie dostają zgadywanego powodu filtra: różnicę widać między liczbą unikalnych wyników a „w puli”. Przy przerwaniu przed końcową kwalifikacją panel wyraźnie pokazuje, że jest nieukończona. Błąd transportu/HTTP nie udaje pustego sukcesu. Retry 401/429 pozostają jedną operacją Search, a dotychczasowy licznik żądań pokazuje wszystkie próby.

Zbiorcze czytanie wszystkich stron cache w `primeDiverseQueries` pozostaje w istniejącym liczniku stron cache; nie generuje osobnego wiersza dla każdego odczytu. Nowy panel opisuje operacje `searchTracks`, a nie wszystkie sprawdzenia cache/TTL. Limit 120 wierszy i 240 znaków zapytania ogranicza rozmiar UI; pominięte wiersze są policzone jawnie.

## Zgodność, prywatność i koszt

Nowy cache dopisuje tylko małe metadane liczbowe `{raw,total}` obok istniejących `savedAt/items`. Stare klienty ignorują to pole. Stary cache pozostaje ważny, a nieznane surowe liczby/total mają `?`, zamiast fałszywego zera. Brak pola items/total w odpowiedzi Spotify również oznacza wartość nieznaną; nie zmieniamy istniejącej obsługi takiej odpowiedzi przez generator. Brak migracji cache lub D1, wzrostu limitów puli, nowych zapytań albo dodatkowej kwalifikacji. Liczniki nowych rekordów wykorzystują mapę już używaną przy zapisie puli, a powody odrzuceń zbierane są w istniejącym końcowym przebiegu.

Szczegóły są efemeryczne: widoczne w tej karcie i `lastGenerationReport.searchEffectiveness`, resetowane na nową próbę, znikają po zamknięciu strony. Nie zapisujemy ich do localStorage, D1, LOG1/LOG2, eksportu preferencji ani konsoli. LOG1 nadal stosuje jawną listę pól zbiorczych i dotychczasowy schemat. Nie przechowujemy tokenów, nagłówków, treści błędów API ani pełnych surowych odpowiedzi. Eksport istniejącego cache zawiera wyłącznie nowe metadane liczbowe obok wcześniej przechowywanych wyników.

## Weryfikacja

- Pusta odpowiedź vs odrzucenie wszystkich nazw; `Mars Volta`/`The Mars Volta` bez zmiany filtra.
- Cache legacy/nowy bez API, wartości nieznane, pierwsze powody filtrów, retencja, ID duplikatów, współwykonawcy i próg bezpiecznej selekcji.
- Retry 401 + 429: jeden wpis diagnostyki, jeden budżet Search, dotychczasowa liczba rzeczywistych żądań; błąd sieci bez cache sukcesu.
- Ograniczenie pamięci, reset między próbami, brak szczegółów/sekretów w chmurowym LOG i eksporcie preferencji.
- Porównanie Q1.3/Q1.4 dla 2/4 osób: identyczne ID, punktacja, kolejność, pule, statystyki selekcji i transport. Fixture zawiera wyłącznie kod poprzedniej wersji, bez danych użytkownika.
- Pełne `npm test`, standardowy benchmark generowania oraz Q1 audit smoke CI.
- Pełne odtworzenie prywatnego eksportu z ustalonym zegarem i atrapami API: Q1.3/Q1.4 dają po 43 utwory i 12 Search; identyczne ID, kolejność, punktacja, statystyki, trzy kompletne pule oraz transport (zapytania/offsety). Q1.4 zapisuje 12 wierszy diagnostyki. To test zgodności, nie wynik produkcyjny ani pomiar wydajności. Dane eksportu pozostają poza repozytorium.

Smoke użytkownika: sprawdzić nagłówek `1.0.4-rc`, wygenerować playlistę i skopiować sekcję „Skuteczność Search” ze szczegółów technicznych. Nie usuwać starego cache dla testu; `?` jest poprawne. Przy samych trafieniach zbiorczego cache możliwy jest brak nowych wierszy Search.

## Rollback i następny etap

Revert całego PR przywraca poprzednie zachowanie UI i wersję; dodatkowe liczbowe metadane cache są ignorowane przez Q1.3. Nie wymaga kasowania preferencji/puli ani migracji. Wycofać, jeśli diagnostyka zmieni wynik generowania, liczbę API, powoduje błędy runtime lub istotny dodatkowy koszt.

Po smoke: osobny Q1.5 — paginacja zaczynająca nieznany katalog od offsetu 0 i rotująca w potwierdzonym zakresie `tracks.total`. Potem Q1.6 — potwierdzona tożsamość/nazwa artystów wzorcowych, bez luźnego łączenia ocen; Q1.7 — rotacja nieskutecznych zapytań po pomiarach. Nie należą do Q1.4.
