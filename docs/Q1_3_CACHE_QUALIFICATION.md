# Q1.3 — kwalifikacja cache, 1.0.3-rc

## Przyczyna i zmiana

Raport produkcyjny 1.0.2-rc: generowanie 39,9 s, kwalifikacja nowych pozycji cache 16,1 s exclusive, dwa wywołania, zero wniesionych kandydatów. Ten czas nie jest pomiarem CPU. Cache jest wcześniej opłaconym źródłem i nie może być po prostu wyłączony.

`reuseQualifyingCache` kwalifikował wszystkie istniejące rekordy razem z nowymi, a potem odrzucał istniejące oraz kandydatów bez miejsca wykonawcy. Q1.3 kwalifikuje tylko nowe rekordy, które mogą zostać zaakceptowane. Pominięcie nasyconego wykonawcy, współwykonawcy lub już obecnej sygnatury jest bezpieczne: licznik wykonawcy podczas tego synchronicznego przebiegu może tylko rosnąć.

Pełne `existing + additions` nadal tworzy kontekst punktacji oraz źródło zwykłych wersji do kanonizacji. Kwalifikacja otrzymuje osobny, opcjonalny argument `canonicalRows`, domyślnie identyczny z poprzednim `rows`. Dzięki temu pominięcie zbędnego scoringu nie usuwa dowodów wpływających na remastery, gatunki lub ocenę innych rekordów. Gdy nie ma żadnego kandydata z miejscem, końcowy indeks wersji jest odtwarzany z istniejącej puli, jak poprzednio. Wybór, sortowanie i retencja zaakceptowanych nowych rekordów nie zmieniają się. Odbudowa końcowego indeksu wersji w ścieżce cache korzysta z jednego świeżego snapshotu Last.fm zamiast wczytywać i przeszukiwać bazę osobno dla każdego utworu. Snapshot zachowuje pierwsze wystąpienie zduplikowanej nazwy i nie jest używany między wywołaniami ani przez await. Samo pominięcie zbędnego scoringu w pierwszym pomiarze nie przyspieszyło generowania; dominował właśnie ten indeks.

## Weryfikacja

Porównanie poprzedniej funkcji z nową na tych samych danych, zegarze i RNG: nasycenie wykonawcy, istniejące ID, nasycony współwykonawca, alternatywne ID tej samej sygnatury, mieszana pula przyjętych/odrzuconych oraz remaster z istniejącym zwykłym wydaniem. Wymagamy identycznej puli, ID, ocen, discovery oraz końcowych sygnatur. W scenariuszach bez miejsca nowy przebieg nie kwalifikuje rekordów; w mieszanym kwalifikuje mniej rekordów przy pełnym kontekście kanonizacji.

Prywatny eksport użytkownika porównujemy poza repozytorium w izolowanym Chromium z zamkniętym transportem. Pełny mock API nie odtwarza katalogu Spotify: służy do porównania poprzedniej i nowej funkcji na identycznych odpowiedziach. Sprawdzamy ID, selekcję, diagnostykę, kolejne żądania i końcowe pule. Wyniki i ograniczenia pomiaru w PR. Jeden mierzony przebieg nie stanowi statystyki p95 produkcji ani gwarancji przyspieszenia na każdym komputerze.

Nie zmieniamy rankingu Q1.2, API/budżetów, progów, feedbacku, discovery, limitów pul ani RMF. Brak migracji D1. Rollback: revert PR, bez migracji danych. Przy różnicy ID/ocen/retencji na identycznym wejściu wycofać optymalizację.

## Kolejny etap

Po smoke produkcyjnym: osobna diagnoza skuteczności pozyskiwania z uwzględnieniem nasycenia wykonawców i przyczyn odrzucania nowych odpowiedzi (Q1.4, 1.0.4-rc). Najpierw mierniki per zapytanie i porównanie na tych samych danych, bez zwiększania budżetu i strojenia progów. Nie wdrażać kolejnego rankingu bez dowodów. Priorytet może ulec zmianie, jeśli po Q1.3 pozostanie inne dominujące źródło opóźnień.
