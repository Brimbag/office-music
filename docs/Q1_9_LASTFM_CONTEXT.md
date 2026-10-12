# Q1.9 — semantyczne porównanie katalogu utworów Last.fm

Wersja `1.0.8-rc`. Zgoda użytkownika obejmuje audyt oraz scalenie/wdrożenie po udanych testach.

## Diagnoza odtworzona

Raport live Q1.8 wskazał zmianę wyłącznie katalogu utworów Last.fm. Audyt zapisów: `addLastFmTracks`/`saveLastFmTrackPool` po historii i tagach; `applyLastFmCloudCatalog` przez LF2 (także po generowaniu); import/odzyskiwanie i inne karty. Zwykłe odczyty i rotacja kandydatów nie zapisują tej puli. Fingerprint powstaje po odświeżeniu historii/tagów, a porównanie końcowe po synchronizacji chmury.

Odtworzony przypadek: `OfficeArtistCatalogEvidence.mergeMetadata` przechowuje opcjonalne `album`, `artistMbid`, `trackMbid` jako puste stringi. LF2 `clean` pomija puste wartości. Import własnego kompaktowego katalogu zastępuje tablicę dowodów tymi samymi danymi bez pustych pól. Surowy JSON jest różny; wynik `OfficeArtistCatalogEvidence.analyze` identyczny. Przed poprawką test kończy się `context-changed`, po poprawce `saved`. To potwierdzona ścieżka fałszywej invalidacji, ale nie dowód, że była jedyną przyczyną raportu użytkownika.

Nie pomijamy `savedAt`: steruje TTL, retencją i rotacją. Nie pomijamy `lastUsedAt`, tagów, źródeł, nazw, niepustych MBID, flag ucięcia, nieznanych pól ani zmian liczności/kolejności rekordów. Ich zmiany nadal konserwatywnie invalidują uczenie. Nie sortujemy tablic ani nie scalamy duplikatów: istniejące lookupy mogą zależeć od kolejności rekordów.

## Zmiana

Wyłącznie wejście katalogu utworów Last.fm do fingerprintu/diagnostyki Q1.8: kanoniczna kolejność kluczy obiektów, neutralne formatowanie JSON i równoważność braku oraz pustego stringa trzech opcjonalnych pól wewnątrz `catalogEvidence`. Nazwy wykonawcy/utworu w dowodach pozostają nietknięte. Wszystkie inne wartości i kolejności tablic pozostają. Nieprawidłowy JSON, inny schemat lub niewłaściwe rekordy zachowują surową reprezentację. Brak danych nie jest utożsamiany z pustą pulą.

Nie zmieniamy zapisów katalogu, LF2 merge, danych lokalnych/D1, punktacji, selekcji, progów, discovery, feedbacku, RMF, limitów ani API. Jedyna funkcjonalna różnica: brak pominięcia uczenia przy opisanej równoważnej reprezentacji. W przyszłych generowaniach wyuczone priorytety mogą wpływać na pozyskiwanie; nie obiecujemy identycznych playlist po różnych historiach uczenia ani 60/60 zawsze. Nowa wersja jak dotychczas rozpoczyna własny kontekst.

## Walidacja i rollback

Regresja wykonuje rzeczywiste LF2 compact/import oraz analizę dowodów przed/po. Testy graniczne: tagi, źródła, savedAt, tożsamość, niepuste album/MBID, nieznane pola, lastUsedAt, nowe rekordy, kolejność tablic, formatowanie, klucze, uszkodzony/przyszły schemat. Dotychczasowe Q1.7/Q1.8 chronią konto, profile, historię, feedback, blokady, błędy oraz brak danych prywatnych w diagnostyce/D1. Przed scaleniem pełna regresja, CI i kontrolowane porównanie 2/4 cold/warm na identycznym wejściu.

Rollback: revert tego PR, bez kasowania danych/migracji. Wycofać przy uczeniu mimo istotnej zmiany, regresji jakości/API, błędach runtime lub istotnym koszcie normalizacji. Smoke: nagłówek 1.0.8-rc; zwykła generacja i powtórzenie bez kasowania cache, linie „Rotacja Search”/„Zmiany kontekstu Search”. Istotnie zmieniony katalog nadal może poprawnie dać `context-changed`; nie wyłączamy zabezpieczenia.
