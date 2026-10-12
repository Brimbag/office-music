# Office Music Mixer — wskazówki pracy

Stan dokumentacji: 2026-10-12, wydanie stabilne `1.0.12` po S3.1 i zatwierdzeniu domyślnych obserwacji/kar. Język interfejsu i komunikacji: polski.

Przed zmianami przeczytaj [architekturę](docs/ARCHITECTURE.md), [roadmapę](docs/ROADMAP.md) i dokument zakresu. Dokumentacja opisuje aktualną implementację; rozbieżności rozstrzygaj przez kod i testy, a następnie zgłaszaj.

## Praca i walidacja

- Frontend to statyczne `index.html` i `taste.html`, bez bundlera/frameworka. `package.json` służy testom. Backend: Cloudflare Pages Functions, binding D1 `DB`.
- Korzystaj z istniejącego checkoutu; nie twórz worktree bez potrzeby wskazanej przez użytkownika. Zachowuj jego lokalne i niezatwierdzone pliki.
- Realizuj jeden zakres na gałęzi od aktualnego main. Nie łącz UX, strojenia selekcji i migracji danych.
- Node 24, `npm ci`, Chromium przez `npx playwright-core install --with-deps chromium` lub `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. `npm test` uruchamia regresje bez produkcyjnych API/D1. Pełne polecenia CI: `.github/workflows/regression.yml`; opis: [TESTING](docs/TESTING.md).
- Testy zmian funkcjonalnych powinny obejmować granice, awarie i kompatybilność danych. Dla zmian pozyskiwania porównuj identyczne dane, zegar i losowanie; nie traktuj kolejnych generowań live jako izolowanego A/B.
- Przed scaleniem sprawdź CI i zakres diffu; respektuj aktualną zgodę użytkownika na scalenie/wdrożenie. Main uruchamia automatyczne wdrożenia. Raportuj dokładny SHA i oddziel status platformy od rzeczywistego smoke użytkownika.
- Numeracja wydania stabilnego: `1.0.12`, widoczna w nagłówku (wcześniejsze kandydaty `1.0.N-rc`). Dokumentacyjny PR nie zmienia wersji aplikacji. Rollback kodu nie cofa danych ani decyzji użytkownika.

## Dane i niezmienniki

- Nie zapisuj tokenów, kodów OAuth, sekretów ani prywatnych eksportów/raportów w repozytorium lub diagnostyce. Testy używają atrap i zanonimizowanych fixture'ów.
- Backend ustala właściciela przez zweryfikowane Spotify `/me` i `account_id`; nie wprowadzaj fallbacku do `id` ani migracji ocen po nazwie.
- Nie zmieniaj produkcyjnych danych/config ani nie wykonuj destrukcyjnych migracji bez autoryzacji. Migracja LOG1 jest wykonana i pozytywnie sprawdzona — nie ponawiaj jej.
- Każda obecna osoba: minimum 35 przed bonusami grupowymi. Maksymalnie dwa utwory na wykonawcę, również współwykonawcę. Kara ręczna wykonawcy ≤ −40 wyklucza utwór we wszystkich ścieżkach, bez przenoszenia kary na innych.
- Discovery: dolny cel miękki, górny limit twardy względem faktycznej długości; nie skracaj poprawnej listy tylko dla minimum discovery. Szanuj świadome 0%/100%.
- Generowanie playlisty nie oznacza odsłuchu. Testowe wpisy S1 nie mogą być użyte do ocen S2. Automatyczny feedback nie blokuje wykonawców.
- Nie zwiększaj limitów pul, API ani nie obniżaj progów jakości w ramach UX/optymalizacji. Zachowuj możliwość odzyskania preferencji przy quota.
- Q1.6 anulowany; dawne ręczne rozróżnianie wykonawców wycofane. Nie przywracaj tych zakresów bez nowej decyzji.
