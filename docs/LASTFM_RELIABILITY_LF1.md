# LF1 — niezawodność Last.fm

Wcześniej zakończenie prób pobrania tagów, także wszystkich nieudanych, przesuwało znacznik udanej synchronizacji o godzinę. Teraz znacznik sukcesu aktualizuje się tylko po prawidłowych odpowiedziach wszystkich wykonanych żądań. Poprawne częściowe wyniki pozostają w bazie, ale diagnostyka rozróżnia partial/error/ok. Osobny lokalny znacznik próby zapewnia dwuminutowy backoff, bez uznawania błędu za świeże dane. Ręczne odświeżenie nadal omija backoff. Zmiana konta historii omija backoff.

Nie zmieniamy selekcji ani limitów API. Historia nadal publikuje obserwację dopiero po pomyślnym odczycie wszystkich pobieranych stron; limit trzech stron pozostaje jawnie oznaczony jako niepełny. Rollback: revert PR; nowe metadane próby są ignorowane przez poprzedniego klienta. Brak migracji D1.
