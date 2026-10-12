# Q1.10 — świeżość Last.fm i lokalne usunięcia cache

Wersja `1.0.9-rc`; zatwierdzone scalenie/wdrożenie po testach.

Audyt odtworzył 600 → 0 przy przekroczeniu TTL obserwacji 10 min bez utraty historii. `lastFmRecentCount()` nadal zwraca dawny wynik dla algorytmu; zmienia się wyłącznie opis: świeży wynik 0 jest zerem, nieaktualna obserwacja ma ostatni potwierdzony count i wiek, brak/obce konto nie pokazuje cudzych danych. Data przyszła jest opisana jako wymagająca sprawdzenia. Nie wydłużamy TTL ani nie przedstawiamy starego count jako aktualnej historii.

`cache-diagnostics.js` zlicza udane usunięcia istniejących wpisów Spotify/Last.fm przez ścieżki aplikacji: TTL, quota, nieprawidłowy JSON w purge, lokalna migracja i import/odzyskiwanie. Licznik jest kumulacyjny **od otwarcia bieżącej strony**, również dla czyszczenia przed generowaniem; resetuje się po reload. W innych kartach i ręcznych zmianach DevTools nie obserwuje usunięć. Nie jest pomiarem wszystkich nietrafień cache ani dowodem przyczyny wcześniejszych raportów. Import/odzyskiwanie może usuwać i następnie odtwarzać wpisy; licznik opisuje operacje usunięcia, nie utratę backupu.

Moduł przechowuje wyłącznie stałe powody i liczby, bez nazw kluczy, zapytań, użytkowników lub tokenów. Nie zapisuje localStorage/D1/eksportu, nie dodaje API/timerów. Raport postępu zawiera lokalny `cacheCleanup`; whitelist LOG1 pomija go. Gdy moduł jest niedostępny (mieszane stare pliki), dotychczasowe usuwanie działa bez diagnostyki. Błąd samego usunięcia zachowuje dawną propagację i nie nalicza wpisu. Brak danych obserwacji nie jest przedstawiany jako rzeczywiste zero.

Bez zmian reguł usuwania, quota recovery, retencji, historii, selekcji, jakości, discovery, feedbacku, RMF, kontraktu D1 i uprawnień. Możliwa przyczyna wcześniejszych zer trafień Search to quota albo TTL/brak właściwych stron; nowa diagnostyka pozwoli odróżnić część tych scenariuszy, nie identyfikuje działań innych kart.

Regresje: granica TTL, nieaktualna/fresh-zero/obca/przyszła obserwacja, wygaśnięcie cache, corrupt purge, quota i ochrona danych, brak podwójnego naliczenia, nieudane usunięcie i brak prywatnych treści. Dotychczasowe L1/L2/import/LF1 i LOG1 pozostają. Pełna regresja i CI, neutralne porównanie 2/4 cold/warm przed/po: selekcja, ID/kolejność, żądania i stan bez zmiany.

Rollback: revert PR, bez danych/migracji. Wycofać przy zmianie selekcji lub reguł cleanup, błędach odzyskiwania, ujawnieniu danych albo błędach runtime. Smoke: 1.0.9-rc, normalne generowanie i linia „Usunięcia cache od otwarcia tej strony”; nie należy specjalnie zapełniać magazynu. Po wygaśnięciu obserwacji czytelny status Last.fm zamiast mylącego zera. Następnie decyzja o stabilnym wydaniu, bez dalszego strojenia w tym zakresie.
