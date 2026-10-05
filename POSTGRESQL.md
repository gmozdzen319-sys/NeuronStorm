# PostgreSQL — wersja 0.17.0

Zmiana jest przygotowana lokalnie. Nie oznacza, że aplikacja na Renderze została już przełączona. Stare pliki `local-app/data/auth.sqlite`, WAL i SHM pozostają nietknięte; aplikacja nie odczytuje ich i nie importuje rekordów.

## Uruchamianie

Wymagane są Node.js 24+ i prywatna zmienna środowiskowa `DATABASE_URL` wskazująca PostgreSQL. Na Renderze ma to być **Internal Database URL** bazy w tym samym regionie co aplikacja. Sekret znajduje się wyłącznie w ustawieniach usługi, nigdy w kodzie, przeglądarce ani na IPFS.

Obecne polecenia Rendera pozostają obsługiwane:

```text
Root Directory: puste
Build Command: npm install --prefix local-app
Start Command: node local-app/render-start.mjs
```

Pierwszy start tworzy pusty schemat w PostgreSQL. Kolejne starty sprawdzają rejestr migracji i nie kasują danych. Migracja i jej zapis w rejestrze odbywają się w jednej transakcji, pod blokadą zabezpieczającą równoległy start instancji. Zmieniona treść zastosowanej migracji blokuje start; kolejne zmiany schematu wymagają nowego pliku SQL. Brak połączenia z bazą blokuje start — aplikacja nie wraca po cichu do SQLite.

`GET /healthz` sprawdza połączenie z bazą. W konfiguracji Rendera można później wybrać ten adres jako Health Check Path. Nie zmieniono panelu ani ustawień wdrażania.

## Zakres danych

`local-app/db/migrations/001_initial.sql` obejmuje wszystkie 35 dotychczasowych tabel: konta, sesje, wyzwania i podpisy, profile i kategorie, pytania i uczestników, odpowiedzi i sloty, Debate i obecność, głosy, powiadomienia, zaakceptowane odpowiedzi, archiwum, zapisane odpowiedzi, zgłoszenia, blokady, płatności, nagrody, statystyki, zgodę na geolokalizację i akceptację regulaminu.

Dodatkowo są `schema_migrations` oraz `used_transactions`, wspólny rejestr użytych transakcji NS. Archiwum jest nadal zapisywane przez triggery w tej samej transakcji co zmiana pytania/odpowiedzi. Eksport TXT jest strumieniowany, bez tworzenia trwałego pliku na dysku aplikacji.

Daty pozostają liczbami milisekund; identyfikatory i liczniki wracają do API jako bezpieczne liczby. Kwoty tokenów pozostają tekstem i są liczone przez BigInt. Format danych API i mechanizm podpisu portfela są zachowane.

`local-app/db/database.mjs` zarządza pulą maksymalnie 5 połączeń. Transakcja używa jednego połączenia przez cały czas. Blokady pytań obejmują odpowiedzi, głosy, edycje, moderację, akceptację i wygaśnięcie. Potwierdzanie płatności wykonuje zapytania do Quai przed rozpoczęciem transakcji, a potem ponownie sprawdza stan pod blokadą.

## Testy

Z katalogu projektu:

```text
npm test
```

Ten zestaw uruchamia testy SQL i HTTP na PGlite (silnik PostgreSQL w WebAssembly) przez prawdziwy sterownik `pg`. Tworzy odizolowane bazy testowe. Nie korzysta z produkcyjnego `DATABASE_URL`. PGlite obsługuje jeden backend, więc nie zastępuje testu blokad między niezależnymi sesjami PostgreSQL.

Pełne testy na tymczasowym, natywnym PostgreSQL 18:

```text
npm --prefix local-app run test:postgres:embedded
```

Serwer działa wyłącznie na localhost, z losowym portem i hasłem; po testach jest zatrzymywany, a jego własny katalog tymczasowy usuwany. Nie tworzy usługi systemowej. Skrypt pokazuje osobno przygotowanie bazy, start i testy. Na Windows sterowanie przez `pg_ctl` nie oczekuje na zamknięcie potoków odziedziczonych przez działający serwer.

Weryfikacja 05.10.2026: **104/104 testy zaliczone na natywnym PostgreSQL 18.4**, bez pominięć. Bazę testową uruchomiono z terminala użytkownika, ponieważ środowisko agenta ogranicza uruchamianie natywnych procesów PostgreSQL. Zestaw obejmuje również dwie niezależne pule połączeń przy równoczesnej akceptacji odpowiedzi i wygaśnięciu pytania. Baza Rendera nie była używana.

Alternatywnie dla istniejącej **testowej** instancji PostgreSQL na `127.0.0.1`: ustawić `NEURON_TEST_DATABASE_URL`, potem uruchomić `npm --prefix local-app run test:postgres`. Konto testowe musi móc tworzyć bazy. Testy tworzą i usuwają wyłącznie własne bazy o losowych nazwach `ns_test_*`.

## Kolejność przed produkcją

1. Przejrzeć lokalne zmiany i uzyskać pełny zielony wynik testów na natywnym PostgreSQL 18.
2. Potwierdzić, że Render ma aktualny `DATABASE_URL` dla `neuron_storm_app_v2` oraz właściwy region. Nie ujawniać wartości.
3. Dopiero po zgodzie użytkownika wykonać push i deploy. Push może uruchamiać automatyczny deploy, zależnie od ustawień Rendera.
4. Sprawdzić log „PostgreSQL ready”, `/healthz`, rejestrację, profil, pytanie, odpowiedź i Debate na kontach testowych.
5. Za zgodą wykonać restart aplikacji i potwierdzić zachowanie profilu, sesji, wątków i głosów. Sprawdzić kopie zapasowe bazy w Renderze.

Oddzielna baza PostgreSQL przechowuje dane niezależnie od uśpienia, restartu i podmiany kontenera aplikacji. Dla tych danych aplikacja nie wymaga Render Persistent Disk. Deploy nie chroni przed błędnym SQL, ręcznym usunięciem bazy lub utratą usługi — kopie zapasowe nadal są potrzebne. Nie należy wracać do starego kodu SQLite po rozpoczęciu używania PostgreSQL; poprawki i ewentualny rollback kodu muszą zachować obsługę PostgreSQL.

## Kierunek IPFS i Quai

Interfejs pozostaje oddzielony w `local-app/public`, reguły dostępu i trwały zapis pozostają w API, a dane off-chain w PostgreSQL. Ten etap nie przenosi frontendu na IPFS ani nie wdraża smart kontraktów.

Przed IPFS trzeba osobno skonfigurować adres API, dozwolone originy i sposób obsługi sesji cross-origin; obecne zabezpieczenia Host/Origin i cookies SameSite=Strict celowo nie zostały poluzowane. Reputacja on-chain, rundy i wypłaty NS będą wymagały kontraktów oraz indeksowania zdarzeń z obsługą potwierdzeń i reorganizacji. PostgreSQL pozostanie miejscem profili, treści, moderacji i sygnałów Anti-Fraud. Sam Anti-Fraud Engine nie został dodany w ramach migracji.
