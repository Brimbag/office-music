# PR V — opcjonalna głośność Faktów, v43.37.V

## Zachowanie i zakres

Osobny konsument odczytowego monitora M. Funkcja wyłączona po każdym otwarciu strony, uzbrajana wyłącznie przełącznikiem w panelu RMF danej karty. Zapisywany lokalnie jest tylko gain (osobny `office_rmf_volume_settings_v1`, integer 0–20, default 10). Nie synchronizujemy uzbrojenia ani poziomu przez D1, import, eksport lub inne komputery. Stare enabled/slots i wszystkie preferencje muzyczne pozostają nietknięte. Brak SQL, nowych OAuth scopes i zmian algorytmu, feedbacku, discovery, tworzenia playlist, kolejki lub watchera publikacji RMF.

`target = min(70, round(baseline * (1 + gain / 100)))` tylko dla baseline <70. Przy baseline >=70 nie obniżamy poziomu. PUT tylko jeżeli target > baseline. Przykłady dla +10%: 0→0 (bez zapisu), 15→17, 20→22, 40→44, 65→70, 70/90/100 bez zmian.

Regularne Fakty identyfikuje Spotify Episode ID i właściwy show `2BeZqsvzZUSldlZWvjeGe3`, dokładny tytuł `HH:00 Fakty` (00–23) i data wydania. Rejestr do 100 ID wykorzystuje już wykonywane odczyty katalogu RMF. Nieznany odtwarzany odcinek: ograniczony GET `/episodes/:id` tylko po jawnym włączeniu i przy kwalifikowalnym urządzeniu, z kontrolą zwróconego ID/show/URI/tytułu. Sportowe i ten sam tytuł innego show odpadają. Nie dodajemy pollingu katalogu ani kolejki. Samo zakolejkowanie nie jest początkiem Faktów.

## Bezpieczne zapisy i powrót

Wymagany świeży snapshot zweryfikowanego konta/sesji: znane aktywne device.id, restricted=false, supports_volume=true, integer volume_percent. Sama obecność desktop Spotify nie wystarcza. Scope read/modify-playback-state już deklarowane; nie każdy istniejący token lub konto ma uprawnienia/Premium.

Przed PUT zapisujemy intent w lokalnym IndexedDB `omm_rmf_volume_v1`, store intents. Wiersz na konto zawiera wersję, właściciela, sesję, device/episode ID, baseline/target, phase, czas i revision; bez tokenów i bez surowego playback. Atomowe claim oraz CAS aktualizacji/przejęcia zapobiegają równoczesnemu podbiciu w kartach tego samego origin. **Intent nie wygasa automatycznie**: druga karta/reload nie mogą uznać podwyższonej głośności za normalny baseline. Brak zapisu intentu oznacza brak PUT; nie kasujemy innych preferencji/cache po quota.

Stany: applying → boosted → restoring → idle; manual/recovery wstrzymują automatyczne zmiany. Jeden sekwencyjny zapis na cykl, następnie fresh GET wspólnego monitora potwierdza faktyczny poziom i urządzenie. Dwa kolejne regularne odcinki zachowują baseline muzyki; nie mnożymy gain. Koniec, pominięcie, muzyka, pauza lub wyłączenie: restore tylko gdy urządzenie/sesja pozostają te same i świeży poziom nadal odpowiada target. Po pauzie nie podbijamy ponownie tego samego odcinka. Zaobserwowana ręczna zmiana wygrywa i nie powoduje odtworzenia baseline.

Zmiana urządzenia/sesji/lidera, luka >10s, błąd lub niepotwierdzony zapis: recovery, bez automatycznego PUT na inne urządzenie ani ponownego boost. Przycisk „Sprawdź zapisany poziom” odczytuje świeży stan i pyta o konkretny poziom. Nie przejmujemy ani nie usuwamy intentu applying/restoring przez pierwsze 30 s, gdy inna karta może jeszcze oczekiwać na zapis. Potwierdzenie jest sprawdzane ponownie (konto/sesja/device/revision/current). Gdy current != target lub zapis ma phase manual, można tylko zachować bieżącą wartość i usunąć intent. Ręczne ustawienie dokładnie naszego target pozostaje nierozróżnialne dla API. Web API nie zapewnia atomowego porównania i zapisu: zmiana wykonana przez inny kontroler pomiędzy GET a PUT również może być nierozpoznana. Wymagana jedna świadomie uzbrojona przeglądarka/komputer; lokalna koordynacja nie obejmuje innej maszyny.

Ukrycie/pagehide: wyłączenie sterowania i best-effort świeży odczyt oraz restore. Po powrocie brak automatycznego uzbrojenia, pozostający intent wymaga sprawdzenia. Przed generowaniem zatrzymujemy V i próbujemy zakończyć znany cykl; V nie odpytuje w trakcie generowania ani nie zmienia jego danych. W razie logout lub zdalnej zmiany tokena utrata potwierdzonej sesji blokuje zapis i zachowuje recovery. **Zamknięcie/awaria/uśpienie przeglądarki lub sieci nie gwarantuje powrotu głośności.** Limit 70%, małe względne wzmocnienie, jawny komunikat i trwały lokalny intent ograniczają ryzyko; nie zastępują wykonania API po zamknięciu.

## API, OAuth i budżet

Wyłącznie GET metadanych odcinka i PUT `/me/player/volume?volume_percent=N&device_id=ID`. Nie zmieniamy Windows, play/pause, transferu urządzeń ani kolejki. Każdy request pobiera aktualny token; jawna odpowiedź 401 dopuszcza jeden retry wyłącznie odrzuconego requestu przez dotychczasowy PKCE single-flight/rotację refresh token. Drugie 401 kończy próbę. 403 wskazuje uprawnienia/Premium; 429 zachowuje Retry-After (sekundy/data, bez krótszego ponowienia), zatrzymuje konsumenta; sieć/5xx/timeout nie ponawiają PUT. Nie logujemy treści prywatnych błędów ani tokenów. Deadline 5s obejmuje OAuth, request i metadane; późny wynik nie usuwa zapisu recovery. Samo rozpoczęcie PUT nie dowodzi, że Spotify zmieniło poziom.

Przy wyłączonym V zero dodatkowych GET/PUT. Włączony V wykorzystuje polling M: jeden wspólny cykl co 5s (12 cyklicznych GET/min podczas odtwarzania), nie oddzielny timer. GET tuż przed i po zmianie są dodatkowymi odczytami potwierdzającymi, widocznymi w liczniku M; nie wliczamy ich do obietnicy 12 cyklicznych GET/min. Sporadyczny lookup tylko dla nieznanego episode ID. Nie jest to globalna gwarancja limitu API Spotify. Po błędzie metadanych konsument zatrzymuje się; ponowne uzbrojenie nie wyprzedza cooldown/Retry-After. Po niejednoznacznym zapisie intent blokuje nowe podbicie do jawnego sprawdzenia.

## Weryfikacja i rollout

Testy jednostkowe oraz Chromium z mock API: muzyka/Fakty/muzyka, poziomy i rounding, skip/pauza/disable/tło, manual override, powtórki i kolejne odcinki, urządzenie/lider/sesja/gap, capabilities/null/restricted, błędny show/ID/URI/sport, 401/403/429/5xx/network/timeout i późna odpowiedź, brak ślepego retry, quota, reload/persistent intent i atomowe wykluczenie dwóch rzeczywistych kart. Sprawdzamy wspólny monitor oraz rejestr z katalogu bez dodatkowej kolejki. Pełne `npm test`, CI i sparowany benchmark 2/4 profili cold/warm potwierdzają brak zmiany długości/ID/punktacji/requests generatora z V wyłączonym.

Fizyczny smoke test po wdrożeniu należy wykonać świadomie: jedna widoczna karta, aktywny desktop Spotify, supports_volume=true, poziom np.40, włączyć +10%; regularne Fakty →44, muzyka →40. Następnie ręczna zmiana w Faktach, skip, disable i sprawdzenie poziomu po przerwie. Mock nie potwierdza możliwości realnego urządzenia/Premium. Nie wykonujemy prywatnych zmian na Spotify użytkownika z tego środowiska.

## Rollback

Przy regulacji niewłaściwego urządzenia, kumulacji lub nadpisaniu zaobserwowanej ręcznej zmiany wyłączyć V. Najpierw zakończyć aktywny cykl, użyć sprawdzenia zapisanego poziomu lub skorygować go bezpośrednio w Spotify. Dopiero potem revert PR V do M. Sam revert kodu **nie cofnie** wysłanej zmiany Spotify i nie gwarantuje cleanup po awarii. Zachować lokalny intent dla diagnostyki/odzyskania; brak DROP, migracji D1 i usuwania preferencji. Przy rollbackie starszy kod ignoruje addytywne klucze.

Następny osobny zakres: S1, konserwatywny dziennik prawdopodobnych pominięć, bez zmiany punktacji. S2 dopiero po zatwierdzeniu kumulacji/wygasania/resetów i wykazaniu wpływu na 2/4 profile; nie należy do V.
