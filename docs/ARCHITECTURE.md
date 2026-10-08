# OMM — architektura i umowy działania

**Stan odniesienia:** 2026-10-08, produkcja v42. Dokument stanowi handoff, należy zweryfikować każdy szczegół implementacyjny w repozytorium.

## Repozytorium i wdrożenie
- GitHub `Brimbag/office-music`, gałąź produkcyjna `main`.
- Cloudflare Pages `https://office-music.pages.dev/` z automatycznym deploymentem z `main`.
- Główne pliki zweryfikowane w repozytorium: `index.html`, `taste.html`, `functions/api/state.js`. Obecny `index.html` ma tytuł v42.
- Brak wymaganego bundlera/build step w obecnym wariancie; nie zakładaj istnienia test harness ani package.json.
- GitHub Pages `https://brimbag.github.io/office-music/` jest starszym adresem; produkcyjny redirect Spotify to wyłącznie aktualnie skonfigurowany adres Cloudflare ze slashem.

## Spotify
- Login w przeglądarce przez Authorization Code + PKCE, bez Spotify client secret.
- Redirect URI musi identycznie odpowiadać Spotify Developer Dashboard: `https://office-music.pages.dev/`.
- Spotify Web API do profilu, wyszukiwania utworów, historii odtworzeń, generowania playlist, modyfikacji kolejki, czyszczenia starych playlist.
- Development Mode może ograniczać dostęp do użytkowników z allowlisty. Nie zakładaj dostępu dowolnego konta Spotify.
- Spotify cache wyszukiwań ok. 24 h; candidate pool ok. 30 dni, limit ok. 2000 utworów; w v42 jego kompaktowa wersja jest synchronizowana z D1 i łączona między przeglądarkami.
- Po wygenerowaniu nowej playlisty nie oznaczamy jej utworów jako odsłuchanych. Tylko faktyczna historia słuchania uruchamia blokadę powtórek.
- Snapshoty 3 ostatnich playlist lokalnie: `office_recent_playlists_v1` (linki, identyfikatory, diagnostyka, możliwość feedbacku po odtworzeniu widoku).
- Automatyczny cleanup dotyczy własnych playlist nazwanych `Office Music Mixer`, starszych od 72 h; Spotify API wykonuje unfollow, a nie nieodwracalne usunięcie.

## Last.fm
- Historia recent scrobbles: główne źródło faktycznych odtworzeń (istotne ostatnie 14 dni); Spotify recently played jako uzupełnienie/fallback.
- Tagowe top artists/top tracks służą do rozpoznawalności i silniejszych wskazówek gatunkowych niż zapytanie `genre` do Spotify.
- v42: Last.fm baza wykonawców/utworów i raw cache są lokalne dla każdej przeglądarki; **nie są synchronizowane przez D1**. Użytkownik potwierdził, że cold start w biurze ma dużo mniejszą bazę.
- Przed generowaniem: warunkowe odświeżenie recent Last.fm (ok. 10 min), bazy tagowej (ok. 60 min); ręczny refresh wymusza aktualizację.
- Rotacja tagów i budżety ograniczają ruch API; polskie tagi mają oddzielną rotację, ale nie przekraczają całkowitego budżetu.
- Nie umieszczaj Last.fm shared secret w frontendzie. Klucz publicznego odczytu nie potrzebuje shared secret.

## Stan i Cloudflare D1
- D1 baza projektu: `office-music-db` (nazwa według konfiguracji wdrożeniowej), Pages binding `DB`.
- Aktualna tabela stanu:
```sql
CREATE TABLE IF NOT EXISTS app_state (
  account_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, state_key)
);
```
- Endpoint `functions/api/state.js`: `GET /api/state`, `PUT /api/state` z `Authorization: Bearer <Spotify access token>`.
- Funkcja wywołuje `GET https://api.spotify.com/v1/me`, następnie pobiera/zapisuje rekordy tylko dla zweryfikowanego konta Spotify; D1 zapisuje JSON stanów pod `state_key`.
- **Ważny punkt do audytu:** kod funkcji odczytuje `user.account_id` zamiast zwyczajowego `user.id`. Produkcyjna synchronizacja była obserwowana jako działająca, ale bez testu kontraktu nie wolno uznać tego pola za prawidłowe. Trzeba przejrzeć aktualne odpowiedzi API i bezpiecznie zweryfikować poprawkę.
- v41: ręczny upload/download 22 kluczy trwałego stanu zadziałał i został potwierdzony między przeglądarkami.
- v42: automatyczny sync trwałych danych oraz skompaktowanej puli Spotify; lokalny cache/fallback pozostaje ważny.
- NIE synchronizuj tokenów, PKCE verifier, auth code ani danych sesyjnych. Zachowaj ostrożność przy merge stanów, debouncingu i potencjalnych konfliktach między przeglądarkami.

## Profile i gust
- Profile: Bartek, Edyta, Asia, Monika. Bartek jest główny, waga 1,3; wcześniej posiadał ręczne gatunki, które użytkownik wyczyścił, by korzystać wyłącznie z ankiety.
- `taste.html`: ankieta ❤️ (do aktywnego discovery), 🙂 (wspólna baza), 🚫 (bez discovery w tej gałęzi); `office_taste_profile_v1`.
- Ręczne listy artystów wzorcowych i blokowanych wykonawców obecnie edytowane w `index.html`; plan v43 przenosi je do `taste.html` bez utraty kluczy i istniejących danych.
- W v43 planowane jest całkowite usunięcie ręcznych pól gatunków z generatora i opieranie preferencji gatunkowych wyłącznie na ankiecie; to **jeszcze nie jest stan v42**.
- Przycisk ▶ YT przy przykładach/artystach działa jako link do wyszukiwania YouTube, nie API ani gwarantowany autoplay.

## Dobór utworów (stan bazowy v42)
1. Pobierz faktyczną historię odtworzeń i kandydatów Spotify, odśwież Last.fm według TTL.
2. Odrzucaj negatywny feedback na dokładny utwór, jawne blokady wykonawców, niepożądane warianty i wykryte duplikaty.
3. Anty-powtórki: utwór faktycznie odtworzony w ostatnich 14 dniach, wykonawca w ostatnich 2 godzinach.
4. Filtr rozpoznawalności korzysta z lokalnych danych Last.fm. Jeżeli Last.fm nie jest odbudowany, może nadmiernie ograniczyć dostępnych kandydatów; to hipoteza poparta obserwacjami, nie udowodniona zależność przyczynowa.
5. Dla każdej osoby osobny score; agregacja ważona + least misery; fairness, xQuAD, MMR; polski bonus po przejściu progów.
6. Normalne `groupBase >= 44`, fallback `groupBase >= 35` przy minimum 35 dla każdej obecnej osoby. W fallbacku mocno ujemny feedback wykonawcy `<= -40` jest blokowany; w normalnej ścieżce obecnie niekoniecznie.
7. Maksymalnie 2 utwory na wykonawcę, docelowy odstęp >=5 po ponownym ułożeniu playlisty.
8. Discovery docelowo 30%, tolerancja około +/-5 p.p.; fallback używa górnego limitu względem docelowej długości, co przy krótkim wyniku daje większy procent.
9. Przy braku bezpiecznych kandydatów skracaj playlistę, nie obniżaj po cichu progów.

## RMF Fakty
- Spotify show URI: `spotify:show:2BeZqsvzZUSldlZWvjeGe3`.
- Godziny: 09, 10, 12, 14, 16. Szukaj odcinków danego dnia o dokładnej nazwie `HH:00 Fakty`, pomijaj „Fakty sportowe”.
- Polling Spotify faktycznego endpointu nie częściej niż mniej więcej co 5 min; watcher UI może budzić się częściej.
- Okno automatycznego dodania kończy się około :55. Pauza nie oznacza opóźnionego automatycznego wstawienia po godzinie.
- `POST /v1/me/player/queue?uri=...`, z device_id według aktualnej implementacji. Sukces należy oceniać przez HTTP `response.ok`.
- Spotify Add to Queue NIE gwarantuje umieszczenia odcinka zaraz po aktualnym utworze, zwłaszcza przy równoczesnym ręcznym manipulowaniu kolejką.
- Lokalna ewidencja już dodanych: `office_rmf_queued_v1`; diagnostyka `office_rmf_diagnostics_v1` (ostatnie snapshoty). Nie zmieniaj zachowania bez testów na rzeczywistym odtwarzaczu.

## Znane ryzyka i problemy do audytu
- Monolityczny `index.html` (~203 KB na dzień dokumentacji) i kolejność deklaracji runtime: v41 miał błąd `const`/TDZ pomimo poprawnej składni.
- Niewielka lokalna baza Last.fm i filtr rozpoznawalności odrzucały 858–901 utworów w trzech testach 2026-10-08.
- W 3 testach 2026-10-08: 4 osoby 22/60, potem 2 osoby 41/60, potem 2 osoby 31/60; zmieniały się liczba osób, wielkość lokalnej bazy i faktyczna historia, więc przyczyny nie są jeszcze odizolowane.
- W trzecim teście `feedback -55` przy Lady Gaga przepuścił wykonawcę przez normalną selekcję. Wcześniej podobny problem z KATSEYE.
- Discovery 21/31 = 68% w trzecim teście przy celu 30%, zgodnie z obecną awaryjną quota.
- Limit 2 utworów wykonawcy bywa główną blokadą, ale nie należy go automatycznie zwiększać.
- `Rework` powinno dołączyć do listy odrzucanych wariantów.
- Brak kompletnego automatycznego zestawu testów regresyjnych; najpierw zidentyfikuj fragmenty nadające się do testowania bez przebudowy całości.