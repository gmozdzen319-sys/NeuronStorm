# Neuron Storm 0.18.0 — Reputation & Weekly Rounds

## Zakres i zasady

Logika jest w API i PostgreSQL; frontend tylko wyświetla wyniki. Nie wykonano
deployu, operacji na produkcyjnej bazie, zmian usług, smart kontraktów ani nowych
wypłat NS. Istniejące ręczne nagrody i płatności pozostają niezależne.

Punkty przechowujemy jako BIGINT, 100 jednostek = 1 punkt:

| Zdarzenie | Jednostki |
| --- | ---: |
| Helpful formalnej odpowiedzi | +100 |
| Not Helpful formalnej odpowiedzi | -100 |
| Best Answer wybrane przez autora | +500 |
| Helpful / Not Helpful Debate | +25 / -25 |
| Publikacja pytania, odpowiedzi, wiadomości | 0 |

Nie ma obcinania wyników ujemnych. Automatyczny wybór po siedmiu dniach nie jest
wyborem autora i nie daje bonusu +5. Podpis autora przez portfel nadal jest
weryfikowany przez istniejący mechanizm signed actions.

## Historia i tygodnie

Reputation to suma całej historii. Weekly Score to suma zmian w konkretnej rundzie.
Runda zaczyna się w poniedziałek 00:00 UTC i kończy następnego poniedziałku 00:00 UTC
(koniec wyłączny). Wyników nie resetujemy ani nie usuwamy. Puste tygodnie od
pierwszej znanej rundy uzupełniamy przy odczycie listy rund; zakończone otwarte rundy
otrzymują status `closed`. Zamknięcie nie oznacza zatwierdzenia nagród.

Zmiana +1 na -1 tworzy korektę -2. Ponowienie identycznego głosu nie tworzy punktów
ani kolejnego zdarzenia. Cofnięcie +1 tworzy -1. Przykład granicy tygodnia:
niedziela +1, poniedziałek zmiana na -1 = stary tydzień +1, nowy -2, Reputation -1.
Stare rundy nie są przepisywane późniejszymi głosami. Zatwierdzanie i publikacja
wyniku rundy do kontraktu nie są jeszcze zaimplementowane.

`reply_votes` pozostaje źródłem widocznych formalnych głosów, `debate_votes` ma
analogiczną unikalność (element, głosujący). Triggery zapisują każdą skuteczną
zmianę do `reputation_events` w tej samej transakcji. Historia zawiera adresy
głosującego i autora, pytanie, element, typ, poprzednią i nową wartość, zmianę
punktów, czas, rundę, wersję zasad i pochodzenie. Jej UPDATE/DELETE są blokowane.
Pełna historia zdarzeń jest dostępna wyłącznie administratorowi, z paginacją.
Publiczny ranking nie ujawnia adresów portfeli ani treści prywatnych rozmów.

Blokady transakcyjne pytania serializują głosowanie, moderację, płatne edycje,
akceptację i zamykanie. Unikalny indeks blokuje drugi bonus Best Answer dla pytania.
Brak self-vote jest sprawdzany przez API i trigger głosowania.

Moderacyjne ukrycie pytania dodaje korekty usuwające jego aktualne punkty, a
przywrócenie dodaje korekty odwrotne. Wpisy są oznaczone `moderation_hide` i
`moderation_restore`; nie udają nowego działania głosującego. Widoczne głosy
pozostają do przywrócenia. Płatna edycja lub usunięcie odpowiedzi cofa jej głosy
oraz punkty, zachowując ich historię. Zwykłe zamknięcie/wygaśnięcie rozmowy
nie odbiera zdobytej reputacji.

## Kategorie

Kategorie pochodzą z pytania, nie z deklarowanego zawodu autora odpowiedzi.
Jednostki pojedynczego głosu dzielimy między wszystkie kategorie pytania.
Resztę z dzielenia otrzymują kolejno kategorie według stabilnego ID. Przy trzech
kategoriach +100 to 34/33/33, +25 to 9/8/8. Zmiana/cofnięcie stosuje dokładnie
odwrotny podział. Suma kategorii zawsze równa się sumie reputacji, bez mnożenia
punktów. Zmiana kategorii profilu nie przenosi zdobytego doświadczenia.
Main Expertise w rankingu oznacza kategorię z największą zdobytą reputacją.

## Migracja produkcyjna

Nowy plik: `local-app/db/migrations/002_reputation.sql`. Migracja `001_initial.sql`
pozostała niezmieniona. Migracja 002 dodaje sześć tabel:

- `weekly_rounds`: round_id, start_time, end_time, status, reward_pool (dokładny tekst),
  finalized_at, anti_fraud_version;
- `debate_votes`;
- `reputation_events`;
- `reputation_event_categories`;
- `reputation_reviews`;
- `reputation_account_reviews`.

Dodaje też funkcje, indeksy i triggery. Nie usuwa istniejących tabel ani rekordów.
Istniejące głosy i wybory autora tworzą wpisy `legacy_snapshot`. Nie można odzyskać
zmian głosów sprzed wdrożenia tej funkcji. Jeżeli stary głos nie ma czasu przyznania,
używamy czasu utworzenia odpowiedzi; pochodzenie snapshotu jest widoczne w audycie.
Istniejące ukryte pytania/usunięte odpowiedzi są odpowiednio skorygowane.

Runner migracji stosuje migrację i jej sumę kontrolną w transakcji, pod blokadą
schematu, przed otwarciem HTTP. Błąd wycofa migrację i zatrzyma nową aplikację;
nie przełączy jej na pustą bazę. Odczyt i backfill większej bazy wymagają czasu
i miejsca; istnieje 30-sekundowy limit zapytania. Przed deployem wykonać kopię
bazy i sprawdzić jej odtwarzanie. Nie ma gwarancji zerowego ryzyka wdrożenia.

Nie należy uruchamiać starej i nowej wersji jednocześnie jako niezależnych writerów
przez dłuższy czas. Triggery zabezpieczają również głosy zapisywane przez starą
wersję, jednak stare UI ma inne zasady wyświetlania punktów. Revert kodu nie powinien
usuwać nowych tabel ani historii. Nie zmieniać zawartości już zastosowanych migracji.

## UI i API

Profil: Total Reputation, Weekly Score/Rank, Helpful, Not Helpful, Best Answers,
Q&A/Debate Reputation i doświadczenie według kategorii.

Istniejący Weekly Ranking: Top 20/50/100, wybór rundy i kategorii, pozycja, nick,
Main Expertise, Weekly Score, Total Reputation. Remisy mają tę samą pozycję,
a kolejność w remisie jest stabilizowana nickiem i adresem (adres niepubliczny).
Własny wynik obok filtrów jest ogólny, nie ograniczony do wybranej kategorii.

Istniejący Admin Dashboard: przegląd rund, daty/licznik czasu, ranking i szczegóły
użytkowników, historia zdarzeń z adresami/kategoriami, sekcja przygotowania Anti-Fraud.
Nie dodano drugiego panelu. Style bazują na istniejącym tle, cyjanowych/czerwonych
akcentach i kartach; siatka profilu składa się do dwóch kolumn na telefonie.

| Endpoint | Dostęp i zmiana |
| --- | --- |
| GET /api/ranking?round=...&category=...&limit=20/50/100 | Publiczny; rozszerzony istniejący ranking; własny wynik dla zalogowanego |
| GET /api/rounds | Publiczna lista zachowanych rund |
| GET /api/reputation?round=... | Własne wyniki; wymagane logowanie |
| GET /api/profile | Dodano reputation, points teraz oznacza wynik netto |
| GET /api/questions/:id/debate | Oceny i własny głos, opcjonalny ratings=listaID (maks. 200); istniejące uprawnienia rozmowy |
| POST /api/questions/:id/debate/:messageId/vote | Uczestnik/admin z profilem; value -1/0/1, brak self-vote, zablokowane konta nie oceniają się |
| POST /api/questions/:id/replies/:replyId/vote | Istniejący endpoint; nowy ledger transakcyjny |
| GET /api/admin/reputation?round=...&limit=...&page=... | Wyłącznie admin; rundy, użytkownicy, historia i dane review |

## Anti-Fraud i Quai

Ocena kwalifikacji jest oddzielona od widocznego głosu i reputacji. Pola review:
qualified_for_rewards (NULL = nie oceniono), trust_score (0–100), fraud_reason,
rule_version, review_status, reviewed_at/by. Statusy: Clean, Watch, Suspicious,
Rejected, Manually Approved. Obsługujemy review zdarzeń i kont; brak automatycznej
klasyfikacji oraz brak UI/API edycji review w tej wersji. Admin widzi flagowane
przypadki, a nie musi rozwijać całej historii. Brak flag nie oznacza, że konto jest
sprawdzone. Liczniki Before/After Review pozostają Pending, dopóki nie ma ocen.

Przyszły silnik musi oceniać spójnie cały łańcuch głosu i jego korekt; nie wolno
kwalifikować dodatniego wpisu i ignorować jego późniejszego cofnięcia. Pokazany
sumaryczny wynik ocenionych zdarzeń nie jest algorytmem podziału nagród.

Historia zawiera powiązania wallet→wallet, daty oraz konta z accounts.created_at,
potrzebne do analizy wieku kont, grafów wzajemności i intensywności. Nie dodano
nowego zbierania IP ani fingerprintingu. Przyszły etap powinien utrwalić zatwierdzony
snapshot rundy (wersja reguł, uczestnicy, jednostki kwalifikowane, hash/root,
podpis administratora), a następnie przekazać go kontraktowi Quai. Claim i ochrona
przed podwójną wypłatą będą po stronie kontraktu. Nie wysyłamy obecnie nic on-chain.

Frontend na IPFS będzie korzystać z tych samych endpointów i jednostek; przed
przeniesieniem trzeba skonfigurować adres API oraz bezpieczne CORS/sesje cross-origin
(obecnie fetch same-origin, ciasteczka SameSite=Strict). Logika reputacji nie wymaga
przepisania ani domeny Render.

## Zmienione pliki

Nowe: db/migrations/002_reputation.sql, reputation.mjs, public/reputation-ui.js,
test/reputation.test.mjs, ten dokument.

Backend: community.mjs, profiles.mjs, threads.mjs, debate.mjs, admin.mjs,
payments.mjs, server.mjs. W lifecycle.mjs nie potrzeba duplikowania bonusu:
trigger accepted_answers korzysta z istniejącej, podpisanej akceptacji.

Frontend: public/app.js, conversations.js, debate.js, rewards-ui.js, index.html,
style.css. Wersja 0.18.0: package.json oraz package-lock.json.

Testy regresyjne z nowymi oczekiwaniami: test/auth.test.mjs, postgres.test.mjs,
rewards.test.mjs. Dotychczasowe wymagania uprawnień, podpisów i płatności zachowano.

## Walidacja

Nowe testy obejmują głosy własne, powtórzenia, zmianę i cofnięcie głosu,
równoczesne żądania, kategorie, zmianę profilu, Debate, Best Answer, wygaśnięcie,
przejście niedziela/poniedziałek, zachowanie historii, migrację istniejących danych,
moderację oraz ochronę API administratora. Osobny test natywny używa dwóch
niezależnych pul PostgreSQL.

Środowisko agenta blokuje uruchomienie initdb.exe: `could not create restricted
token`. Test natywny należy uruchomić w terminalu użytkownika przed deployem:

```cmd
"C:\Users\kolek\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\kolek\Desktop\Neuron Storm\local-app\test\run-postgres.mjs"
```

Polecenie używa wyłącznie osobnej, tymczasowej bazy na localhost. Nie korzysta z
produkcyjnego DATABASE_URL. Wynik końcowego przebiegu PGlite podano w raporcie zadania.

Końcowy wynik lokalny (5 października 2026): 115 testów, 113 zaliczonych,
0 błędów, 2 pominięte — oba wymagają niezależnych natywnych sesji PostgreSQL.
Sprawdzono składnię 57 plików JavaScript i `git diff --check`.
W lokalnym podglądzie sprawdzono profil i Admin Dashboard przy szerokości 390 px,
ranking oraz wysłanie/ocenę wiadomości Debate przez dwa różne konta testowe.
Wynik renderowania nie zastępuje testu na fizycznym telefonie z portfelem.
Status: implementacja gotowa lokalnie; przed produkcyjnym deployem pozostaje
natywny przebieg testów oraz zgoda właściciela. Nie wykonano push ani deployu.

Aktualizacja walidacji: użytkownik uruchomił pełny zestaw na natywnym PostgreSQL 18
w swoim terminalu i przekazał wynik: 115/115 zaliczonych, 0 błędów, 0 pominiętych
(czas 96,5 s). Potwierdzono także testy dwóch niezależnych pul połączeń.
Ograniczenie walidacji natywnej opisane powyżej zostało tym samym rozwiązane.
Użytkownik udzielił zgody na wdrożenie; publikacja i sprawdzenie produkcji są
kolejnymi krokami, a nie częścią dotychczasowego wyniku testów.
