# Testy regresyjne

Frontend nadal działa jako statyczny HTML, bez procesu build. package.json służy wyłącznie testom.

Wymagania: Node >=22, Chromium. Instalacja: `npm ci`, następnie `npx playwright-core install --with-deps chromium`. Uruchomienie: `npm test`.
Można wskazać własny Chromium przez `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; testy automatycznie wykrywają `/usr/bin/chromium`.

Testy uruchamiają prawdziwe skrypty stron na tymczasowym lokalnym serwerze. Każdy przypadek ma osobny kontekst przeglądarki; dostęp do zewnętrznych usług jest blokowany. Spotify i Last.fm są symulowane, żadne produkcyjne tokeny ani D1 nie są używane.

Testy nazwane `v42:` opisują znane zachowanie bazowe, obecnie przekroczenie proporcji discovery w fallbacku. PR A zastępuje charakterystykę przepuszczania silnie ujemnego feedbacku regresją wykluczenia wykonawcy we wszystkich ścieżkach. Nie stanowią akceptacji tych błędów. PR naprawiający dane zachowanie musi zastąpić odpowiedni test oczekiwaniem nowej reguły.

Historyczne wyniki 22/60, 41/60 i 31/60 nie mają zapisanych pełnych danych wejściowych, więc nie są odtworzonymi fixture’ami. Kontrola prawdziwego OAuth, uprawnień Spotify, działania odtwarzacza i izolacji istniejących danych produkcyjnego D1 wymaga osobnej weryfikacji przed wdrożeniem.
