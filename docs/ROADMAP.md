# OMM — roadmap i backlog

**Na dzień 2026-10-08:** wersja produkcyjna v42. To jest plan, nie lista rzeczy już wdrożonych. Wersja v43 NIE została jeszcze zaimplementowana.

## Faza 0 — bezpieczne przekazanie projektu do Codexa
- [ ] Przeczytaj aktualne `index.html`, `taste.html`, `functions/api/state.js` i dokumentację.
- [ ] Ustal faktyczne kontrakty lokalnego i chmurowego stanu; wylicz wszystkie używane klucze `office_*`.
- [ ] Dodaj podstawowe testy smoke/regresyjne oraz zapis bieżącego zachowania, bez zmian algorytmu.
- [ ] Zweryfikuj obsługę Spotify `/v1/me`: `account_id` w aktualnym kodzie vs standardowe `id`.
- [ ] Zaproponuj iteracyjną modularizację monolitycznego HTML, bez wielkiego rewrite.
- [ ] Wybierz workflow: gałęzie, PR-y, testy, świadome scalanie do `main` (Cloudflare auto deploy).

## P0 — błędy jakości i stabilność rekomendacji
- [ ] Napraw przypadki przepuszczania artysty z `feedback <= -40` w normalnej selekcji. Sprawdź semantykę 👎 i 🚫; nie utożsamiaj automatycznie kary z ręczną blokadą bez decyzji produktu.
- [ ] Opracuj bezpieczniejszą quota discovery: cel 30% nie powinien dawać 68% przy 31/60. Zachowaj zdolność generowania dłuższych list i brak wymuszonego słabego fallbacku.
- [ ] Zdiagnozuj filtr rozpoznawalności na zimnej i dojrzałej bazie Last.fm, z licznikami przyczyn odrzucenia.
- [ ] Rozszerz pozyskiwanie zróżnicowanych wykonawców, zamiast podnosić limit 2 utworów na artystę.
- [ ] Zbadaj występowanie tych samych utworów w nowych playlistach z uwzględnieniem rzeczywistych scrobbli. Generowanie samo w sobie NIE ma blokować powtórek.
- [ ] Dodaj filtr nazwy `Rework` jako wariantu, zachowując logikę dopuszczania remasterów.

## P1 — dane i diagnostyka
- [ ] Zaprojektuj i przetestuj synchronizację trwałej, zwartej bazy Last.fm przez D1, z limitem rozmiaru, TTL i regułami merge. Raw cache Last.fm pozostaw lokalny. Nie zakładaj bezrefleksyjnego przechowywania całych surowych odpowiedzi.
- [ ] Oddziel log generowań od `app_state`; zaprojektuj D1 `generation_log`, zapis diagnostyk tylko dla zalogowanego właściciela, retencja 50–100 generowań na konto.
- [ ] Proponowany **niezaaplikowany** schemat:
```sql
CREATE TABLE IF NOT EXISTS generation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  playlist_size_requested INTEGER,
  playlist_size_created INTEGER,
  selected_profiles TEXT,
  diagnostics_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_log_account_created
ON generation_log (account_id, created_at DESC);
```
- [ ] Zaprojektuj API `GET/POST /api/logs` lub odpowiednik z walidacją tożsamości; rozważ osobną chronioną stronę `logs.html`.
- [ ] W głównym UI zostaw tylko wynik utwory/cel, dopasowania, odkrycia, PL, krótki komunikat o skróceniu playlisty.

## P2 — UX v43
- [ ] `index.html`: wybór obecnych osób kafelkami; Bartek aktywny jako główny profil.
- [ ] W nagłówku: status Spotify, D1, Last.fm (login z konfiguracji, nie pole do codziennego wpisywania); krótkie info o synchronizacji.
- [ ] Główny przycisk „Generuj playlistę” jako duże CTA, obok ustawienia długości, blokad powtórek, rozpoznawalności i discovery.
- [ ] Rozdziel generowanie od funkcji administracyjnych: import/eksport, ręczna chmura, odświeżanie w panelu „Narzędzia i dane”.
- [ ] Przenieś artyści wzorcowi i blokowani do `taste.html`, zachowując istniejące klucze i dane.
- [ ] Usuń ręczne pole gatunków na stronie głównej; rekomendacje gatunkowe pochodzą wyłącznie z ankiety `office_taste_profile_v1` (przed zmianą przetestuj profile).
- [ ] `taste.html`: start od kafelków osób, po wyborze ankieta, YT przy przykładach, powrót do wyboru.
- [ ] Pozostaw RMF jako osobną sekcję, nie mieszaj do narzędzi administracyjnych.

## P3 — okładka playlisty
- [ ] Po stworzeniu playlisty wybierz 4 **różne albumy i wykonawców**, spośród utworów finalnej playlisty o najwyższym score. Ustal i udokumentuj, czy score jest punktacją końcową, czy zawiera kary kolejnościowe zależne od kontekstu.
- [ ] Utwórz z obrazów albumów kolaż 2x2 i tekst: `OFFICE MIX`, inicjały obecnych (np. `B · E · A`), data generacji w strefie polskiej.
- [ ] Kompresja JPEG <=256 KB; zweryfikuj wymagania aktualnego Spotify API, w tym scope `ugc-image-upload`, uprawnienia, CORS, dostępność i tryb development.
- [ ] Błąd pobierania lub uploadu okładki nie może unieważnić utworzonej playlisty; pozostaw domyślną miniaturę Spotify.
- [ ] Opcja włącz/wyłącz automatyczną okładkę. Zmiany scopes OAuth wymagają ponownej zgody.

## Weryfikacja przed wdrożeniem
- [ ] 2 i 4 osoby; różne rozmiary do 60/90; również 22/60, 41/60, 31/60 jako przypadki regresyjne.
- [ ] Discovery i limit wykonawcy bez pogarszania jakości; scenariusze testowe z feedback <= -40.
- [ ] Puste `localStorage` vs dojrzała baza; tryb offline i 429; last.fm freshness TTL.
- [ ] Synchronizacja D1 po loginie, po zmianie gustów, dwóch przeglądarkach; rozdzielenie kont.
- [ ] RMF przy aktywnym Spotify, pauzie, równoległej ręcznej edycji kolejki (bez obietnicy pozycji „następny”).
- [ ] Brak przechowywania sekretów/tokenów i brak regresji quota `localStorage`.
- [ ] Działający OAuth redirect ze slashem, import/eksport, edycja gustów, ostatnie playlisty, sprzątanie >72h.
- [ ] Numer wersji spójny w tytule, UI, diagnostyce; PR zawiera listę ręcznych kroków Cloudflare/Spotify.

## Zasady priorytetyzacji
1. Najpierw bezpieczeństwo danych i regresje, potem niezawodność generowania.
2. Nie obniżaj progu profilu 35, normalnego progu grupy 44 ani nie zwiększaj limitu artystów bez dowodów.
3. Nie zmieniaj RMF na podstawie jednego niekontrolowanego testu kolejki.
4. Wdrażaj małymi PR-ami, każdy z własnym testem i jasnym rollbackiem.