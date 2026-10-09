# Wykluczenie silnie negatywnego wykonawcy — v43 PR A

Kara wykonawcy jest liczona niezależnie od oceny konkretnego utworu i innych wykonawców. `artistFeedbackScore()` zachowuje dotychczasowy wzór: balance × 18 dla dodatniego feedbacku (limit 90), balance × 55 dla ujemnego (dolny limit −220), dodatkowe istniejące bonusy/kary za jednostronne serie ocen. Dotychczasowy `feedbackScore(track)` nadal sumuje te składniki i ocenę utworu; jego punktacja nie zmienia się.

Utwór nie przechodzi selekcji, jeśli co najmniej jeden wykonawca ma własną karę ≤ −40. Dodatnia ocena utworu lub współwykonawcy nie omija wykluczenia. Zwykłe pojedyncze 👎 daje wykonawcy −55. Pozostaje istniejące przypisywanie faktycznie wystawionej oceny utworu wszystkim jego wykonawcom; samo wykluczenie duetu nie dopisuje żadnego feedbacku partnerowi. Wykluczenie nie zapisuje 🚫, nie usuwa utworów z puli i nie zmienia D1. Usunięcie lub zmiana feedbacku może przywrócić wykonawcę przy następnym generowaniu.

Kontrola obejmuje filtr kwalifikowalności, wejście do selektora grupowego (również bezpośrednich wywołań i wcześniej ocenionych kandydatów) oraz starszy `collectFromQueries()` z puli i nowych stron wyszukiwania. Normalna selekcja, rozluźnienie sąsiedztwa i oba warianty fallbacku korzystają z tej samej przefiltrowanej listy. Dotychczasowa kontrola łącznego feedbacku w fallbacku pozostaje dodatkowo bez zmian.

Licznik `strongNegativeArtistFeedback` pokazuje liczbę odrzuconych kandydatów, nie liczbę wykonawców. Kandydat ma jeden powód odrzucenia zgodnie z istniejącą kolejnością filtrów; jawna blokada lub negatywna ocena dokładnego utworu może zostać policzona wcześniej. Ponowna kontrola na wejściu do selektora nie liczy drugi raz kandydatów już odrzuconych przez filtr puli.

## Wpływ na długość i jakość

Porównano aktualny main 8787ec9 i PR A na identycznej kontrolowanej puli, z Math.random = 0.25, dla dwóch i czterech profili. Pula podstawowa: 16 znanych utworów, po dwa na ośmiu wykonawców, dwa nazwiska z karą −55 (cztery utwory). Rozszerzona pula dodaje cztery bezpieczne zamienniki dwóch innych wykonawców. Cel: 16. Dane Last.fm i preferencje Rock są takie same w obu wersjach.

| Profile | Pula | main | PR A | Średnia każdej osoby main / PR A |
|---|---|---:|---:|---:|
| 2 | bez zamienników | 16 | 12 | 56,04 / 56,04 |
| 4 | bez zamienników | 16 | 12 | 56,04 / 56,04 |
| 2 | z zamiennikami | 16 | 16 | 56,04 / 56,04 |
| 4 | z zamiennikami | 16 | 16 | 56,04 / 56,04 |

PR nie obniża progów, nie zmienia minimum profilu, quota discovery, rozpoznawalności, budżetu API, limitu dwóch utworów ani RMF. Może skrócić rzeczywiste playlisty przy braku bezpiecznych zamienników. Zapis diagnostyki użytkownika nie zawiera pełnej puli ani feedbacku, więc nie pozwala przewidzieć długości 48/60 po tej zmianie.

Regresje obejmują granice −39/−40/−41/−55 (wartości pośrednie symulują liczbowy feedback z importu), pojedyncze 👎, dodatnie maskowanie, współwykonawców w obu kolejnościach, brak przenoszenia kary, przywracanie po usunięciu feedbacku, nieznane nazwiska, cache i nowe wyszukiwania oraz długość/oceny 2/4 profili. Starsza charakterystyka normalnej selekcji została zastąpiona oczekiwaniem wykluczenia.

## Wycofanie

Revert PR A i zwykłe wdrożenie poprzedniego kodu. Bez migracji lub odtwarzania danych: feedback, blokady i pula nie są modyfikowane przez kontrolę. Wycofać przy błędnym przenoszeniu kary, odrzucaniu nazwiska powyżej granicy albo utrzymaniu wykluczenia po poprawnej zmianie feedbacku. Skrócenie playlisty wyłącznie o uzgodnione wykluczenia nie jest regresją.
