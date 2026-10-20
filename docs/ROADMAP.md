# Roadmapa i zaparkowane zakresy

Stan: 2026-10-12, zatwierdzone wydanie stabilne `1.0.12`; smoke S3.1 (#53) pozytywny. Źródło aktualnych statusów; [IMPLEMENTATION_QUEUE_V43](IMPLEMENTATION_QUEUE_V43.md) jest chronologiczną historią, nie bieżącą listą zadań. Poniższe propozycje nie upoważniają do implementacji/scalenia.

## Stan pierwotnych punktów

| Punkt | Aktualny stan |
| --- | --- |
| 1–6 | Wdrożone: harness, API stanu, hierarchia ankiety, dowody gatunkowe, ujemny feedback, końcowa quota discovery. |
| 7 | Wdrożone LF1: retry/próby/sukcesy, częściowe wyniki; LF3: obserwacja jednej pary kont. |
| 8 | Wdrożone D/D.1/D.2 i Q1.1–Q1.5/Q1.7: pozyskiwanie, retencja, audyty, optymalizacje. Dalsze poprawy wymagają mierzalnego przypadku; nie zwiększamy limitów ani obniżamy jakości. |
| 9 | Wdrożone kontekstowe filtry E/E.1, w tym Rework i wersje orkiestrowe. Dalsze warianty tylko po potwierdzeniu błędu. |
| 10 | Wdrożone L1/L2: import/odzyskiwanie i konflikty/synchronizacja stron. |
| 11 | Wdrożone LF2: bounded katalog, TTL, merge/CAS, zgodność starszych klientów. Raw cache lokalny. |
| 12–13 | Wdrożone LOG1/LOG2; migracja i pozytywny produkcyjny smoke potwierdzone. Nie ponawiać migracji. |
| 14 | Wdrożone U3: artyści w ankiecie, zachowane klucze. |
| 15 | **Zaparkowane T1**: gatunki wyłącznie z ankiety; ręczne pola nadal istnieją. Osobna zmiana funkcjonalna, nie UX. |
| 16 | Wdrożone U1/U2: generator zgodny z mockupem, duże kafelki obecności dostępne z klawiatury. |
| 17–18 | Zastąpione jednym wdrożonym COVER: automatyczny kolaż/upload bez dodatkowego UI. |

Dodatkowo wdrożone: indywidualne minimum35 (B), blokada konkretnego Spotify ID z powodem (F2), dowody katalogowe (F3), P–P4/progress/OAuth, wspólny monitor M, głośność V2, dziennik S1 i opcjonalne kary S2. Dawne ograniczenia V (względny procent, cap70, wyłączanie przy zmianie karty) nie opisują V2.

## Kolejność dalszych kroków

1. **Stabilizacja obecnego RC** — po tym PR dokumentacyjnym obserwować 2/3/4 osoby i powtarzalne generowania bez kasowania cache; dla Q1.7 sprawdzić potwierdzone obniżenie priorytetu, powrót po cooldown i neutralizację po zmianie kontekstu. Zbierać długość, indywidualne wyniki, discovery, różnorodność, czas/Search i błędy. Osobno smoke RMF w przypiętej karcie oraz ręcznych zmian urządzenia/głośności. Nie naliczać ocen z testowych pominięć. Wersję stabilną i zakres wydania ustalić po obserwacji.
2. **P5 — dalsza optymalizacja cache, warunkowo** — tylko jeżeli aktualne pomiary pokażą istotny koszt. Porównanie tych samych danych i identycznych wyników/żądań; invalidacja profili, historii, feedbacku. Nie łączyć ze strojeniem selekcji. Wycofać przy różnicach jakości lub nieaktualnym cache.
3. **T1 — gatunki tylko z ankiety, po decyzji produktowej** — wykorzystać istniejący eksperyment A/B/C; B bez dawnych stylów i wzorców, C zachowuje punktację wzorców bez aktywnego odświeżania. Sprawdzić wpływ na długość i dopasowanie 2/4 osób, pozostawić stare klucze do rollbacku. Brak wskazanego zwycięzcy dla wszystkich danych.
4. **F4 — automatyczne dopasowanie Spotify–Last.fm, badanie przed implementacją** — tylko potwierdzone katalogowe dowody, nie sama nazwa/popularność. Najpierw próbka homonimów, miary błędów i addytywny plan danych. Bez automatycznego przenoszenia ocen. Days of the New z różnymi Spotify ID jest wymaganym przypadkiem regresyjnym; masowa migracja niezatwierdzona.
5. **E.2 — dodatkowe wersje, warunkowo** — En Directo/inne tylko po udokumentowanym błędzie. Mały niezależny PR, ochrona zwykłych tytułów i klasyki, bez poszerzania filtra na podstawie samego słowa.

Nie ma obowiązku wdrożyć wszystkich zaparkowanych pomysłów przed stabilnym wydaniem. Dalsze nowe funkcje monitora, edytor okładek ani zwiększanie pul nie mają zatwierdzonego zakresu.

## Anulowane i zastąpione

- **Q1.6 anulowany**: poprawny zapis artystów wzorcowych po stronie użytkownika. Nie implementujemy automatycznej korekty nazw/ID seedów ani migracji ocen w tym zakresie. To nie jest zgoda na F4.
- Pierwotne ręczne rozróżnianie setek artystów (F) wycofano; nie przywracamy tego UI.
- COVER1/COVER2 zastąpiono prostym automatycznym COVER.
- Historyczny handoff PR #1 opisuje v42 i niewykonane już wtedy audyty; nie należy scalać go jako aktualnej dokumentacji. Ten PR dokumentacyjny zastępuje jego rolę, bez automatycznego zamykania starego PR.

## Dowody i ograniczenia

Q1.7: regresje wydania 937/937 i CI main zakończone sukcesem. Smoke użytkownika 2026-10-12: **4 osoby, 60/60, 22,4s, Search12/12, discovery21/60 (35%, limit21), 59 wykonawców ze współwykonawcami**, dopasowanie72,6/65,0/72,6/72,7, słabe0. Rotacja: obniżone0, próby0, uczenie zapisane lokalnie. Potwierdza udane generowanie i zapis obserwacji, nie rzeczywistą skuteczność obniżania priorytetu. Kopia lokalna nie jest dowodem zapisu dziennika w chmurze; raport osobno potwierdza sukces preferencji i wcześniejsze potwierdzenie LF2 bez nowego zapisu.

Porównania między kolejnymi raportami nie izolują efektu wersji od wzrostu puli i zmian historii. Mock testy nie potwierdzają rzeczywistych capabilities Spotify ani dostępności produkcji.

Dla każdego przyszłego PR: aktualny main, jeden zakres, testy graniczne i pełne CI, wpływ na długość/jakość, rollback. Migrowanie D1 jest odrębnym autoryzowanym działaniem. Użytkownik zatwierdził przejście z RC do stabilnego `1.0.12`; wcześniejsze wpisy poniżej dokumentują historię kandydatów.

## Q1.8 — zatwierdzona diagnostyka kontekstu

Użytkownik zatwierdził Q1.8 (`1.0.7-rc`) oraz scalenie/wdrożenie po udanych testach. Lokalnie pokazuje obszary zmiany fingerprintu, bez zmiany jego pól, selekcji ani uczenia. [Zakres, testy i rollback](Q1_8_CONTEXT_DIAGNOSTICS.md). Następnie smoke i diagnoza źródła zmian; P5 nadal warunkowy, Q1.6 anulowany.

## Q1.9 — fałszywa invalidacja po LF2

Zatwierdzony zakres `1.0.8-rc`: odtworzony import własnego katalogu usuwa puste opcjonalne pola dowodów, bez zmiany analizy. Normalizacja tylko reprezentacji katalogu utworów w kontekście; istotne pola/kolejności nadal chronione. [Diagnoza, testy i rollback](Q1_9_LASTFM_CONTEXT.md). Następnie smoke uczenia i dalsza stabilizacja, P5 nadal warunkowy.

## Q1.10 — świeżość i usunięcia cache

Zatwierdzony `1.0.9-rc`: opis nieaktualnej obserwacji Last.fm z ostatnim potwierdzonym wynikiem oraz lokalne liczniki usunięć cache (TTL/quota/invalid/migration/import). Bez zmian reguł cleanup i algorytmu. [Testy, ograniczenia i rollback](Q1_10_CACHE_DIAGNOSTICS.md). Następnie smoke i decyzja o wydaniu stabilnym.

## U4 — uporządkowanie diagnostyki

Zatwierdzone `1.0.10-rc`: jeden panel/5 sekcji, kopiowanie raportu, bez zmian rekomendacji i danych. [Opis](GENERATOR_UX_U4.md). Następnie smoke i decyzja o stabilnym wydaniu. Przygotowano wyłącznie plan [obserwacji wszystkich playlist](SKIP_MONITOR_ALL_PLAYLISTS_PLAN.md); rozszerzenie monitora i ocen nie jest wdrażane w U4.

## S3 — obserwacja bez wyboru playlisty

Zatwierdzone `1.0.11-rc`: jeden przełącznik, automatyczne konteksty wszystkich playlist, reset na zmianie playlisty/device, pauza/wznowienie po generowaniu bez wydłużenia8h, off po reload. Kary wyłącznie dla potwierdzonych TrackID z zapisanych snapshotów OMM, opt-in nadal osobny. [Zakres i smoke](SKIP_MONITOR_S3.md). Naprawa separatorów kopiowanego raportu U4 w tym samym PR. Plan trwałego uzbrajania z poprzedniego dokumentu pozostaje odłożony, nie jest częścią pierwszego S3.

## S3.1 — kandydat przed wydaniem stabilnym

Zatwierdzony PR stabilizacyjny `1.0.12-rc`: opcjonalne nazwy nowych zdarzeń z istniejącego monitora, zgodność starych rekordów i aktualne dokumenty. [Smoke, ograniczenia i rollback](JOURNAL_NAMES_S3_1.md). Po pozytywnym krótkim smoke decyzja o wydaniu stabilnym; nie wdrażamy zaparkowanych P5/T1/F4/E.2 ani trwałego uzbrajania/kar obcych playlist.

## Wydanie stabilne 1.0.12

Użytkownik potwierdził działanie S3.1 i zatwierdził stabilne wydanie z domyślną obserwacją i karami po weryfikacji Spotify. Zachowujemy wcześniejsze wyłączenia; obce playlisty i historyczne/testowe wpisy nie są oceniane. [Zakres i rollback](STABLE_1_0_12.md). Następnie krótki smoke ustawień/startu po reload; P5/T1/F4/E.2 pozostają zaparkowane. Nie wykonujemy migracji D1.

## 1.0.13 — blokada po pominięciu

Użytkownik zatwierdził implementację, scalenie i wdrożenie twardej blokady dokładnego Track ID na 14 dni oraz ustalił jej pierwszeństwo przed 👍 i wyłączeniem kar. [Kontrakt i regresje](TRACK_COOLDOWN_1_0_13.md). Poprzednia specyfikacja S2 opisywała wyłącznie punktację; audyt pozostaje historycznym opisem 1.0.12.

## 1.0.14 — wspólne blokady odtworzeń

16.10.2026 użytkownik zatwierdził scalenie i wdrożenie PR #57. Rejestr
blokad odtworzeń współdzielony per account_id, bez zmian rekomendacji
i reguł pominięć. [Kontrakt i procedura](CLOUD_PLAY_COOLDOWN.md).
Rzeczywisty test A→B i synchronizacja komputera z historią **zaparkowane
do 18.10.2026** — użytkownik nie ma do niego wcześniej dostępu. Bez
automatycznego importu backupu/generowania playlist. PR #56 osobno.

## 1.0.15 — odczyt starszej historii

20.10.2026 użytkownik zatwierdził scalenie i wdrożenie PR #56:
normalizacja przed walidacją/scalaniem, odporność na pojedyncze uszkodzone
pola i jawne zatrzymanie przy uszkodzonej całej historii. Zachowano końcową
kontrolę i synchronizację z 1.0.14. [Zakres i regresje](PLAY_HISTORY_AUDIT_FIX.md).
Sprawdzone generacje na dwóch komputerach nie naruszały znanych blokad;
rzeczywisty test generowania z cache wyszukiwań pozostaje otwarty.
Bez migracji D1 i zmian algorytmu punktacji.
