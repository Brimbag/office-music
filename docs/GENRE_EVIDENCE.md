# Dowody kategorii gatunkowych v43

`groupTrackFeatures()` nadal stosuje istniejące wagi: zapytanie genre Spotify 0,20, tag wykonawcy Last.fm 0,72, tag utworu Last.fm 1,00; rodzice i kategorie pozostają słabszym dowodem. Nie zmienia progów 44/35, limitu wykonawcy, feedbacku, quota discovery ani filtra rozpoznawalności.

Przy wyznaczaniu kategorii funkcja bierze maksymalny dowód wyłącznie spośród aspektów, które tę kategorię tworzą (`genreCategories([aspect])`), i mnoży go przez istniejące 0,58. Dotychczas maksimum pochodziło ze wszystkich aspektów, także niezwiązanych. Bezpośredni silniejszy dowód lub dowód rodzica nie zostaje obniżony — istniejąca reguła maksimum w `addAspectAndParents()` pozostaje bez zmian.

Przykład: `genre:"rock"` (0,20) + tag wykonawcy Jazz (0,72). Przed zmianą Rock awansował do 0,4176 jako derived-category. Po zmianie pozostaje 0,20 i spotify-genre-query. Tag utworu Pop Rock nadal poprawnie wzmacnia Pop (0,82 jako rodzica) i Rock (0,58 jako kategorię); unrelated Jazz nie wzmacnia żadnej z nich.

Zmiana może obniżyć dopasowanie i skrócić wynik na mieszanej puli, ponieważ usuwa fałszywy dowód. Nie należy kompensować tego obniżaniem progów. Weryfikacja obejmuje porównanie punktacji 2/4 osób na tych samych danych i prawdziwy skrypt strony. Rollback: przywrócenie kodu; nie ma migracji danych ani konfiguracji.
