# v43.8.E1 — podgatunki przy wykonaniach orkiestrowych

Po v43.7.E w obu testach produkcyjnych pozostawał Def Leppard / Royal Philharmonic Orchestra — Animal. Log nie zawiera surowych tagów głównego wykonawcy ani albumu, więc nie odtwarza dokładnego wejścia filtra. Audyt potwierdził dwie luki: modernTags rozpoznawał dokładne rock/metal, lecz pomijał hard rock/classic rock/heavy metal; sam tag orchestral/symphonic mógł wyłączyć filtr nawet przy mocnych tagach rockowych.

E1 rozpoznaje rock/pop/metal/punk/blues/hip-hop jako oddzielne słowa w podgatunkach, także przy separatorze - lub /. Nie używa luźnego substringu: popcorn i rockabilly nie są automatycznie uznawane za pop/rock. To nadal mocny tag Last.fm, a nie słabe zapytanie Spotify genre.

Orchestral/symphonic sam w sobie pozostaje chroniony przy braku nowoczesnego dowodu. Przy hard rock + orchestral nie maskuje orkiestrowego wariantu. Silne classical/modern classical/baroque/opera oraz strukturalny tytuł dzieła nadal chronią klasykę. Zwykła wersja Animal bez dodatkowej orkiestry nie jest odrzucana. Pozostałe reguły E, sygnatury feedbacku/historii, A, discovery, progi, budżet API i RMF pozostają bez zmian.

Piętnaście nowych regresji wykorzystuje nazwę Animal, album Drastic Symphonies i obu wykonawców, ale kontrolowane tagi; nie są eksportem rzeczywistych danych użytkownika. Przedstawione logi nie pozwalają zagwarantować odrzucenia przy nieznanych tagach albo mocnym tagu classical. Po wdrożeniu ponowić generację; jeśli Animal pozostanie, potrzebny jest minimalny fragment eksportu z metadanymi tego utworu i tagami Def Leppard, bez tokenów. Nie rozszerzać filtra do automatycznej blokady każdej orkiestry.

Wpływ na długość: może odrzucić kolejne warianty orkiestrowe, bez obniżania jakości. Przy jednym Animal i braku zamiennika wynik może być krótszy o jedną pozycję; generowanie może też dobrać inny bezpieczny utwór. Nie przewidujemy rzeczywistego końcowego wyniku bez całej puli. Dla zwykłych nagrań nowa kontrola nie zmienia kwalifikowalności.

Rollback: revert E1, bez migracji danych lub zmian D1. Wycofać przy fałszywych odrzuceniach klasyki lub zwykłych nagrań. Nagłówki obu stron, tytuły, metadane eksportu i bieżąca diagnostyka: v43.8.E1. Wdrożenie tego zakresu zostało bezpośrednio zatwierdzone przez użytkownika.
