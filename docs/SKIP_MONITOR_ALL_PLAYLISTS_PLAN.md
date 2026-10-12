# Następny etap — pominięcia bez wyboru playlisty (plan)

Plan przygotowany na prośbę użytkownika podczas U4; implementacja/scalenie/wdrożenie nie należą do U4. Zakładamy **wszystkie playlisty Spotify odtwarzane na zalogowanym koncie**, także spoza OMM. To świadomie szerszy zakres niż dotychczasowy S1/S2; album, radio i odtwarzanie bez potwierdzonego context playlist pozostają poza obserwacją.

## Interfejs i uzbrajanie

Jeden przełącznik „Obserwuj pominięcia na playlistach” zamiast wyboru playlisty/start/stop. On uzbraja istniejącego wspólnego konsumenta Spotify M; off zatrzymuje go i usuwa pending przejście. Krótki status: działa/oczekuje na playlistę/przerwa/nie działa, nazwa lub identyfikator bieżącego kontekstu gdy już znany bez dodatkowego pobierania. Nie dodawać osobnego pollera lub GET zawartości każdej playlisty.

Preferencję on można zachować per zweryfikowane konto/komputer, ale aktywna sesja ma deadline max8h od świadomego włączenia. Reload może wznowić wyłącznie tę samą, jeszcze ważną sesję po weryfikacji konta i przywództwa karty; zaczyna od nowego baseline, bez backfillu przerwy. Po deadline przełącznik wyłącza się, kolejne8h wymagają włączenia. Jeśli ta zmiana trwałego uzbrajania okaże się zbyt duża, pierwsza wersja może pozostać off po reload — decyzję ustalić przed implementacją. UI nie może deklarować aktywności bez działającego konsumenta. Generowanie nadal pauzuje obserwację; po nim nowy baseline i wznowienie wyłącznie ważnej aktywnej sesji.

## Kontekst i bezpieczeństwo detekcji

Monitor używa istniejącego snapshotu account/device/contextURI/TrackID/progress/duration/isPlaying/timestamp. Kontext musi być poprawnym Spotify playlist URI; lokalne metadane nie wybierają właściciela konta. Na wejściu/zmianie playlisty, konta lub urządzenia zerować baseline: przejście między playlistami samo nie tworzy pominięcia. Podobnie podcast/RMF, pauza, seek, naturalny koniec, luka, błąd API i nieznany context. Prawdopodobne pominięcie dopiero przy ciągłych obserwacjach dwóch różnych utworów na tym samym urządzeniu i playliście. Nadal nie da się niezawodnie poznać intencji użytkownika.

Deduplikacja, lease/Web Locks, single-flight, 429/backoff i limity wspólnego M pozostają. Dziennik S1 nadal lokalny100/30dni, tylko nowe zdarzenia i źródłowy playlistID, bez importu testowych pominięć. Nie przypisywać utworom ocen z historycznego dziennika.

## Oceny S2 i zgodność

Przełącznik obserwacji **nie włącza kar**. Dotychczasowy opt-in S2 pozostaje osobno. Rozszerzenie kar na playlisty spoza OMM wymaga jasnej informacji użytkownikowi i osobnego zatwierdzenia semantyki; najbezpieczniej w pierwszym PR automatycznie obserwować wszystkie playlisty, a kary pozostawić ograniczone do potwierdzonych playlist OMM. Wówczas interfejs ma jeden przełącznik obserwacji, istniejące ustawienie kar nie jest dodatkowym wyborem playlisty. Zakres ewentualnego rozszerzenia ocen będzie odrębnym PR.

Zachować ręczne 👍/👎, reset, decay/cap, izolację account_id i brak blokad wykonawców. Nie przenosić ocen po nazwach/ID playlist, nie migrować preferencji/D1 w celu rozszerzenia monitora. Stary selektor można ukryć, stare klucze pozostawić do rollbacku; nowy schemat sesji addytywny i ignorowany przez stary klient.

## Testy i wpływ

Mock desktop: playlisty OMM/obce bez ręcznego wyboru, zmiana contextu w połowie utworu, kolejka/album/radio/null, RMF, same track na dwóch playlistach, pauza/seek/naturalny koniec, early/middle/late/granice, błędy401/403/429, luki/tło, konto/device, on/off, deadline/reload, dwie karty, generowanie i wznowienie. Test brak dodatkowych API gdy off i jeden wspólny odczyt z RMF. Brak kar dla starych/testowych zdarzeń oraz obcych playlist w pierwszym zakresie.

Pierwszy PR nie zmienia rekomendacji ani długości playlist; wpływ to czytelniejszy UX i jawnie uzbrojone obserwacje. Pełne regresje/CI oraz smoke na desktop Spotify z playlistą OMM i inną playlistą, bez naliczania ocen testowych. Wycofać przy fałszywych zdarzeniach na zmianie kontekstu/lukach, duplikatach/karach poza zatwierdzonym zakresem, pollingu po off lub przekroczeniu API. Rollback kodu nie kasuje dziennika/ocen; wyłączenie konsumenta i revert bez migracji.
