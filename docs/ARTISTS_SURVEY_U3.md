# v43.32.U3 — artyści w ankiecie

Edycja artystów wzorcowych i blokowanych przeniesiona z ręcznych preferencji generatora do sekcji „Twoi wykonawcy” wybranej osoby w ankiecie. Linki generatora prowadzą bezpośrednio do właściwej osoby (`taste.html#asia` itd.). Przykłady wykonawców przy gatunkach nadal służą wyłącznie do odsłuchu. Dodatkowe gatunki pozostają w generatorze; wyłączenie ich wpływu jest osobnym zakresem T1.

Zachowane dokładnie klucze `office_seed_<id>` i `office_blocked_<id>`, domyślne Slipknot dla Edyty przy braku klucza i jawne puste pole jako usunięcie blokady. Otwieranie ankiety nie materializuje domyślnych danych i nie normalizuje istniejących list. Brak migracji danych, D1, API lub OAuth. Generator czyta listy ze storage i nie zapisuje ich ponownie podczas zbierania profili, co zapobiega nadpisaniu równoległej edycji z ankiety.

Zapis jest jawny dla każdej listy przez istniejący OmmLocalState.edit / Web Locks. Niezależne listy i osoby zapisują się niezależnie. Konflikt tej samej listy nie nadpisuje nowszego stanu: zachowujemy draft i pokazujemy możliwość wczytania danych do połączenia zmian. Quota zachowuje zapisane dane i draft. Zmiana osoby zachowuje jej draft w bieżącej karcie; opuszczenie strony ostrzega o niezapisanych zmianach. Zakończenie zapisu osoby nie podmienia aktualnie otwartego profilu. Subscription L2 odświeża czyste pola, nie nadpisując draftów; generator zachowuje zaznaczoną obecność i synchronizuje zmiany jak dotychczas.

„Wyczyść ten profil” nadal usuwa wyłącznie oceny gatunków. Listy wykonawców można wyczyścić osobno, zapisując puste pola. Komunikat w ankiecie wyjaśnia tę granicę.

Selekcja, progi, discovery, feedback, RMF i limity pozostają dotychczasowe. Testy obejmują wszystkie profile, istniejące dane, puste/domniemane blokady, przełączanie draftów, quota, konflikty starszego klienta, równoległe karty, generator, linki i układ 360/768/1280px. Przed scaleniem wymagane pełne regresje i CI oraz porównanie generatora z ustalonym zegarem i losowaniem (2/4 profile, cold/warm).

Rollback: revert PR do poprzedniego UX; zachowane listy są od razu czytelne w dawnym generatorze. Nie ma migracji do wycofywania ani zmian produkcyjnych danych D1.
