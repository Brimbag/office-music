# v43.26.U2 — adaptacja mockupu

Baza main d73c235 / v43.25.U1. Użytkownik zatwierdził implementację oraz scalenie i wdrożenie pod warunkiem przejścia testów.

Układ nawiązuje do dostarczonego index_v43_mockup.html: cztery kafelki obecności na desktop, dwa na mobile; zielone zaznaczenie i ✓; ciemny blok „Nowa playlista” obok ustawień; statusy w nagłówku; odrębne panele RMF i narzędzi. Zachowano paletę jasną/ciemną i widoczny focus.

Kafelki są natywnymi button z aria-pressed, obsługują kliknięcie, Enter i spację. Bartek jest zawsze obecny i nieprzełączalny. Dotychczasowe checkboxy pozostają ukrytym stanem wejściowym dla niezmienionego selectedProfiles i istniejących integracji; nie są widocznym elementem sterującym. Domyślna obecność pozostaje taka jak wcześniej: wszystkie osoby. Liczniki ankiety pochodzą z istniejącego odczytu preferencji, nie z przykładowych liczb mockupu.

Artyści, blokady i ręczne gatunki nadal są w generatorze, w osobnym rozwijanym panelu. Klucze, wartości domyślne i obsługa zapisów bez zmian; nie przenosimy ich przed L1/L2 do ankiety. Last.fm wyświetla rzeczywisty istniejący status zamiast fikcyjnego czasu sukcesu; dotychczasowy przycisk odświeżenia przeniesiony do nagłówka. Nie zwiększamy zapytań i nie dodajemy nowego monitora ani timera.

RMF zachowuje przełącznik, godziny, przyciski i diagnostykę. Podsumowanie, szczegółowa diagnostyka i feedback U1 pozostają dostępne. Nie powstaje przycisk obiecujący nieistniejący backend logów. Scope, OAuth, algorytm, feedback, quota, synchronizacja i konfiguracja produkcyjna bez zmian; żadnych migracji D1.

Weryfikacja: pełne regresje i CI przed scaleniem; klawiatura/mysz i aria-pressed, obowiązkowy Bartek, niezmienione zapisane preferencje, dostęp do manualnych pól, narzędzi i raportu katalogów, szerokości 360/768/1280. Zrzuty desktop/mobile sprawdzone w Chromium na mockowanym stanie bez fizycznego Spotify. Kontrola źródeł potwierdza, że funkcje selekcji i selectedProfiles są niezmienione.

Wpływ na długość/jakość playlist: brak zamierzonego wpływu. Ryzyko: odkrywalność ręcznych preferencji i długi status Last.fm; tekst zawija się, pola mają opisany panel. Rollback: revert całego PR i nowa wersja nagłówka; bez usuwania danych użytkownika. Warunki: niedziałające zaznaczenie, utrata kontroli, błędy runtime lub różnica wyników na tym samym stanie.

Kolejka po U2 pozostaje w IMPLEMENTATION_QUEUE_V43.md: L1, L2, następnie przeniesienie artystów (dotychczas roboczo U2; dla uniknięcia kolizji dalej U3), niezawodność Last.fm, chmura i logi. Algorytmiczne zakresy pozostają odłożone.
