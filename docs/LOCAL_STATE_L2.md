# L2 — synchronizacja kart i konflikty, v43.28.L2

## Zachowanie

Dotychczas ankieta zapisywała cały profil ze swojej kopii w pamięci. Druga karta mogła w ten sposób nadpisać nowsze oceny innej osoby. Moduł local-state.js udostępnia teraz edit oraz subscribe. Zapis ankiety i pól ręcznych generatora korzysta z tej samej blokady Web Locks co import. Bez Web Locks edycja jest odrzucana; zalecana aktualna przeglądarka i HTTPS. Nie dodajemy nowych kluczy preferencji, formatu eksportu ani kontraktu D1.

Przeglądarkowe cache localStorage mogą być chwilowo starsze nawet po uzyskaniu Web Lock. Dla edytowanych kluczy moduł zapisuje w istniejącym IndexedDB backup lokalne metadane edit:<klucz> z poprzednią i następną wartością. Odczyt ostatniego zapisu pozwala rozpoznać stary cache: moduł czeka do 500 ms na aktualizację, a jeśli jej brak, odrzuca zapis konfliktem. Metadane są zapisywane przed setItem; awaria zapisu preferencji przywraca poprzednie metadane. Są wyłącznie lokalne, nie zawierają OAuth, nie trafiają do eksportu ani D1. Awaria IndexedDB zatrzymuje edycję przed zmianą preferencji. Przerwanie między metadanymi a setItem prowadzi do zachowawczego konfliktu, nie automatycznego zastosowania niezapisanej oceny.

Zapis ankiety porównuje bazę widoczną w karcie, zamierzoną zmianę i aktualny zapis. Różne osoby/gatunki są scalane; sprzeczna zmiana tego samego gatunku kończy się jawnym konfliktem. Nie ma automatycznego zwycięzcy. Ankieta pokazuje Zapisywanie i czasowo blokuje kontrolki podczas transakcji. Przeglądarka ostrzega przed nawigacją z rozpoczętym zapisem; użytkownik może świadomie opuścić stronę bez gwarancji zakończenia zapisu. Karta odczytuje aktualne oceny, a użytkownik może świadomie ponowić wybór. Usunięcia pojedynczych ocen są częścią merge. Wyczyszczenie osoby sprawdza dodatkowo cały jej zestaw ocen, aby nie usunąć nowych ocen dodanych w drugiej karcie. Zewnętrzne usunięcie magazynu zatrzymuje zapis starszej kopii.

Zdarzenia storage odświeżają ankietę oraz liczniki i pola generatora. Generator zachowuje obecność, rozwinięte sekcje i niezapisane drafty pól ręcznych. Konflikt draftu wzorców/blokad/ręcznych gatunków nie nadpisuje nowszej wartości; pokazuje błąd i odczytuje aktualną wartość. Lokalne zapisy przez moduł wysyłają również zdarzenie do tej samej strony. Cloud merge odświeża istniejące kafelki, zamiast zerować wybór obecności przez renderProfiles. Debounce istniejącego autosync zbiera zmiany z ankiety, kiedy generator jest zalogowany.

Generowanie i ręczna synchronizacja czekają na rozpoczęte zapisy pól generatora. selectedProfiles odświeża pola bez draftu i nie przepisuje wartości, które już są zapisane. Nie zmieniono selektora, progów, punktacji, limitów ani budżetu API.

## Import, zgodność i ograniczenia

Marker pending importu blokuje edycję również w drugiej karcie. Aktualizacja widoku jest wstrzymana do usunięcia markera, aby nie wyświetlać częściowego importu. L1 nadal zapewnia kopię i odzyskiwanie przed startupem. Należy zamknąć inne karty na czas importu: starsze klienty i wcześniejsze operacje generowania nie respektują nowych blokad. L2 nie czyni localStorage atomowym magazynem wszystkich danych aplikacji.

Ochrona Web Locks obejmuje współpracujących klientów L2 zapisujących ankietę/pola ręczne oraz import L1/L2. Starsze klienty i bezpośrednie zapisy mogą zostać wykryte przez odczyt bieżącej wartości, ale nie da się zagwarantować ich serializacji. Nie dodajemy migracji wszystkich zapisów cache, historii, RMF, feedbacku ani synchronizacji między komputerami. JSON ankiety pozostaje version 1; dotychczasowe dane i nieedytowane pola są zachowane. Zmiana stanu po rozpoczęciu generowania nie przebudowuje już tworzonej playlisty.

## Walidacja i rollback

Testy obejmują dwie rzeczywiste karty jednego origin, aktualizację ankiety i generatora, zachowanie obecności, niezależne i sprzeczne oceny, usuwanie, czyszczenie osoby, starszy bezpośredni zapis, niezapisany draft, marker importu, wielokrotne równoległe zapisy, brak Web Locks i quota. L1 regresje pozostają aktywne. Pełny zestaw i mock benchmark muszą przejść przed scaleniem.

Wpływ na długość i jakość playlist: dla identycznego zapisanego stanu identyczny algorytm; zmiany dotyczą aktualności odczytu i ochrony ocen. Nie zwiększamy budżetu Search ani limitu dwóch utworów. Revert PR przywraca L1 bez migracji D1 lub danych. Po rollbacku pozostają scalone oceny w istniejącym kluczu; starszy klient ponownie ma ograniczenia współbieżności. Pending import trzeba najpierw odzyskać w L1/L2. Kolejny zakres to U3: przeniesienie artystów wzorcowych i blokowanych do ankiety z zachowaniem istniejących kluczy.
