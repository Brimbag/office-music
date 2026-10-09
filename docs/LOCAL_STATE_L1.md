# L1 — odzyskiwalny import i bezpieczny zapis, v43.27.L1

## Problem i zachowanie

Dotychczas import usuwał wszystkie klucze office_ przed zapisem nowej bazy. Kopia rollbacku istniała tylko w pamięci. Quota podczas importu i podczas przywracania mogła pozostawić częściowe dane bez możliwości odzyskania po zamknięciu karty. Ankieta mogła pokazywać sukces mimo niezapisanego wyboru.

Moduł local-state.js wspólny dla generatora i ankiety zapisuje przed importem jedną trwałą kopię poprzednich kluczy office_ w IndexedDB omm-local-recovery/backup/latest. Dopiero zakończona transakcja pozwala rozpocząć wymianę localStorage. Brak możliwości zapisu kopii przerywa import przed usunięciem danych. Import ma blokadę Web Locks, jeśli jest dostępna. Sprawdza format, typy podstawowych magazynów, klucze i limit 32 MiB przed zmianą stanu. Zachowuje dotychczasowy merge wyjątków wykonawców i archiwum tożsamości.

Po błędzie import próbuje przywrócić poprzedni stan. Jeśli to także zawiedzie, zachowuje kopię pending i blokuje generowanie oraz synchronizację. Następne otwarcie generatora lub ankiety próbuje odzyskać dane przed migracjami i uruchomieniem aplikacji. Przycisk kopii pozwala pobrać stan sprzed importu także po udanym imporcie. Kopia nie obejmuje kluczy OAuth Spotify; ich wartości pozostają nietknięte.

Zapisy ankiety, ręcznych gatunków/wzorców/blokad, użytkownika Last.fm, feedbacku, wyjątków wykonawców i ustawień RMF korzystają z atomowego setItem. Po quota usuwane są wyłącznie odtwarzalne raw cache Search/Last.fm. Ponowna awaria pokazuje błąd, zachowując wcześniejszą wartość. Ankieta cofa także zmianę w pamięci i widoku. Formularze preferencji i RMF przywracają zapisane wartości. Istniejące zapisy pul, historii i housekeeping nie zmieniają retencji ani selekcji.

## Ograniczenia

To odzyskiwalny import, a nie atomowa transakcja między IndexedDB i localStorage. Kopia przechowywana jest lokalnie w jednej przeglądarce/origin; kolejne przygotowanie importu zastępuje poprzednią kopię. Usunięcie danych witryny usuwa również kopię. Przy uszkodzonym wcześniejszym stanie odzyskiwanie może wymagać pobrania i ręcznej naprawy kopii. Gdy IndexedDB jest niedostępne przy zwykłym uruchomieniu, aplikacja pozostaje dostępna, ale import nie rozpocznie zmian bez kopii. Osobny lokalny marker omm_local_import_pending, niewysyłany do D1 i nieeksportowany jako preferencja, blokuje start przy niedostępnej kopii po rozpoczętym imporcie.

Import blokuje kontrolki, autosync i nowe odczyty/zapisy chmurowe. Nie można go rozpocząć podczas generowania, aktywnej synchronizacji, ręcznego odświeżania Last.fm lub obsługi RMF. Kontrola zmiany snapshotu podczas zapisu kopii wykrywa część konkurencyjnych zmian. Należy zamknąć inne karty OMM na czas importu: zwykła edycja i starsze klienty nie respektują blokady importu. Pełna synchronizacja oraz konflikty wielu kart należą do L2.

## Testy i wpływ

Regresje L1 obejmują walidację, quota z czyszczeniem wyłącznie cache, trwałą quota, udany import/kopię bez OAuth, błąd w połowie importu, awarię rollbacku i odzyskanie po reloadzie, brak IndexedDB, pusty poprzedni stan, zapis ankiety i ustawień RMF oraz blokadę generatora/chmury przy awarii odzyskiwania. Pełna regresja i istniejący benchmark z mock API weryfikują niezmienione zachowanie generatora.

Brak zmian punktacji, discovery, progów jakości, limitów, budżetu API i kontraktu D1. Długość i jakość playlist pozostają funkcją tego samego stanu i algorytmu. Import i jego odzyskiwanie celowo kończą się błędem zamiast generować z częściowych danych.

## Wycofanie

Revert PR przywraca v43.26.U2; nie wymaga SQL, migracji D1 ani zmian OAuth. Przed wycofaniem sprawdzić pending: jeśli import jest niedokończony, odzyskać dane w L1 lub pobrać kopię i bezpiecznie przywrócić po zwolnieniu miejsca. Starsza wersja nie odczytuje IndexedDB backup. Nie usuwać bazy odzyskiwania ani danych witryny. Rollback kodu nie cofa świadomie zaimportowanych preferencji.
