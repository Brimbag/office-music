# Dowody kategorii gatunkowych v43

`groupTrackFeatures()` nadal stosuje istniejące wagi: zapytanie genre Spotify 0,20, tag wykonawcy Last.fm 0,72, tag utworu Last.fm 1,00; rodzice i kategorie pozostają słabszym dowodem. Nie zmienia progów 44/35, limitu wykonawcy, feedbacku, quota discovery ani filtra rozpoznawalności.

Przy wyznaczaniu kategorii funkcja bierze maksymalny dowód wyłącznie spośród aspektów, które tę kategorię tworzą (`genreCategories([aspect])`), i mnoży go przez istniejące 0,58. Dotychczas maksimum pochodziło ze wszystkich aspektów, także niezwiązanych. Bezpośredni silniejszy dowód lub dowód rodzica nie zostaje obniżony — istniejąca reguła maksimum w `addAspectAndParents()` pozostaje bez zmian.

Przykład: `genre:"rock"` (0,20) + tag wykonawcy Jazz (0,72). Przed zmianą Rock awansował do 0,4176 jako derived-category. Po zmianie pozostaje 0,20 i spotify-genre-query. Tag utworu Pop Rock nadal poprawnie wzmacnia Pop (0,82 jako rodzica) i Rock (0,58 jako kategorię); unrelated Jazz nie wzmacnia żadnej z nich.

Zmiana może obniżyć dopasowanie i skrócić wynik na mieszanej puli, ponieważ usuwa fałszywy dowód. Nie należy kompensować tego obniżaniem progów. Weryfikacja obejmuje porównanie punktacji 2/4 osób na tych samych danych i prawdziwy skrypt strony. Rollback: przywrócenie kodu; nie ma migracji danych ani konfiguracji.

## Odświeżenie po B/C — v43.19.G

Gałąź PR #5 zaktualizowana przez merge main `0cb7ef2` (v43.18.C), bez konfliktów. Jedyna zmiana funkcjonalna nadal dotyczy kategorii w groupTrackFeatures; progi kwalifikacji/selekcji, minimum każdej osoby 35, discovery C, pozyskiwanie D, feedback, RMF i state API pozostają bez zmian. Zaktualizowano oznaczenie przyszłego wydania w obu stronach, eksporcie i diagnostyce; nie zmieniono wersji dawnych snapshotów.

Porównanie z zamrożoną funkcją v43.18.C używa aktualnej kwalifikacji i selektora po B/C, bez sztucznego nadpisywania ocen. Dla 2 i 4 osób wynik jest taki sam (kontrolowane preferencje Rock, cel 16):

| Pula | Długość przed → po | Średnia każdej osoby przed → po |
| --- | --- | --- |
| Wyłącznie powiązane dowody | 16 → 16 | 56,04 → 56,04 |
| 12 poprawnych + 4 niepowiązane | 16 → 12 | 53,73 → 56,04 |
| Jak wyżej + 4 bezpieczne zamienniki | 16 → 16 | 56,04 → 56,04 |

W drugim przypadku utwory z zapytaniem Rock i tagiem utworu Jazz tracą fałszywe wzmocnienie Rock: ocena indywidualna 46,7832 → 38,408. Ich maxScore spada poniżej istniejącej bramki kwalifikacji 45, więc nie przechodzą do selektora. Nie zmieniono tej bramki. Zgodne dowody zachowują identyczne wyniki i kolejność. Zero wywołań API w porównaniu. Szczegóły: [genre-evidence-impact.json](fixtures/genre-evidence-impact.json).

Nie prognozujemy skrócenia rzeczywistych playlist na podstawie tej małej puli. Wpływ zależy od udziału błędnie wzmocnionych dowodów i bezpiecznych zamienników. Przed scalenieniem: pełne regresje, CI i zgoda użytkownika. Rollback przez revert tego PR i nowy numer widocznej wersji, bez usuwania cache, preferencji lub danych D1.
