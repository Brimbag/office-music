# AGENTS.md — Office Music Mixer (OMM)

## Cel i aktualny stan
Office Music Mixer to prywatna aplikacja webowa do tworzenia wspólnych playlist Spotify dla osób obecnych w biurze. Język interfejsu i komunikacji projektowej: polski. Stan bazowy na 2026-10-08: **v42**. Repozytorium: `Brimbag/office-music`; produkcja: `https://office-music.pages.dev/`.

**Najważniejsza zasada:** najpierw przeczytaj rzeczywisty kod i dokumenty. Ten dokument opisuje intencję i reguły regresji, a nie dowodzi, że każda cecha jest już zaimplementowana bezbłędnie. Rozbieżności między dokumentacją i kodem należy zgłosić.

## Środowisko i architektura
- Statyczny frontend bez wymaganego procesu build: `index.html` (generator) i `taste.html` (ankieta).
- Cloudflare Pages automatycznie wdraża `main`; endpoint D1 w `functions/api/state.js`; binding D1 `DB`.
- Spotify OAuth Authorization Code z PKCE w przeglądarce; redirect URI: `https://office-music.pages.dev/` (końcowy `/` jest istotny).
- Last.fm: scrobble, artyści, tagi i utwory. Historyczna baza tagowa Last.fm w v42 pozostaje lokalna. Spotify candidate pool i trwałe preferencje synchronizują się przez D1.
- `localStorage` pełni rolę cache/fallback. Istniejący import/eksport JSON służy także do migracji i backupu.
- Nie wprowadzaj frameworka, bundlera, dużej migracji ani nowej usługi bez planu i zgody.

## Bezpieczeństwo i dane
- Nie publikuj client secret Spotify, Last.fm shared secret, access/refresh tokens, kodów OAuth ani innych sekretów w repozytorium, D1 lub logach.
- Publiczne identyfikatory aplikacji i klucze do API publicznych różnią się od sekretów; sprawdź rzeczywisty zakres uprawnień.
- Zapis/odczyt w D1 musi identyfikować konto po zweryfikowanym tokenie Spotify po stronie serwera. Nie ufaj identyfikatorowi przysłanemu przez frontend.
- Każdy nowy endpoint (np. logów) musi kontrolować uwierzytelnienie, własność konta, dane wejściowe i zakres dostępu.
- Nie wykonuj bez zgody migracji destrukcyjnych, czyszczenia D1, usuwania danych użytkowników lub zmiany konfiguracji produkcyjnej.
- **Do audytu:** `functions/api/state.js` sprawdza `user.account_id` z `/v1/me`; typowa odpowiedź Spotify Web API używa `user.id`. Zweryfikuj na podstawie aktualnego kontraktu API i działającego środowiska, zaproponuj test i bezpieczną poprawkę. Nie zmieniaj w ciemno.

## Niezmienniki algorytmu i funkcji
- Bartek jest profilem głównym; inne profile: Edyta, Asia, Monika. Wynik grupowy wykorzystuje oceny indywidualne, least misery, fairness, xQuAD i MMR.
- Preferencje gatunkowe z `office_taste_profile_v1`: ❤️ aktywne discovery; 🙂 wspólny grunt; 🚫 ogranicza eksplorację danego gatunku, ale nie jest globalną blokadą artysty.
- Ręcznie zablokowany artysta (oraz blokada 🚫 wykonawcy z feedbacku) jest twardo wykluczony; 👎 utworu blokuje dokładny utwór, a inne utwory wykonawcy otrzymują karę.
- v40: bardzo ujemny feedback wykonawcy `<= -40` wyklucza z końcowego fallbacku; w v42 normalna selekcja nadal może go dopuścić. **To zgłoszony problem do v43, nie istniejące zabezpieczenie całościowe.**
- Utwór rzeczywiście odsłuchany: blokada na 14 dni. Cooldown wykonawcy: 2 godziny po faktycznym odsłuchaniu. Samo wygenerowanie playlisty nie jest odsłuchaniem i nie blokuje utworu.
- Ten sam artysta maks. dwa razy w playliście; unikaj sąsiadujących powtórek, docelowy odstęp co najmniej 5 utworów.
- Preferuj długość mniejszą od celu zamiast wypełniać listę utworami łamiącymi kryteria jakości.
- Normalny próg `groupBase >= 44`; końcowy fallback `groupBase >= 35` i żaden profil nie może mieć mniej niż 35. Nie przywracaj wymogu `max score >= 65`.
- W finalnym fallbacku górna quota discovery odnosi się do zamówionej długości, a nie bieżącej; to pomaga uzupełniać wynik, ale może dawać 49–68% discovery w krótkich playlistach. Naprawić świadomie, nie przez arbitralne obcięcie.
- Filtry wersji utworów ograniczają remiksy, live, acoustic, instrumental, edity itd.; `Rework` do uzupełnienia w v43. Remaster może być akceptowany według istniejących reguł.
- Nie osłabiaj reguł rekomendacji ani filtra rozpoznawalności bez analizy diagnostyki i testów porównawczych.
- Last.fm recent scrobbles i Spotify recently played są źródłami faktycznych odtworzeń; nie traktuj wygenerowanych playlist jako historii odsłuchów.
- RMF Fakty: godziny 09, 10, 12, 14, 16; limit oczekiwania do ok. :55; odcinek typu `HH:00 Fakty`, bez „Fakty sportowe”; dodawanie Spotify `Add to Queue`, nie gwarantuje pozycji „następny”. Zachowaj obecne diagnostyki i zachowanie przy pauzie.
- Zachowaj eksport/import, ochronę przed quota `localStorage`, ostatnie trzy snapshoty playlist, otwieranie Spotify/YouTube, czyszczenie starych własnych playlist (unfollow >72h), polski bonus oparty o Last.fm, synchronizację chmury i automatyczne odświeżanie Last.fm.

## Procedura pracy Codexa
1. Sprawdź bieżący stan repozytorium; porównaj ze specyfikacją. Gdy plan zmienia zachowanie, najpierw pokaż wpływ na reguły i ryzyka.
2. Dla prac większych niż mała poprawka: przygotuj plan, testy i zakres. Dziel v43 na małe, niezależne PR-y.
3. Pracuj na osobnej gałęzi, PR do `main`; bez automatycznego scalenia lub wdrożenia produkcyjnego bez zatwierdzenia.
4. Przed PR: sprawdź składnię JS z obu plików HTML (wyodrębnione skrypty) oraz funkcji Cloudflare; uwzględnij błędy runtime, zwłaszcza kolejność inicjalizacji `const` i `let` (samo `node --check` tego nie wykrywa).
5. Testuj reprezentatywne przypadki algorytmu: 2 i 4 osoby; znane/discovery; silny ujemny feedback; limit wykonawcy; historia faktycznie odsłuchanych utworów; cold start przeglądarki; brak API/429; short-playlist stop; import/export; quota storage.
6. Dla D1 przygotuj jawny SQL migracji, scenariusz rollbacku i testy rozdzielenia kont. Nie zakładaj, że nowa tabela już istnieje.
7. W PR opisz: co się zmieniło, testy, wpływ na dane, ryzyko produkcyjne i potrzebne działania ręczne Cloudflare/Spotify.
8. Aktualizuj numer wersji we wszystkich miejscach interfejsu i diagnostyki. Poprzednio v42 omyłkowo wyświetlała v41.

Zobacz `docs/ARCHITECTURE.md` oraz `docs/ROADMAP.md`.