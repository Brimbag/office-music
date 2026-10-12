# Q1.8 — lokalna diagnostyka kontekstu Search

Kandydat `1.0.7-rc`. Po dwóch raportach „kontekst zmienił się — bez zapisu” powtórne generowanie po ok. pięciu minutach zapisało uczenie. Te obserwacje zawężają audyt do zmian podczas przebiegu, ale nie wskazują jednoznacznie ich źródła.

## Mechanizm

Zachowujemy identyczny zestaw i kolejność pól zbiorczego fingerprintu Q1.7 oraz dotychczasową decyzję o uczeniu. Opcjonalnie obliczamy dodatkowo SHA-256 piętnastu obszarów tego samego snapshotu: wersja, konto Spotify, obecność/snapshot profili, ręczne gatunki, artyści, ustawienia, ankieta, ręczny feedback/blokady feedbacku, historia, blokady Spotify ID, konto Last.fm, katalog wykonawców Last.fm, katalog utworów Last.fm, efektywne blokady, automatyczny feedback.

Przy różnym fingerprintcie na końcu generowania lokalne szczegóły pokazują tylko etykiety zmienionych obszarów. Skróty obszarów są wyłącznie w pamięci bieżącego pozyskiwania, nie w localStorage, eksporcie ani D1. Nie ujawniamy wartości, nazw osób/wykonawców, tokenów, zapytań ani szczegółów błędów. Raport lokalny zawiera jedynie identyfikatory obszarów; whitelist LOG1 pomija całą diagnostykę rotacji. Brak dostępnych skrótów/utrata konta daje ogólną etykietę. Błąd dodatkowych hashy nie wpływa na decyzję uczenia ani poprawność playlisty.

Diagnostyka nie odróżnia metadanych od istotnych dowodów wewnątrz obszaru. „Katalog Last.fm” nie dowodzi, że zmieniły się tagi, ani która operacja je zapisała. Nie zawężamy fingerprintu, nie pomijamy jego pól i nie automatyzujemy ocen na podstawie komunikatu. Synchronizacja chmurowa odbywa się przed końcowym porównaniem; jest jedną z możliwych dróg zmiany katalogu, nie potwierdzoną przyczyną raportów użytkownika.

## Koszt, jakość i walidacja

Dwa zestawy po 15 dodatkowych digestów, bez nowych wywołań API i dodatkowego scoringu. Brak zmian progów, discovery, feedbacku, retencji, budżetu, kolejności/wyboru utworów, RMF lub produkcyjnych schematów. Wersja zmienia się zgodnie z numeracją wydań; jak dotychczas nowa wersja tworzy nowy kontekst uczenia.

Regresje: pojedyncze obszary, zmiana obecności/feedbacku, odświeżone katalogi/historia, efektywne wygasłe blokady, stabilny kontekst, własne zapisy cache/puli ignorowane, awaria opcjonalnych hashy i utrata sesji, brak danych prywatnych w UI oraz brak diagnostyki w cloud LOG1. Testy katalogu reprezentują zmianę danych także po merge chmurowym; nie dowodzą konkretnego źródła zmiany live. Dotychczasowe Q1.7 regresje zachowują progi/cooldown i uczenie po trzech generowaniach.

Pełna regresja/CI oraz porównanie mock pipeline 2/4 profili cold/warm przed/po: identyczne wybrane ID, selekcja i liczba/typy żądań. Czas jest obserwowany bez arbitralnej granicy. Mock nie zastępuje produkcyjnego smoke.

## Smoke i rollback

Sprawdzić nagłówek `1.0.7-rc`. Wygenerować zwyczajną playlistę bez kasowania cache i wkleić szczegóły z „Rotacja Search”; jeśli uczenie pominięte, także nową linię „Zmiany kontekstu Search”. Powtórzyć z tym samym składem/ustawieniami. Brak nowej linii przy udanym zapisie jest prawidłowy. Nie wykonywać testowych pominięć do naliczania kar.

Rollback: revert PR, bez kasowania danych i migracji. Wycofać przy regresji wyboru/API, błędach runtime, ujawnieniu danych lub istotnym koszcie diagnostyki. Dopiero na podstawie wykazanego obszaru planujemy osobną poprawkę; P5 pozostaje warunkowy.
