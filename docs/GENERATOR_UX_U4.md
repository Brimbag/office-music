# U4 — jedno miejsce diagnostyki, 1.0.10-rc

Zatwierdzony UX oraz scalenie/wdrożenie po testach. Bez zmian algorytmu, danych, kontraktów i żądań API.

Gotowy wynik ma krótki status i jeden zwijany panel „Diagnostyka generowania”. Sekcje: wynik/ograniczenia, etapy/wydajność (pomiary operacji głębiej), pozyskiwanie/uczenie, dane/synchronizacja, model/pełne liczniki. Przenosimy istniejące węzły/teksty, nie liczymy scoringu ani diagnostyki ponownie. Podczas generowania dotychczasowy postęp pozostaje widoczny; reorganizacja następuje po końcowym raporcie i wyniku zapisu dziennika. Błąd po zapisie częściowym również ma panel ostatniej próby. Błąd opcjonalnej prezentacji nie unieważnia playlisty.

„Kopiuj raport diagnostyczny” kopiuje wersję, rzeczywiste ID obecnych profili, cel, ustawienia UI uchwycone na rozpoczęcie oraz sekcje. Nie kopiuje listy utworów ani surowej historii/backupów/OAuth; szczegóły Search mogą zawierać nazwy zapytań jak istniejąca lokalna diagnostyka. Zablokowany schowek daje pole read-only do ręcznego kopiowania, bez backendu. Pełne liczniki, model, błędy i wyniki chmury nie są tracone.

Historia generowań pozostaje osobnym, chronionym widokiem. Rozwinięcie wpisu ma nazwę „Szczegóły wpisu historii”, odróżniając archiwum od bieżącej próby. RMF i diagnostyka pominięć pozostają przy swoich funkcjach. Starsze snapshoty nie zawierają pełnego raportu: pokazują istniejące dane utworów, bez przypisywania im raportu innej generacji. Nie migrujemy snapshotów.

Regresje: sukces, krótki wynik, częściowy błąd, kompletność przeniesionych tekstów i jeden panel, kopiowanie/fallback, klawiatura/mobile, starsze snapshoty; pełne testy i CI. Neutralne porównanie pipeline 2/4 cold/warm ma zachować ID/kolejność, selekcję, żądania, pule i stan D1; tekst/nazwa sekcji celowo się zmienia.

Rollback: revert PR bez danych/migracji. Wycofać przy utracie informacji/narzędzi, błędach runtime, regresji klawiatury/kopiowania lub zmianie selekcji/API. Smoke: nagłówek1.0.10-rc, zwykła generacja, jeden panel, pięć sekcji i kopiowanie raportu; nie wymuszać quota/pominięć. Następny konsument monitora jest tylko planowany: [obserwacja wszystkich playlist](SKIP_MONITOR_ALL_PLAYLISTS_PLAN.md).
