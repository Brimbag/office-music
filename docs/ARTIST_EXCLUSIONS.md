# Blokady katalogów Spotify — v43.11.F2

Po rollbacku F przycisk 🚫 pyta o powód: „Nie lubię” lub „Nie ten wykonawca”. Przy współwykonawcach użytkownik wybiera konkretnego wykonawcę. Oba powody wykluczają jego Spotify Artist ID przy następnym generowaniu, także z cache i w fallbacku. Nie modyfikują istniejącej playlisty Spotify, ocen 👍/👎 ani preferencji pozostałych współwykonawców. Anulowanie i Escape nie zapisują decyzji; dialog pozwala odwołać blokadę.

„Nie ten wykonawca” pokazuje inne ID o tej samej nazwie znalezione wyłącznie w lokalnej puli i ostatnich playlistach. Linki służą sprawdzeniu katalogów. Sama nazwa nie potwierdza zgodności; nic nie jest przypisywane automatycznie. Brak alternatywy nie przeszkadza w zablokowaniu błędnego ID. Automatyczne dopasowanie Spotify–Last.fm pozostaje osobnym, późniejszym PR-em.

## Dane i zgodność

Nowy klucz `office_artist_exclusions_v1` zawiera dziennik decyzji dla ID. Zdarzenie zapisuje powód, nazwę, utwór, współwykonawców i czas; odwołanie jest kolejnym zdarzeniem, nie usunięciem historii. Każda decyzja wskazuje znane decyzje poprzedzające. Scalanie chmury i importu jest sumą zdarzeń: stara kopia nie przywraca już odwołanej blokady. Równoczesne, niezależne decyzje pozostają widocznym konfliktem; aktywna blokada ma pierwszeństwo do jawnego rozstrzygnięcia. Czas zegara nie decyduje o wyniku.

Nie ma migracji nazw na ID ani nowych tabel, SQL migracyjnego czy konfiguracji produkcyjnej. Starsze tagi Last.fm, historia, feedback i artyści wzorcowi działają jak po rollbacku. Ich powiązania po nazwach nie zostały naprawione tym PR-em. Dawne blokady nazw nadal obowiązują i odwołanie nowej blokady ID ich nie usuwa; dialog informuje o tym. Zarchiwizowany `office_artist_identity_v2` nie jest aktywowany ani kasowany. Import starszej kopii zachowuje lokalną archiwalną strukturę, jeśli kopia jej nie zawiera.

API zachowuje identyfikację konta przez `account_id`, allowlistę i limity. Nowy klucz wymaga oczekiwanej wersji wartości; nieaktualna podstawa daje 409. Warunek SQL chroni również wyścig między odczytem a zapisem. Klient scala i ponawia maksymalnie trzy razy. W wyścigu pozostałe klucze z tej samej paczki mogą zostać zapisane przed zwróceniem 409 — ich dotychczasowa semantyka nie została zmieniona. Starszy klient, który nie wysyła nowego klucza, nie kasuje go.

Po utworzeniu dziennika synchronizacja wykonuje dodatkowy GET przed PUT; nie jest to dodatkowe wyszukiwanie kandydatów Spotify. Przeglądarka bez dziennika nie wykonuje tego GET. Budżet pozyskiwania muzyki pozostaje bez zmian. Błąd synchronizacji zachowuje lokalną decyzję. Dziennik rośnie z liczbą decyzji; obowiązują dotychczasowe limity 1,5 MiB na wartość i 2 MiB na żądanie. Przekroczenie limitu wyświetla błąd bez nadpisania poprzedniej lokalnej wartości. Nie ma automatycznego usuwania historii decyzji. Uszkodzony dziennik zatrzymuje selekcję zamiast ignorować blokady.

## Weryfikacja długości i jakości

Pełny zestaw: 119 testów, w tym 92 wcześniejsze regresje. Testy obejmują dwa różne ID „Days of the New”, oba powody, współwykonawców, anulowanie, odwołanie, cache, selekcję normalną i fallback, import, brak ID, quota, błędy sieci, konflikty synchronizacji oraz rzeczywisty SQL na izolowanym SQLite.

Kontrolowana pula dla dwóch i czterech profili daje po 12 utworów przed blokadą. Blokada ID obecnego w dwóch utworach daje 10, jeśli nie ma zastępstw, oraz 12 przy dostatecznej puli. Średnie dopasowanie każdej osoby pozostaje 56,04 w tym przykładzie. To regresja na danych syntetycznych, nie prognoza długości playlist na live. Progi jakości, discovery, limit dwóch utworów na wykonawcę, wyniki rekomendacji, tagi, RMF i budżet pozyskiwania nie są zmieniane.

Dodatkowo zbudowany Worker Pages sprawdzono w lokalnym Miniflare z izolowaną D1 i symulowanym Spotify: zapis, odczyt, odrzucenie starej wersji i brak autoryzacji. CI uruchamia cały zestaw w Chromium i Node 24. Żadna z tych kontroli nie zapisuje danych produkcyjnych.

## Wycofanie

Przed wdrożeniem można wyeksportować stan. Revert tego PR-a przywraca zachowanie v43.10.R; trzeba nadać nowy numer w obu nagłówkach oraz diagnostyce i eksporcie. Nie usuwać nowego klucza z D1 ani localStorage: starszy kod go ignoruje, zachowując możliwość ponownego wdrożenia. Po rollbacku nowe blokady ID przestają być egzekwowane — trzeba to jawnie zakomunikować.

Powody wycofania: blokowanie innego ID niż wybrane, przenoszenie decyzji na homonima lub współwykonawcę solo, utrata preferencji albo odwołań, problemy synchronizacji uniemożliwiające normalne korzystanie, skrócenie playlist wykraczające poza usunięcie blokowanych kandydatów. Nie cofać przez kasowanie danych. Scalenie i wdrożenie wymagają osobnego zatwierdzenia użytkownika.
