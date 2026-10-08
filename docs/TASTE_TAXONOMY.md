# Rodziny ankiety v43

Rodziny zachowują istniejące identyfikatory `folk`, `reggae`, `classical`. Ich pierwsze dzieci otrzymują odrębne ID: `folk-general`, `reggae-general`, `classical-general`. Nazwy wyświetlane pozostają bez zmian. Pozostałe ID również pozostają bez zmian. Blokada rodziny znów wyłącza całą gałąź discovery, również przy wcześniej zapisanych pozytywnych ocenach dzieci.

`office_taste_profile_v1` zachowuje `version: 1`. Wspólny skrypt `taste-state.js` dodaje `taxonomyVersion: 2` i kopiuje starą ocenę współdzielonego ID do nowego dziecka tylko raz, jeśli dziecko nie ma już własnej oceny. Zachowuje rodzinę, wszystkie inne oceny, osoby i dodatkowe pola. Migracja następuje przy odczycie istniejącego profilu w ankiecie/generatorze, również po imporcie lub pobraniu starego stanu. Nie wymaga zmian schematu ani ręcznej migracji D1.

Nie da się rozpoznać, czy stara współdzielona ocena była ustawiona na rodzinie, czy na dziecku. Przyjęto zachowanie obu znaczeń: ta sama ocena początkowo na rodzinie i dziecku. Stare `no` blokuje rodzinę zgodnie z regułą produktu; wcześniej zapisane oceny innych dzieci nie są usuwane i wracają po zdjęciu blokady. Po migracji użytkownik może oceniać rodzinę i dziecko niezależnie. Marker zapobiega ponownemu kopiowaniu oceny po jej świadomym usunięciu.

Niepowodzenie zapisu migracji do localStorage nie usuwa starego profilu: obie strony nadal korzystają ze znormalizowanych ocen w pamięci. Warto wykonać istniejący eksport JSON przed wdrożeniem. Rollback kodu zachowuje stare klucze i oceny; v42 nie wyświetla nowych ID dzieci. Aby odzyskać dokładny stan sprzed migracji, użyć wcześniejszego eksportu. Zwykły autosync może zapisać zaktualizowany profil po uruchomieniu v43; w tym PR nie wykonujemy operacji na produkcyjnym D1.
