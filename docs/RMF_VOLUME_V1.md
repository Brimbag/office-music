# V.1 — potwierdzanie głośności i diagnostyka, v43.38.V1

Raport live v43.37.V: recovery 41%→45%, ogólne „błąd połączenia lub brak potwierdzenia”, trzy logiczne zmiany, rozpoznanie z katalogu bez lookup, przełącznik wyłączony. Późniejszy monitor idle/odczyt na żądanie i brak GET w ostatniej minucie potwierdzają wyłączenie automatyzacji, nie dowodzą błędu połączenia ani braku supports_volume. Nie znamy rzeczywistych odpowiedzi HTTP/przyczyny tego zapisu na urządzeniu użytkownika.

Dwa potwierdzone problemy kodu:

1. inspect() zwraca null dla braku intentu, niezweryfikowanej sesji, zajętej operacji, zapisu w toku, nieprawidłowego zapisu, braku świeżego playback, niekwalifikowalnego lub innego urządzenia. UI zawsze wyświetlał ten sam alarm. Brak intentu nie powoduje GET Spotify, więc komunikat nie sprawdzał nawet obsługi głośności. Każdy przypadek ma teraz oddzielną przyczynę i komunikat. „Nie ma zapisanego poziomu” pozwala zacząć test; nie oznacza, że API już potwierdziło możliwości urządzenia.
2. Po udanym PUT następował jeden natychmiastowy GET. Zdrowa odpowiedź z poprzednią wartością również prowadziła do recovery i fikcyjnego kodu 503. Odtworzono w mocku dokładnie 41→45 przy udanym zapisie i opóźnionym readback; nie przypisujemy tego automatycznie jako przyczyny incydentu live.

Potwierdzanie: immediate GET oraz najwyżej dwa dodatkowe odczyty po 600 i 1200ms. Wspólny monitor M, fresh/single-flight, deadline całego potwierdzenia 5s. Ponawiamy wyłącznie odczyty, nigdy PUT. Jeśli pierwszy GET potwierdza poziom, dodatkowe żądania nie występują. Tylko poprzedni baseline/target dopuszcza oczekiwanie; inna wartość oznacza manual override. Błąd playback/429, zmiana urządzenia/sesji i timeout zatrzymują oczekiwanie, zachowując intent. Backoff M pozostaje obowiązujący; nie nadrabiamy odczytów po deadline. Przy restore również dopuszczamy opóźniony readback bez drugiego PUT.

Diagnostyka odróżnia request failure, brak potwierdzenia wartości, brak playback, zmianę sesji/urządzenia i deadline. Wyświetla ostatnią odczytaną głośność w procentach (bez potrzeby odczytywania procentów z suwaka Spotify) i dodatkowy licznik odczytów potwierdzających, bez tokenów, ID kont/urządzeń ani surowych odpowiedzi. Nie zmieniamy limitów gain/cap, identyfikacji Faktów, własności intentu ani zasad ręcznej zmiany. Brak playlist-selection/feedback/discovery/queue/D1/SQL zmian. Off default i lokalna recovery pozostają jak w V.

Testy jednostkowe i Chromium: brak intentu bez GET, brak sesji/nieprawidłowy stan/in-flight/inne lub nieobsługiwane urządzenie, zdrowy PUT z opóźnionym 41→45 i restore, niezmieniony readback (bounded recovery, zero ponowionych PUT), manual override i 429 podczas potwierdzania. Istniejące testy V/M i pełne regresje nadal obowiązują. Realne sterowanie desktop Spotify pozostaje do osobnego smoke testu; mock nie potwierdza obsługi Premium/urządzenia.

Rollback: przed rewertem zakończyć regulację lub sprawdzić zachowany intent/ustawić Spotify ręcznie. Revert do V nie usuwa danych ani nie odwraca zdalnie wykonanej zmiany głośności. Nie kasować intentu jako sposobu naprawy diagnostyki. Ograniczenie best-effort po zamknięciu przeglądarki pozostaje.
