# Q1.2 — celowane pozyskiwanie, 1.0.2-rc

## Problem i zakres

Na przekazanych eksportach Q1.1 statyczny generator odtwarza 38/60, 6 discovery, 59 kwalifikowalnych / 54 bezpiecznych kandydatów. Offline maksymalizacja liczby utworów z limitami wykonawców i sygnatur również daje 38. Pozyskiwanie zużyło 12/12 Search, ale liczba kwalifikowalnych wykonawców nie wzrosła (33→33). To uzasadnia zmianę kierowania zapytań, nie progów selekcji.

Dotychczas ostatni etap zestawiał zapytania wspólnych gatunków przed wykonawcami z lokalnej bazy Last.fm. Przy zerowym pokryciu gatunek wygrywał remis i mógł wykorzystać pozostałe trzy Search. Teraz tylko ten etap oznacza zapytania wykonawców jako preferowane. Istniejący mechanizm nadal odrzuca blokowanych, wykonawców z karą ≤−40, tych z dwoma kwalifikowalnymi sygnaturami oraz zapytania już sprawdzone lub z kompletnym świeżym cache. Wśród preferowanych zapytań mniejsze pokrycie ma pierwszeństwo; pozostałe zapytania gatunkowe są fallbackiem.

Nie zwiększamy Search ani liczby wywołań Last.fm, liczby kandydatów zapytań, limitów pul czy limitu utworów wykonawcy. Wczytanie opłaconego cache nadal następuje przed wyszukiwaniem. Primery artystów wzorcowych i gatunków zachowują wcześniejsze rankingi. Wyszukiwanie jest spekulatywne: brak nowych legalnych utworów oznacza brak wydłużenia. Nie ma gwarancji 60/60 ani poprawy średniej na każdej rzeczywistej grupie.

## Zabezpieczenia i testy

Selekcja, minimum 35 każdej osoby, kara wykonawcy, discovery, cooldowny, rozpoznawalność, retencja i RMF nie zmieniają kodu. Sześć nowych testów porównuje poprzedni ranking z nowym na identycznych danych: 2/3/4 osoby, jedno Search, 2→4 utwory, identyczne średnie i brak naruszeń minimum oraz limitu wykonawcy. Dodatkowo brak dostępnych wykonawców, świeży cache wykonawców i zerowy budżet. Pełny zestaw zawiera wcześniejsze regresje współwykonawców, −40, minimum 35, discovery 0/100 i granic quota, OAuth i błędów API.

Eksporty użytkownika są wyłącznie prywatnymi wejściami offline, poza repozytorium. Statyczna selekcja bez nowych odpowiedzi musi nadal odtwarzać 38/60. Pełny mock Search nie jest odtworzeniem katalogu Spotify i jego wyników nie przedstawiamy jako produkcyjnej poprawy. Wyniki pełnych testów i CI są odnotowane w PR.

## Wycofanie i kolejny krok

Revert tego PR przy systematycznym skracaniu playlist, pogorszeniu dopasowania lub naruszeniu budżetu/warunków. Brak migracji D1 i nowych kluczy danych; istniejące pule mogą zawierać utwory pozyskane przez nową kolejność, nadal podlegają identycznym filtrom i TTL.

Po smoke produkcyjnym porównać długość, średnie/minima osób, liczbę kwalifikowalnych wykonawców przed/po oraz Search. Kolejny osobny zakres: koszt kwalifikacji cache (historyczny pomiar ~20,8 s exclusive). Najpierw pomiar identycznych wejść przy kontrolowanym stanie karty; potem ograniczenie powtórnej pracy z testem identycznych ID, wyników i liczby API. Wersja następna 1.0.3-rc.
