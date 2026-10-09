# v43.25.U1 — układ generatora (punkt 16)

Baza: v43.24.P4 / main `4c6e127`. Osobny PR UX; scalenie i produkcja dopiero po zgodzie.

## Zmiana

- Kafelki osób: czytelny wybór obecności, obramowanie zaznaczenia, licznik/nazwy w aria-live; Bartek nadal obowiązkowy, domyślnie obecni wszyscy. Klawiatura i etykiety pozostają natywne.
- Preferencje ręczne schowane w details każdej osoby, te same pola, domyślne wartości, klucze i obsługa zdarzeń. Artyści nie są jeszcze przenoszeni do taste.html; ręczne gatunki nadal działają.
- Jedno wyraźne CTA generowania przed ustawieniami. Brak zmiany opcji i wartości domyślnych, ograniczeń przycisku, postępu lub błędów.
- Narzędzia lokalne, chmura, Last.fm i porównanie katalogów pod details „Narzędzia i dane”. Statusy Spotify/chmury oraz postęp pozostają widoczne. Status Last.fm i historia są dostępne po rozwinięciu narzędzi. To układ istniejących kontrolek, bez nowej synchronizacji.
- RMF w osobnym, zachowanym panelu z dotychczasowymi kontrolkami, ustawieniami i watcherem.
- Wynik: liczba utworów i osoby, średnie dopasowanie w kafelkach, liczba/udział discovery i cel. Przy krótszym wyniku wyjaśnienie braku kandydatów; liczba pominiętych przez końcową korektę tylko gdy jest w rzeczywistym groupResult.
- Wszystkie poprzednie diagnostyki, w tym filtry, ankiety, quota, wykonawcy i porządki, pod details „Diagnostyka doboru utworów”. Pozostają w DOM i można je rozwinąć/skopiować. Szczegóły przy utworach, feedback, blokowanie z powodem i odtwarzanie zapisanych playlist zachowane. Linki Spotify przed listą utworów.

Kafelki dopasowania nie obliczają nowych ocen ani nie rekonstruują ocen zapisanej playlisty. Brakujące profile zachowują ostrzeżenie o braku wpływu na dobór. Krótki komunikat nie twierdzi, że znaleziono największy możliwy zestaw.

## Weryfikacja i ryzyko

Regresje UI: klawiatura, obowiązkowy Bartek, brak zapisów przy zmianie obecności, niezmienione preferencje, pojedyncze istniejące kontrolki, narzędzia dostępne po rozwinięciu, szerokości 360/768/1280, krótki wynik z diagnostyką, zachowane dane wejściowe, lista i opisy utworów. Istniejące regresje generowania oraz snapshotów chronią zachowanie punktacji, filtrów, quota i feedbacku. Kontrola różnic źródeł chroni pozostałe funkcje przed zmianami. Pełne npm test i CI wymagane przed zatwierdzeniem.

Zweryfikowano także zrzut desktop w Chromium. Mockowany harness nie potwierdza fizycznego Spotify lub pracy RMF na urządzeniu; te ścieżki nie są zmieniane.

Wpływ na długość i jakość playlist: brak zamierzonego wpływu, dobór i dane pozostają identyczne. Brak nowych requestów API, kluczy stanu, zależności, zmian functions/api/state.js, konfiguracji produkcyjnej i migracji D1.

Ryzyko UX: kontrole schowane w details mogą być mniej odkrywalne; zachowujemy jasne nazwy i instrukcję o preferencjach. Pełna diagnostyka nadal lokalnie dostępna, bo trwały backend logów jeszcze nie istnieje. Nie utożsamiamy karty w tle z dowodem uśpienia.

Rollback: revert PR + nowa widoczna wersja; bez cofania preferencji, historii lub innych danych użytkownika. Wycofać przy utracie dostępu do kontrolek, obsługi klawiatury, diagnostyki albo zmianie wyników dla tego samego stanu.

Proponowana kolejność dalszych niezależnych PR-ów: [IMPLEMENTATION_QUEUE_V43.md](IMPLEMENTATION_QUEUE_V43.md). Algorytmiczne Q1/P5/T1/E.2/F4 pozostają odłożone zgodnie z decyzją użytkownika.
