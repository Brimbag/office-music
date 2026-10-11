# Q1.7 — kontekstowa rotacja Search, 1.0.6-rc

## Problem i zakres

Smoke Q1.5 dał 60/60 dla sprawdzonych składów 2/3/4 osób. W próbach 2 i 3 osób po 6 nowych zapytań nie miało bezpiecznych kandydatów. Lifer dał jednak 6 bezpiecznych i 0 wybranych — brak wyboru nie jest dowodem bezużyteczności zapytania. Celem Q1.7 jest lepsze wykorzystanie tego samego budżetu, nie zmiana ocen lub wymuszanie większego discovery.

Zmienia się wyłącznie priorytet nowych zapytań w istniejących trzech fazach pozyskiwania. Ranking i selekcja utworów, minimum każdej osoby, limity wykonawców, feedback, discovery, RMF, paginacja Q1.5, retencja pul oraz transport/OAuth pozostają bez zmian. Budżety 12/14/16 dla dotychczasowych celów i podział faz pozostają te same. Pierwsze generowanie bez danych rotacji zachowuje kolejność Q1.5. Anulowany Q1.6 nie jest implementowany; kolejna wersja po 1.0.5-rc to 1.0.6-rc.

## Uczenie i priorytet

- Obserwacje pochodzą z istniejącej końcowej kwalifikacji Q1.4, bez dodatkowego scoringu lub wywołań API. Uczymy się tylko po zakończonym sukcesem generowaniu i ukończonej diagnostyce.
- Liczą się nowe, udane odpowiedzi Spotify z potwierdzonym raw. Trafienia cache, błędy API/OAuth/sieci i nieukończone próby nie zwiększają licznika niepowodzeń.
- Jeśli są bezpieczni kandydaci, kasujemy wcześniejsze niepowodzenia — także przy zero wybranych utworów. Bieżące bezpieczne pokrycie zapytania także neutralizuje jego wcześniejszy niższy priorytet.
- Zero bezpiecznych jest dowodem tylko dla pustej strony po filtracji lub gdy wszystkie filtrowane wyniki zachowano do końcowej oceny. Gdy część rekordów wypadła przez retencję, nie zgadujemy ich jakości i nie zwiększamy streaku. Duplikaty/nieprawidłowe ID mogą również uniemożliwić dowód kompletności; stosujemy neutralną decyzję.
- Kilka stron tego samego zapytania daje najwyżej jedną obserwację na generowanie. Dowolna strona z bezpiecznymi kandydatami ma pierwszeństwo przed zerami; niekompletna strona uniemożliwia przypisanie negatywnego wyniku całemu zapytaniu.
- Pierwsze niepowodzenie nie zmienia kolejności. Po drugim priorytet jest niższy przez 30 min; kolejne niepowodzenia dają 60, potem maks. 120 min. Zapytania nie są usuwane: pozostają fallbackiem, gdy nie ma innych dostępnych źródeł.
- Po upływie czasu zapytanie może dostać priorytetową ponowną próbę. Najwyżej jedna taka priorytetowa próba na całe generowanie; pozostałe zapytania nadal mogą być użyte jako fallback. Probe nigdy nie omija blokad, saturacji wykonawcy, cache, paginacji lub budżetu.

## Kontekst, dane i bezpieczeństwo

SHA-256 obejmuje wersję modelu, potwierdzoną tożsamość konta Spotify, obecne osoby/wykorzystany snapshot profili, ustawienia jakości/targetu, ankietę, artystów wzorcowych/blokowanych, feedback ręczny/automatyczny, historię, efektywne blokady (także ich wygaśnięcie), konto i pule dowodowe Last.fm. Zmiana tych danych tworzy kontekst bez wcześniejszego niższego priorytetu. Powrót do identycznego kontekstu może użyć jego nadal ważnych obserwacji.

Nie włączamy własnych zapisów Search cache/puli Spotify, snapshotów playlist ani rotacji seedów: normalne pozyskiwanie nie zeruje uczenia. Stan dowodów Last.fm i historii jest celowo porównywany konserwatywnie, więc odświeżenie danych może częściej zresetować pamięć i ograniczyć efekt optymalizacji. Metadana ma służyć aktualnemu kontekstowi, nie trwale etykietować gatunki lub wykonawców. Uczenie jest weryfikowane ponownie na końcu; przy zmianie kontekstu podczas generowania nie zapisujemy jego obserwacji. Finalna kwalifikacja i blokady zawsze są świeże niezależnie od priorytetu pozyskiwania.

Konto pochodzi ze zweryfikowanej istniejącej sesji monitora, z preferencją dla account_id. Potwierdzone starsze profile.id może ograniczać wyłącznie metadane rotacji; kontrakt tożsamości automatycznych ocen nie jest poluzowany. Brak potwierdzonej sesji wyłącza uczenie. Nie zapisujemy tokenów lub identyfikatora sesji. To nie jest migracja ocen albo dopasowanie ID wykonawców.

Klucz `omm_search_priority_v1` jest lokalny i poza prefiksem eksportu `office_` oraz whitelistą D1. Maks. 128 obserwacji / 64 KiB, TTL 24 h; nie evictujemy cache/preferencji dla jego zapisu. Nieobsługiwany lub uszkodzony stan nie jest nadpisywany. Zapis przy quota/hash/session error jest opcjonalny i nie unieważnia playlisty. Ostatnie obserwacje różnych kontekstów są zachowywane przy zapisie; to pomocnicza pamięć, nie transakcyjny dziennik ocen. Równoczesne zmiany tej samej obserwacji mogą zostać zastąpione, co ogranicza optymalizację, ale nie zmienia preferencji ani reguł bezpieczeństwa.

Panel techniczny pokazuje liczbę rozważanych zapytań z niższym priorytetem, priorytetowych ponownych prób oraz wynik uczenia (zapisano / zmiana kontekstu / brak pełnych obserwacji / stan niedostępny); nie jest to liczba blokad. LOG1/LOG2 nie dostają nowych pól, schemat i migracja D1 bez zmian. Pamięć nie przenosi się wraz z eksportem na inny komputer; tam zaczyna się od neutralnego priorytetu.

## Weryfikacja i wpływ

Testy pokrywają: próg dwóch obserwacji, cooldown/TTL/clock rollback, reset przy kontekście/kontach/profilach/feedbacku/historii/ustawieniach/dowodach/wygaśnięciu blokad, Lifer (safe > 0, selected = 0), retencję i niepełne wyniki, cache/błędy, deduplikację stron, jeden probe, fallback i twarde blokady, limity pamięci, future schema, brak zapisów preferencji/eksportu/D1, readonly fingerprint, zmianę danych w toku i quota.

Kontrolowane porównanie dla 2/4 osób: po dwóch potwierdzonych niepowodzeniach dotychczasowe źródło nie wydłużało puli, a alternatywny wykonawca daje 2 → 4 utwory przy tym samym jednym Search, z minimum 35 dla każdej osoby i poprawną quota. Nie jest to obietnica wzrostu każdej playlisty; aktualne produkcyjne 60/60 nie może rosnąć powyżej zamówionego limitu. Oczekiwany zysk to mniej powtarzanych zer i większa różnorodność kwalifikowalnej puli. Średnie, ID i kolejność mogą się zmienić wraz z nowo pozyskanymi kandydatami; progów nie obniżamy.

Przed scaleniem: pełne npm test i CI, standardowy benchmark 2/4 cold/warm, Q1 audit 3 warm oraz neutralne porównanie Q1.5/Q1.7 bez wyuczonego stanu przy ustalonym wejściu i losowaniu. Prywatne eksporty pozostają poza repozytorium.

## Smoke i rollback

Po publikacji sprawdzić nagłówek 1.0.6-rc i zwykły wynik 2/4 osób, Skuteczność Search oraz linię Rotacja Search. Zero niższych priorytetów przy pierwszej próbie, zmienionych danych lub częściowej retencji jest prawidłowe. Nie kasować historii/cache ani wywoływać sztucznych pominięć dla testu. Dopiero powtórzone potwierdzone zera w tym samym kontekście uruchomią rotację.

Rollback: revert PR. Q1.5 ignoruje osobny lokalny klucz; nie trzeba kasować danych lub migrować D1. Wycofać przy naruszeniu budżetu/jakości/blokad, błędach runtime, degradacji liczby utworów w kontrolowanych porównaniach albo nadmiernym koszcie CPU. Następny krok po smoke: ocena efektu rotacji na powtarzanych generowaniach; dopiero później decyzja o wydaniu stabilnym lub osobnej, zmierzonej optymalizacji. Q1.6 nadal anulowany.
