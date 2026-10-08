# D.2 — retencja i rotacja przy stałych limitach (v43.15.D2)

Baza: main po D.1, `4b09437` (v43.14.D1). Osobny PR; nie obejmuje pozyskiwania z #13, nowych progów B, quota C ani aktywacji dopasowań F3. Produkcyjne dane i konfiguracja nie są zmieniane podczas przygotowania PR.

## Retencja

Wspólny moduł `pool-retention.js` obsługuje lokalny zapis Spotify i cloud merge oraz pule Last.fm. Limity pozostają Spotify 2000, Last.fm wykonawcy 1800, Last.fm utwory 3000, TTL odpowiednio 30/45/45 dni. Zapis usuwa wygasłe/nieważne rekordy tak jak wcześniej; nowa polityka działa na nadmiarze ponad limit.

Spotify przy nadmiarze ocenia dopasowanie do **każdego zapisanego profilu**, także nieobecnego. Stosuje istniejące wzory, bramkę normalną lub bezpieczny fallback, rozpoznawalność i mocne discovery. Uwzględnia negatywne oceny utworu/wykonawcy, blokady ID, ręczne blokady danego profilu i filtry wersji. Cooldown i historia odsłuchów nie odbierają długoterminowej wartości kandydatowi — nadal obowiązują w selekcji playlisty. Retencja nie jest nową ścieżką dopuszczania utworów: każdy zachowany kandydat nadal przechodzi właściwe filtry grupy.

Wartościowe rekordy otrzymują pierwszeństwo przed pozostałymi. W ich obrębie rezerwowany jest reprezentant profilu i gatunku, a reszta miejsc wypełniana rundami po wykonawcach. Dopiero potem trafiają pozostałe rekordy według analogicznej reguły. Nie nakładamy limitu dwóch na całą bazę: przy dostępnych miejscach wykonawca może mieć więcej nagrań. Limit dwóch w playliście pozostaje bez zmian. Gdy samych wartościowych rekordów jest więcej niż pojemność, nie da się zachować wszystkich — polityka chroni pokrycie i różnorodność, nie dowolny konkretny rekord.

Spotify grupuje po ID **głównego** wykonawcy, z nazwą jako fallback dla starych rekordów bez ID. Dwa ID o nazwie „Days of the New” mają osobne grupy. Blokada współwykonawcy nadal odbiera priorytet całemu duetowi; nie przenosi się na solo partnera. Duet pozostaje w grupie głównego wykonawcy, więc nie obiecujemy równomiernej retencji każdego współwykonawcy. Last.fm nadal ma tożsamość nazwy i nie rozstrzyga homonimów. Nie przypisujemy automatycznie tagów/ocen do nowego ID i nie aktywujemy propozycji F3.

Last.fm chroni aktualne datowane dowody D.1, wykonawców wzorcowych i pokrycie gustów wszystkich profili. Rezerwuje przedstawicieli profili/tagów i równoważy nagrania po nazwach. Stary `recentCount` nie zapewnia uprzywilejowania. To ochrona lokalnych źródeł, nie dowód, że każdy rekord będzie kwalifikowalny po znalezieniu go w Spotify.

## Świeżość i merge

`savedAt` oznacza czas pozyskania. `lastUsedAt` zapisuje użycie; cache nie odnawia TTL. Nowy rekord ze Spotify cache dostaje czas tej odpowiedzi cache, a istniejący zachowuje swój czas pozyskania. Świeże API nadal odnawia `savedAt`. Tagowe odpowiedzi Last.fm z cache przekazują czas oryginalnej odpowiedzi; nie cofają czasu nowszego rekordu. D.1 nadal liczy ważność każdego odsłuchu według jego daty.

Cloud merge stosuje dokładnie tę samą retencję co świeże API/cache. Przy równych timestampach wybór metadanych jest deterministyczny, a zgodne zapytania łączone. Nowsze użycie nie udaje nowszego pozyskania. Brak migracji D1, nowych endpointów lub zwiększenia rozmiaru dopuszczalnych żądań; `lastUsedAt` zwiększa rzeczywisty rozmiar rekordów. Zapis przy quota zachowuje poprzednią pulę. Nie zmieniono feedbacku, historii ani blokad.

## Rotacja źródeł

Last.fm wykonawcy rotują po całym zbiorze pasującym do tagów. Przy stałej puli 1800 nazw limit 18 daje propozycję każdej nazwie w 100 turach, zamiast losowania wyłącznie pierwszych 54. To szansa w kolejce źródeł, nie obietnica wywołania Spotify dla każdej nazwy w tej turze.

Utwory Last.fm rotują rundami po wykonawcach, a następnie ich nagraniach. Duży katalog nie zajmuje wszystkich pierwszych miejsc. Lokalny stan `office_lastfm_source_rotation_v1` przechowuje najwyżej 64 zestawy tagów/rodzajów źródła. Działa bez API i jest zachowywany w eksporcie/importowaniu stanu; nie trafia do D1. Awaria zapisu kursora nie przerywa wyboru, ale może powodować powtórne propozycje. Zmiana składu puli wpływa na kolejność; gwarancja 100 tur wymaga stałego zbioru/tagów oraz udanego zapisu kursora.

Nie zwiększono budżetów Spotify 12/14/16 ani Last.fm 24/28/32, liczby stron, retry czy limitów wyników wyszukiwania. Nie wprowadzono dodatkowego wywołania API ani pamięci nieskutecznych zapytań Spotify — tę ostatnią warto rozważyć dopiero w osobnym zakresie, po pomiarze #13.

## Testy i wpływ

21 nowych testów plus 159 wcześniejszych. Obejmują rzeczywiste zapisy pełnych pul, świeże API, cache, cloud merge i odwrócenie kolejności stron, wyparcie przez Rework, TTL, quota, małe/duże katalogi, wszystkie 1800 nazw, ograniczenie stanu rotacji, nieobecny profil, homonimy i współwykonawców. Test równoważności snapshotów sprawdza niezmienione wyniki rozpoznawalności, feedbacku i punktacji. Snapshoty są optymalizacją tylko oceny retencji; zwykła selekcja zachowuje dotychczasowy sposób odczytu.

| Scenariusz kontrolowany | Dawna retencja | D.2 |
|---|---:|---:|
| Napływ 20 nagrań jednego wykonawcy do 2000 rekordów | 1981 różnych wykonawców | 2000 |
| To samo przy 3000 rekordów | 2981 | 3000 |
| Pełna pula Last.fm, 20 nowych nazw | Audyt sprzed D.1: stare liczniki odrzucały wszystkie | 20 przyjętych, 20 usuniętych; zachowane zachowanie D.1 |
| Jeden kwalifikowalny utwór + flood Rework | Utrata utworu przez API/merge | Utwór zachowany |

Porównanie 10 stałych odpowiedzi **dla każdego** wariantu 2/4 osoby: po napływie 10 Reworków dawna polityka wypierała sześć dobrych nagrań i dawała 0 utworów; D.2 zachowuje 6 utworów trzech wykonawców. Średnia każdego profilu: 56,04, jedno wyszukiwanie API w każdej próbie. To celowo skonstruowana regresja pełnej puli, nie mediana produkcyjnych playlist. Nie ma podstaw do prognozy +10% na live bez rzeczywistych porównywalnych eksportów.

Długość może wzrosnąć dzięki zachowaniu dobrych nagrań lub spaść, jeśli nowa rotacja trafi na nazwiska bez odpowiednich wyników Spotify. Progi pozostają takie same: nie uzupełniamy słabszą muzyką. Retencja chroni co najmniej reprezentanta danego pokrycia, nie gwarantuje identycznej liczby utworów każdego profilu ani wszystkich gatunków przy dowolnie przepełnionym zbiorze.

Benchmark `node tests/benchmarks/pool-retention.mjs` porównuje zamrożony zapis puli z `4b09437` i D.2 na pełnych pulach 2000/1800/3000. Mierzy zapis jednej odpowiedzi, model i selekcję celu 60; 10 naprzemiennych prób po rozgrzewce dla 2/4 profili. Nie obejmuje sieci, całego primingu, synchronizacji Last.fm ani zapisu playlisty w Spotify. Wynik p95 służy przeglądowi, nie jest kruchą asercją czasu w CI. Pozostaje ryzyko kosztu oceny przepełnienia; kopie Last.fm/feedbacku są indeksowane raz na ocenę, bez ponownego parsowania całych pul dla każdego utworu.

## Wycofanie i dalsze kroki

Wycofać przy utracie chronionego pokrycia mimo dostępnej bezpiecznej alternatywy, obejściu blokad/progów, przekroczeniu budżetu/limitów, błędach merge/quota albo istotnym blokowaniu interfejsu. Porównać eksporty 2/4 profili przed/po; sprawdzić długość, różnych kwalifikowalnych wykonawców, oceny każdej osoby, koncentrację top 1/top 5 oraz faktyczne rozmiary lokalnego i zakodowanego stanu D1.

Rollback: revert PR i kolejny numer nagłówków/modelu/eksportu. Starszy kod ignoruje nowe pola i klucz rotacji. Nie kasować D1, preferencji, blokad ani historii. Revert nie odtworzy rekordów wypartych już podczas działania nowej polityki; przed wdrożeniem zachować lokalny eksport, a odzyskiwanie danych wykonać osobno z zatwierdzonej kopii. Po zatwierdzonym wdrożeniu D.2 odświeżyć i ponownie zweryfikować osobny #13 na aktualnym main. Bez automatycznego scalenia D.2 lub #13.

## Wynik pomiaru wydajności

[Surowy pomiar Chromium](fixtures/pool-retention-performance.json), 10 prób po rozgrzewce na tej samej maszynie:

| Osoby | p95: poprzedni zapis + model/selekcja | p95: D.2 + model/selekcja | Zmiana | Długość / średnie |
|---|---:|---:|---:|---|
| 2 | 1228 ms | 1384 ms | +12,7% | 60 → 60; każdy profil 56,04 → 56,04 |
| 4 | 1220 ms | 1386 ms | +13,6% | 60 → 60; każdy profil 56,04 → 56,04 |

W tym scenariuszu koszt jest poniżej proponowanego +20%. To pomiar części obliczeniowej opisanej wyżej, nie p95 całego procesu live ani maksymalna długość blokowania interfejsu. Przepełnienie z 2000 kwalifikowalnymi nagraniami może kosztować więcej niż fixture ze 100; pomiar nie jest dowodem limitu dla wszystkich pul. Dodatkowe testy obejmują rzeczywistą proweniencję odpowiedzi cache Last.fm i cold start/eksport/import nowych danych lokalnych.
