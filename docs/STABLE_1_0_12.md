# Wydanie stabilne 1.0.12

Użytkownik potwierdził produkcyjny test S3.1 (nazwy w dzienniku) i zatwierdził scalenie/wdrożenie po testach, wraz z domyślnym włączeniem obserwacji i automatycznych kar.

## Zachowanie

- Po potwierdzonym `/me` ustawienia bez zapisanej decyzji są inicjalizowane jako włączone. Zapisane `0` dla kar pozostaje wyłączone. Inicjalizacja CAS nie nadpisuje równoległego wyłączenia w innej karcie. Brak sesji nie uruchamia odczytów.
- Jeden wspólny monitor Spotify: wszystkie playlisty diagnostycznie, **kary tylko dla przejścia, którego oba TrackID należą do lokalnego snapshotu OMM**. Podcasty, RMF, luki, pauzy i niejednoznaczne przejścia nadal pomijane. Historia S1 nie jest ponownie oceniana.
- Obserwacja zapamiętuje decyzję lokalnie per konto w `office_skip_observation_enabled_v1:<konto>`. Ten klucz jest w lokalnym eksporcie preferencji, bez nowego kontraktu D1. Kary nadal mają istniejący klucz per `account_id` i istniejącą synchronizację.
- Ponowne otwarcie strony automatycznie rozpoczyna nowe maks.8h od świeżej kotwicy. Zwykły refresh profilu nie odnawia deadline ani nie uruchamia ponownie zatrzymanej/wygasłej obserwacji. Zatrzymanie na pagehide zachowane; zamknięta/uśpiona karta nie gwarantuje obserwacji.
- Generowanie wstrzymuje/wznawia dotychczasową obserwację. Weryfikacja sesji po raz pierwszy podczas generowania odkłada inicjalizację do zakończenia; nie dodaje odczytów playback podczas doboru.
- Przełączniki pozwalają wyłączyć obie funkcje niezależnie. Zmiana kar zachowuje istniejące ostrożne zatrzymanie obserwacji; należy włączyć ją ponownie dla nowych odczytów. Ustawienia wyłączone po otwarciu pozostają wyłączone.
- Nie zmieniamy wielkości kar, wygasania, punktacji ręcznej, minimum35, discovery ani filtrów. Włączenie istniejących kar może obniżyć ranking/zmniejszyć liczbę kwalifikujących utworów — to zamierzony efekt tej funkcji. Bez danych kar wyniki selekcji pozostają takie same. Aktywna obserwacja zużywa istniejący budżet monitora, nie Spotify Search; limity/koordynacja/backoff pozostają zachowane.

## Weryfikacja i smoke

Regresje obejmują domyślny start po prawdziwej funkcji getProfile, reload z czystą kotwicą, świadome wyłączenia per konto, brak sesji, generowanie, brak odnawiania limitu, uszkodzone dane, konflikt CAS, nowe kary OMM oraz brak oceniania obcych i dawnych wpisów. Pełne `npm test` oraz oba smoke benchmarki CI wymagane przed scaleniem. Wyniki dokładnego SHA w opisie PR.

Po wdrożeniu: nagłówek **1.0.12**; po zalogowaniu sprawdź przełączniki (wcześniejsze wyłączenia zachowane). Bez wykonywania testowych pominięć sprawdź, że monitor obserwuje playlistę, wyłącz obserwację, odśwież stronę i potwierdź wyłączenie. Włącz ponownie, odśwież stronę i potwierdź automatyczny start. Nie naliczamy ocen na podstawie wcześniejszych testów.

## Wycofanie

Revert tego PR przywraca 1.0.12-rc i ręczny start obserwacji. Nie usuwa dziennika, ocen, ustawień ani resetów 👍. Ponieważ poprzedni klient rozumie flagę kar `1`, samo cofnięcie kodu nie wyłącza zapisanych kar; można je wyłączyć istniejącym przełącznikiem. Nie ma migracji SQL, zmiany produkcyjnych danych ani nowych scope OAuth.
