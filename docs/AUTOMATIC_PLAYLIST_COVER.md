# Automatyczna okładka — v1.0.0-rc.1

Jeden prosty PR zastępuje dawne COVER1/COVER2. W audycie otwartych PR-ów była tylko dokumentacyjna #1, bez osobnych PR-ów okładek do zamknięcia.

## Mechanizm

Po udanym utworzeniu playlisty, dodaniu utworów, zapisaniu lokalnego wyniku i wyświetleniu linku uruchamia się opcjonalna operacja w tle. Nie jest oczekiwana przez generator, nie wpływa na długość, kolejność ani dopasowanie. Odświeżenie wyniku lub strony nie uruchamia jej ponownie.

Wybór korzysta z istniejącego `groupResult.details.get(track.id).final`. Wyższy wynik wygrywa, remis rozstrzyga rosnący Track ID. Preferowane są cztery różne dostępne grafiki; przy braku alternatyw pozostają powtórzenia. Brakujące pola zajmują neutralne ciemne komórki. Brak wszystkich dostępnych grafik oznacza pozostawienie domyślnej okładki Spotify.

`slimTrack` zachowuje jeden URL obrazu z oficjalnego CDN, bez całych obrazów/base64 w localStorage, D1 czy historii. Dla starszej bazy opcjonalnie wykonywane są maksymalnie cztery GET `/v1/tracks/{id}` dla wybranych utworów. Są to kopie do renderu: nie aktualizują punktacji ani stanu rekomendacji. Nie ma dodatkowych Search, nowej biblioteki, AI ani proxy Cloudflare.

Canvas 512 × 512, 2 × 2 pełne obrazy bez przycinania/zniekształcania. Dolne 64 px zajmuje osobna ciemna stopka z inicjałami (kolejność uczestników, np. A • B • K) i małym OMM. Tekst i logo nie przykrywają grafik albumów. Kwadratowe obrazy są dopasowane proporcjonalnie do komórek z ciemnymi marginesami.

## Oficjalne API i ograniczenia

Źródła zweryfikowane 2026-10-11:
- [Upload Custom Playlist Cover](https://developer.spotify.com/documentation/web-api/reference/upload-custom-playlist-cover): PUT `/v1/playlists/{playlist_id}/images`, surowy Base64 JPEG, `Content-Type: image/jpeg`, maks. 256 KB, scope `ugc-image-upload` i odpowiednie uprawnienia do playlisty.
- [Spotify design guidelines](https://developer.spotify.com/documentation/design): nie przycinać artwork, nie nakładać tekstu, obrazów ani własnego logo. Użytkownik zatwierdził oddzielną stopkę zamiast pierwotnego paska nałożonego na grafikę.

OAuth żąda nowego scope przy następnym normalnym logowaniu. Odświeżenie starego tokenu nie przyznaje dodatkowych uprawnień: istniejąca sesja może zwrócić 403 i pozostawić okładkę Spotify. Nie wymuszamy wylogowania ani ponownej autoryzacji. Aby sprawdzić upload na starym koncie, trzeba raz normalnie zalogować się ponownie i przyznać nowe uprawnienie.

Cała opcjonalna operacja ma wspólny 15-sekundowy termin anulowania. Obrazy używają anonymous CORS; odmowa CDN, brak grafiki, błąd Canvas, przekroczony payload, HTTP 401/403/429/5xx lub sieć pozostawiają domyślną okładkę. JPEG ma trzy poziomy jakości i konserwatywny limit 256000 znaków Base64. Upload używa istniejącego wrappera OAuth (aktualny token, pojedyncze ponowienie wyłącznie jawnego 401); nie ponawia błędów sieciowych ani 429. Nie tworzy ponownie playlisty i nie dodaje drugi raz utworów. Zamknięcie/uśpienie karty może przerwać dekorację, ale gotowa playlista pozostaje sprawna.

## Walidacja i rollback

Testy: końcowy ranking, deterministyczne remisy, duplikaty, 0–4 utworów, inicjały Unicode, brak/złe metadane, rzeczywisty Canvas JPEG i stopka, pojedynczy PUT, maks. cztery odczyty starej bazy, brak mutacji, 401/403/429/500/sieć, anulowanie, scope i zachowanie metadanych. Pełna ścieżka generatora potwierdza działanie bez czekania na okładkę i brak ponowienia przy wyświetleniu zapisanego wyniku. Porównanie 2/4 profili na identycznych danych potwierdza identyczną kwalifikację, oceny i kolejność po dodaniu grafik. Pełny harness i benchmark CI pozostają wymagane. Benchmark selekcji pomija opcjonalną operację graficzną w tle: jego stos pomiarowy nie obsługuje równoległych operacji. Realny Canvas/upload są osobno testowane w playlist-cover.test.mjs.

Nazwa wydania wymaga również rozszerzenia walidatora wersji logów o ściśle ograniczony format `v1.0.0-rc.1`; stare wpisy `v43.*` pozostają poprawne. Bez zmian schematu i migracji.

Rollback: revert tego PR. Po cofnięciu do walidatora bez obsługi RC wpisy z nową wersją mogą dać 409 odczytu historii chmurowej (dane pozostają zachowane); w takim przypadku zachować małą zmianę zgodności walidatora. Nie ma migracji ani nowych ustawień. Dodatkowe URL-e albumów są opcjonalne, stare wydanie je ignoruje. Już ustawione okładki pozostają w Spotify; nie usuwamy ich automatycznie.

Smoke użytkownika: sprawdzić nagłówek v1.0.0-rc.1, przy starszej sesji normalnie zalogować się ponownie, utworzyć nową playlistę dla 2–4 osób. W Spotify po kilku sekundach sprawdzić cztery grafiki, inicjały i OMM w stopce. Odświeżenie OMM nie powinno zmieniać okładki. Brak okładki nie może uniemożliwić odtworzenia playlisty. Nie wykonano rzeczywistego uploadu na koncie użytkownika w środowisku testowym.
