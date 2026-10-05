# Neuron Storm — aktualne uruchamianie (0.17.0)

Aplikacja wymaga teraz PostgreSQL i zmiennej środowiskowej `DATABASE_URL`. Dane SQLite nie są importowane ani usuwane. Instrukcja, testy i kolejność wdrożenia: [POSTGRESQL.md](POSTGRESQL.md).

Testy lokalne: `npm test`. Start na Renderze pozostaje `node local-app/render-start.mjs`. Przygotowanie kodu nie oznacza wykonania deployu.

Poniższe sekcje są historią rozwoju; dawne informacje o SQLite i uruchamianiu bez PostgreSQL zastępuje powyższa instrukcja.

# Historia lokalnej aplikacji

Właściwy projekt: `C:\Users\kolek\Desktop\Neuron Storm`.

## Podgląd i logowanie
Otwórz **http://localhost:3000** w przeglądarce z Pelagus.
Cały interfejs strony jest po angielsku; komunikacja z użytkownikiem pozostaje po polsku.

1. Kliknij **Sign in with Pelagus** i potwierdź połączenie.
2. Kliknij **Sign message & continue** i podpisz wiadomość w Pelagus.
3. Przy pierwszym logowaniu pojawi się **Create your profile**. Istniejąca sesja również otwiera formularz po odświeżeniu, jeśli profil nie jest jeszcze zapisany.
4. Wpisz pseudonim, dodaj przynajmniej jeden temat i użyj **Save profile**.
5. Zapisany profil otwiera się jako **My Profile**, z przyciskiem **Edit profile**.

Pelagus potwierdza dostęp podpisem wiadomości, bez transakcji. Użytkownik potwierdził działanie poprzedniej wersji logowania; nowy formularz wymaga końcowej próby w jego przeglądarce.
Przeglądarka testowa nie ma Pelagus.

Po ponownym uruchomieniu komputera uruchom `Uruchom Neuron Storm.ps1` przez PowerShell.
Alternatywnie: Node 24+, `node local-app/server.mjs` w folderze projektu.
Serwer przyjmuje połączenia tylko na komputerze lokalnym, na porcie 3000.

## Zaimplementowany zakres
- Prosta angielska strona główna z oryginalnym logo użytkownika i czarno-czerwono-błękitną paletą.
- Rzeczywiste logowanie Pelagus, serwerowa weryfikacja podpisu, trwała sesja i wylogowanie.
- Profil: pseudonim, opcjonalne imię i nazwisko, Work & Education, Hobbies & Interests.
- Wspólne listy tematów, wybór istniejących lub dodawanie nowych przy zapisie profilu.
- Jeden adres = jeden profil; odświeżenie i kolejne logowanie zachowują dane. Edycja własnego profilu.
- Wymagane: pseudonim (do 40 znaków) i co najmniej jeden temat łącznie. Imię i nazwisko do 80 znaków, temat do 60 znaków, do 20 tematów na grupę.
- Kategorie porównywane po Unicode NFKC, usunięciu wszystkich białych znaków i zmianie liter na małe. Pierwsza zapisana forma nazwy zostaje nazwą wspólną. Kategorie w obu grupach są oddzielne.
- Własne dane i tekst użytkowników nie są automatycznie tłumaczone. Pseudonimy nie muszą być unikalne; to adres portfela identyfikuje profil.

Nie wdrożono rozmów, głosów, rankingu, nagród, tokena ani panelu administratora. Nic nie zostało opublikowane.

## Kod i dane
- `local-app/public/`: interfejs, style, oryginalne logo PNG, połączenie z portfelem.
- `local-app/server.mjs`: serwer HTTP, sesje i podpisy.
- `local-app/profiles.mjs`: walidacja i trwały zapis profili oraz tematów.
- `local-app/data/auth.sqlite`: prywatna lokalna baza SQLite. Konta, wyzwania, sesje, profile, kategorie i ich przypisania.
- `local-app/test/auth.test.mjs`: testy integracji i zabezpieczeń.
- `local-app/test/preview.mjs`: wyłącznie odizolowana kontrola UI na porcie 43127, z losowym portfelem testowym i bazą w pamięci. Nie jest częścią uruchomienia normalnej aplikacji.
- `SPECYFIKACJA.md`: pełna wizja i ustalenia.
- `SPRAWDZENIE.md`: wyniki i granice testów; wcześniejsze wpisy są historią etapów.
- `.starter-sites/`: nieaktywny zachowany szablon, nie służy do uruchamiania aplikacji.

Lokalny Node i SQLite nie wymagają chmury. Zależność `quais@1.0.0-alpha.57` jest przypięta w pliku blokady pnpm.
W nowym środowisku: `cd local-app`, `pnpm install --frozen-lockfile`.
Testy z katalogu projektu: `node --test local-app/test/*.test.mjs`.
HTML/CSS/JavaScript są serwowane bez kompilacji.

## Zabezpieczenia
Losowe jednorazowe wyzwanie ważne 5 minut, powiązane z przeglądarką. Podpis obejmuje domenę, adres, kod i czas.
Pelagus wykonuje quai_requestAccounts, quai_accounts i personal_sign z UTF-8 w hex oraz adresem.
Serwer weryfikuje przez quais.verifyMessage i atomowo zużywa wyzwanie. Baza przechowuje skróty tokenów sesji.
Cookie HttpOnly, SameSite=Strict, sesja do 8 godzin. Wylogowanie unieważnia ją po stronie serwera.
Profil można odczytać i zapisać wyłącznie przez ważną sesję. Adres przesłany w danych formularza nie wybiera profilu.
Rola administratora jest wyliczana z uwierzytelnionego adresu, nie z pól profilu. Administrator również uzupełnia swój profil.
Tematy i profil zapisują się atomowo, z ograniczeniem duplikatów w bazie. Teksty użytkownika wyświetlane przez textContent.
Nie ma obejścia logowania w normalnej aplikacji. Podgląd testowy korzysta z osobnego serwera i nie dotyka prywatnej bazy.
Lokalne HTTP nie ustawia Secure; przyszłe wdrożenie wymaga HTTPS, konfiguracji domeny i przeglądu bezpieczeństwa.

## Źródła integracji
- https://www.pelaguswallet.io/docs
- https://docs.qu.ai/sdk/content/classes/JsonRpcSigner
- https://docs.qu.ai/sdk/content/functions/verifyMessage
- https://github.com/PelagusWallet/pelagus-extension


## Aktualizacja — Home i pytania wielotematyczne (29.09.2026)
Po zalogowaniu z gotowym profilem otwiera się Home z Ask a Question. Kliknięcie Neuron Storm w nagłówku także prowadzi do Home. Formularz udostępnia wszystkie zapisane wspólne kategorie w dwóch listach Work & Education i Hobbies & Interests. Wymagany jest co najmniej jeden temat łącznie (maksymalnie 100) oraz treść pytania.
Pytanie tworzy jeden wspólny wątek dla unikalnej sumy osób mających dowolny wybrany temat, bez autora. Odbiorcy są ustalani przy wysyłaniu; późniejsze zmiany profilu nie zmieniają dostępu do istniejących wątków. Brak odbiorców blokuje wysłanie. Autor, odbiorcy i administrator mają dostęp zgodnie z sesją serwera. Inbox i My Questions pozostają dostępne w nawigacji.
Na dole Home są rzeczywiste globalne liczniki z bazy: zarejestrowane konta portfeli, tematy, pytania i odpowiedzi. Statystyki nie ujawniają treści ani uczestników wątków. Odświeżają się przy otwarciu Home. Tabela question_categories zachowuje wiele tematów; migracja uzupełnia dotychczasowe pytania ich pierwotnym tematem.
Ta aktualizacja zastępuje wcześniejszy opis domyślnego ekranu po zalogowaniu oraz pojedynczego tematu pytania.


## Wyszukiwanie tematów i oceny odpowiedzi — 29.09.2026
Home ma dwie rozwijane listy z wyszukiwaniem i wielokrotnym wyborem. Pokazują kategorie występujące aktualnie w co najmniej jednym profilu; wpisanie tekstu filtruje listę i nie tworzy kategorii. Zaznaczenia są zachowywane podczas filtrowania i widoczne pod listą.
Każdą odpowiedź mogą ocenić osoby z dostępem do wątku, poza autorem tej odpowiedzi. Jedna ocena na konto i odpowiedź: +1, -1 lub cofnięcie. Powtórne kliknięcie aktywnej oceny cofa ją. Łapka w górę daje autorowi odpowiedzi 1 gwiazdkę; łapka w dół nie odejmuje gwiazdek. Zmiana lub cofnięcie łapki w górę usuwa przyznaną za nią gwiazdkę. Profil pokazuje sumę aktualnie otrzymanych łapek w górę we wszystkich odpowiedziach. Punkty są wyliczane przez serwer, pola profilu nie mogą ich ustawiać. Oceny i punkty odświeżają się co 5 sekund w widocznym wątku/profilu. Nie dodano rankingu.


## Admin Dashboard, powiadomienia i wersja — 0.2.2 (30.09.2026)
Administrator z ukończonym profilem trafia domyślnie do Admin Dashboard. Zwykłe funkcje Home, Questions for You, My Questions i My Profile pozostają dostępne. Rola nadal wynika wyłącznie z serwerowej sesji zweryfikowanego portfela i jednego adresu ADMIN w server.mjs. Zwykłe konta nie widzą nawigacji administratora; endpointy /api/admin/* wymagają tej roli na serwerze.
Panel zawiera liczniki kont, aktywnych/usuniętych rozmów i aktywnych odpowiedzi; wyszukiwanie treści pytania, autora i kategorii; paginację po 20 rozmów. Administrator może otworzyć cały wątek, nawet jeśli nie był jego uczestnikiem.
Delete conversation wymaga okna potwierdzenia wskazującego rozmowę, autora, datę i skutki oraz zaznaczenia potwierdzenia. Usunięcie jest odwracalne: znika dostęp uczestników, odpowiedzi, oceny i powiadomienia tego wątku; blokowane są nowe odpowiedzi i oceny. Gwiazdki z usuniętych odpowiedzi nie liczą się do profilu. Rekordy rozmowy, odpowiedzi, ocen i odbiorców pozostają w bazie. Deleted conversations pozwala odtworzyć wątek, oceny i gwiazdki dla pierwotnych uczestników. Powiadomienia wracają jako przeczytane; przywrócenie nie generuje nowych. Nie kasuje się kategorii ani profili. Historia moderacji zapisuje administratora, identyfikator rozmowy, operację i czas, bez treści rozmowy. Zmiana stanu i audit są atomowe.
Powiadomienia działają wyłącznie wewnątrz aplikacji. Dzwonek pokazuje liczbę nieprzeczytanych; lista po 20 pozycji pozwala otworzyć wątek, oznaczyć jedną pozycję lub wszystkie znane w chwili odczytu. Nowe pytanie powiadamia unikalnych odbiorców, nowa odpowiedź pozostałych pierwotnych uczestników z pominięciem jej autora. Administrator nie dostaje automatycznej kopii wszystkich zdarzeń. Otwarcie wątku oznacza powiadomienia do faktycznie pobranej rewizji; nowsze odpowiedzi pozostają nieprzeczytane. Powiadomienia oraz ich odczyt są trwałe, prywatne dla konta i filtrowane według dostępu do rozmowy. Odświeżanie co 5 sekund w widocznej aplikacji. Nie generujemy historycznych powiadomień dla wcześniejszych rozmów przy migracji. Bez emaili, SMS i web push.
Numer wersji jest stale widoczny w lewym dolnym rogu i pobierany przez serwer z local-app/package.json. Kolejne poprawki zwiększają patch, nowe funkcje minor.


## Wersja 0.6.0 — 30.09.2026
Wallet zawiera tylko NS z Quai Network. Cena i procentowa zmiana w nagłówku pochodzą z Quainance. Pytania i odpowiedzi wymagają zatwierdzenia wiadomości w Pelagus (bez transakcji i opłat); odrzucony podpis nie wysyła treści. Ponowienia chronione przed duplikatami, jeden odbiorca niezależnie od liczby dopasowanych kategorii. Przy pytaniu dostępny panel Debate z zapisaną historią i obecnością online, bez dodatkowego podpisywania wiadomości. Aktualizacja czatu co 2 sekundy, obecności do 25 sekund.
Zmiany przygotowane lokalnie. Użytkownik wdraża tę wersję osobno na https://neuronstorm.onrender.com/ przez istniejący proces Render. Plik render-start.mjs zachowuje adres z RENDER_EXTERNAL_URL. Podpisów prawdziwym portfelem użytkownika nie wykonywano.


## Wersja 0.7.0 — dymki, neurony i dźwięki
Debate pokazuje własne wiadomości w niebieskich dymkach po prawej, cudze po lewej. Pole mine pochodzi z porównania autora z sesją po stronie serwera, bez ujawniania adresów. Tło całej aplikacji ma rzadkie czerwono-niebieskie połączenia neuronów: około 6,5 sekundy animacji, potem 22–36 sekund przerwy. Canvas nie przechwytuje kliknięć, jest zatrzymywany w ukrytej karcie i wyłączony dla prefers-reduced-motion.
Obok dzwonka jest przełącznik Mute/Unmute notification sounds. Stan jest zapamiętany w tej przeglądarce. Nowe zdarzenia uruchamiają krótki cichy sygnał; stare, odczytane, ponownie pobrane i przywrócone powiadomienia nie odtwarzają dźwięku ponownie. Duża jednoczesna partia jest grupowana do trzech sygnałów. Dźwięk wymaga interakcji użytkownika do odblokowania AudioContext przez przeglądarkę; zamknięta lub uśpiona przez system karta nie gwarantuje dźwięków. Powiadomienia sprawdzane również w ukrytej karcie, w granicach ograniczeń przeglądarki. Wyciszone zdarzenia nie są odtwarzane po włączeniu dźwięku.


## Wersja 0.8.0 — 01.10.2026
Jedna odpowiedź na osobę/pytanie; maksymalnie 4 zawody/edukacje i 4 hobby w profilu. Odpowiedzi sortują się od największej liczby upvotes. Edit/Delete kosztują 1 NS do funduszu 0x001d5bE0940145De0c2c1D851b99f33968DED764; edycja usuwa poprzednie oceny, usunięcie nie oddaje miejsca na kolejną odpowiedź. Tip NS pod cudzą odpowiedzią trafia bezpośrednio do jej autora.
Każdy przelew zatwierdza użytkownik w Pelagus; gas jest dodatkowo płatny w QUAI. Serwer sprawdza prawdziwy Transfer NS i 3 potwierdzenia przed zmianą. Przy opóźnieniu należy użyć Check payment, nie płacić ponownie. Identyfikator i hash są zapamiętywane w przeglądarce; w razie konfliktu lub utraty pamięci należy zachować hash i skontaktować się z administratorem. Trwała baza na Render musi zachować profile, sesje i payment_intents między wdrożeniami.
Weekly Ranking zawiera pulę NS z sieci, filtr dziedzin, otrzymane w tygodniu gwiazdki i aktywność (pytania + odpowiedzi). Reset w poniedziałek 00:00 UTC; gwiazdki profilu pozostają między tygodniami. Wypłaty nagród administrator robi ręcznie ze swojego Pelagus. Katalog portfeli jest dostępny wyłącznie administratorowi; również przy pozycjach rankingu i odpowiedziach admin widzi powiązany adres.
Zielony licznik pokazuje przybliżoną obecność z ostatniej minuty, pomarańczowy unikalne przeglądarki w tygodniu. Oryginalne logo zachowane, czerń w renderowaniu zamieniana na przezroczystość.

### Wersja 0.9.0
Pytania wygasają po 7 dniach od utworzenia. Autor może wcześniej zaakceptować najlepszą odpowiedź po podpisie w Pelagus. W przeciwnym razie wygrywa najwięcej upvotes, przy remisie najwcześniejsza odpowiedź. Administrator widzi pytanie, odpowiedź i portfel w Accepted answers; nagrody wypłaca ręcznie. Zamknięte tematy znikają z list, a gwiazdki zostają. Dotyczy także istniejących pytań — starsze niż 7 dni zostaną zamknięte przy uruchomieniu. Przy uśpionym serwerze zamknięcie następuje po jego obudzeniu przed udostępnieniem danych.


### Wersja 0.10.0 — globus i nieprzeczytane wiadomości
Nieprzeczytane pytania, odpowiedzi i nowe powiadomienia delikatnie pulsują czerwienią. W otwartej rozmowie oznaczenie New znika po 7 sekundach widoczności odpowiedzi. Ustawienie ograniczenia ruchu wyłącza pulsowanie.
Obok Conversation jest wolno obracający się globus z animowanym powiększeniem na pełny ekran, listą krajów i przełącznikiem obrotu. Kraje są przybliżeniem z IP; udział na mapie jest dobrowolny, domyślnie wyłączony. Serwer przechowuje kraj i czas obecności, nie zapisuje IP w danych globusa i nie wysyła go do usług zewnętrznych. API zwraca wyłącznie zliczenia krajów, bez nazw i portfeli. Obecność wygasa po 65 sekundach, odświeżanie co 25 sekund. Maksymalnie 100 promieni, pełne liczby w legendzie; osoby w tym samym kraju dzielą punkt. Przy braku lokalizacji nie rysujemy fikcyjnych połączeń.
Lokalna baza IP: https://github.com/sapics/ip-location-db (user-country, PDDL 1.0). Aktualizacja: python local-app/update-geo-data.py. Pliki geo-data muszą być wdrożone razem z aplikacją; source.json zawiera źródła i sumy kontrolne. Zaufanie do X-Forwarded-For włączone automatycznie wyłącznie przy RENDER=true; lokalnie używany jest adres połączenia. Dane służą wizualizacji, nigdy nadawaniu uprawnień.
Granice i punkty krajów: Natural Earth 110m, public domain (https://www.naturalearthdata.com/about/terms-of-use/), źródło https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson. Testowy globus można uruchomić przez QA_GLOBE_DEMO=1 w test/preview.mjs; lokalizacje w tym podglądzie są symulowane i oddzielone od prawdziwej bazy.


### Wersja 0.11.0 — Blip / smartfony
Integracja według https://www.blippay.me/docs: provider window.quai (isBlip / _isSwiftBlip), zgodne aliasy pelagus/ethereum, quai_requestAccounts, personal_sign i quai_sendTransaction. Pozostawiono dwuetapowe logowanie, serwerowe nonce, podpis treści i kontrolę sesji, weryfikację transferów NS. Brak automatycznego finansowania portfela i automatycznych przelewów.
Przycisk Open in Blip · Mobile otwiera HTTPS origin strony w aplikacji Blip przez oficjalny universal link /browser?url=. Nie przekazuje zapytań, fragmentów ani sesji. Lokalny podgląd używa adresu https://neuronstorm.onrender.com/ — telefon potrzebuje wdrożenia tej wersji. Blip ukrywa link i pokazuje Sign in with Blip. Konto Blip jest osobnym portfelem strony, nie głównym vault ani kontem Pelagus; nie łączymy profili po pseudonimie. Portfel aplikacji potrzebuje NS i QUAI do płatności.
wallet_watchAsset nie jest wymienione w dokumentacji Blip. Próba importu nie jest traktowana jako trwały dowód. Przy kodach unsupported (4200/-32601) Blip dostaje instrukcję ręcznego dodania kontraktu NS i jawne potwierdzenie widoczności. Odmowa podpisu/importu nie jest sukcesem ani automatycznym pominięciem rejestracji.
79/79 testów. Browser QA: symulowany provider Blip dostępny tylko pod window.quai, podpisana odpowiedź przyjęta przez prawdziwą weryfikację serwera, mobilny widok 390px. QA_BLIP=1 node local-app/test/preview.mjs używa wyłącznie portfeli testowych. Rzeczywisty iOS/Android i import NS w konkretnej wersji Blip wymagają sprawdzenia na urządzeniu po wdrożeniu; nie wykonano prawdziwych przelewów.

### 0.12.0 — sterowanie globusem
Pełny ekran: przeciąganie jednym palcem lub myszą obraca globus w dwóch osiach; dwa palce i kółko myszy zmieniają zoom 65–300%. Przyciski +/−, procent powiększenia, Reset view. Klawiatura: strzałki, +/−, 0 lub Home. Ręczna interakcja zatrzymuje automatyczny obrót, Resume rotation wznawia go. Gesty przechwytuje wyłącznie canvas; pozostała część okna pozostaje przewijalna. Zachowana poprawka mobilnego renderowania z 0.11.1. Testy: 81/81, w tym pinch, przejście z dwóch palców na jeden, anulowanie gestu, limity zoomu. Browser QA 390px: przyciski, przeciąganie, strzałki i reset; brak błędów konsoli. Gest dwóch palców sprawdzony testem zdarzeń, bez fizycznego telefonu.

### 0.13.0 — prywatne archiwum pytań i odpowiedzi
Admin Dashboard → Question & answer archive → Download full history (.txt). Jeden plik UTF-8 neuron-storm-history.txt zawiera wszystkie dostępne pytania i formalne odpowiedzi wraz z identyfikatorami wątku, autorem, portfelem, datą i statusem. Nowe wersje, usunięcia i zamknięcia są zapisywane automatycznie w tej samej transakcji SQLite. Dane conversation_archive są częścią trwałej bazy aplikacji; eksport TXT jest generowany strumieniowo przy pobieraniu, bez publicznego pliku na serwerze. Wdrożenie musi zachować bazę na trwałym dysku Render i jej kopie zapasowe.
Istniejące treści migrowane jednokrotnie jako IMPORTED; wersji nadpisanych przed wdrożeniem nie można odtworzyć. Debate nie jest częścią tego archiwum. Eksport wymaga sesji administratora i ma Cache-Control: no-store. Testy 86/86: prywatność endpointu, eksport, import bez duplikatów, zachowanie edycji/usunięć/zamknięć i rollback. Sprawdzono widok administratora w przeglądarce na izolowanej bazie.


### 0.14.0 — jakość rozmów, biblioteka i liczniki dziedzin
1. Questions for You / My Questions wyróżniają pytania bez odpowiedzi i pokazują je przed pozostałymi. Najbliższy deadline pierwszy; poniżej 24h oznaczenie pilne.
2. Saved Answers to prywatne kopie pytań i odpowiedzi zapisane przez uczestnika podczas aktywnej rozmowy. Snapshot i wersja pozostają po edycji, usunięciu i zamknięciu oryginału. Można usunąć własną kopię. Limit stron 20. Osoba spoza rozmowy nie może zapisać odpowiedzi; zapis sprawdza aktualną wersję. Zmiana konta czyści UI.
3. Admin / Accepted answers: po ręcznym przelewie z puli wklej hash w Reward transaction hash i kliknij Verify reward & notify. Serwer sprawdza Quai Mainnet, dokładny kontrakt NS, nadawcę z puli, odbiorcę wybranej odpowiedzi, direct transfer, potwierdzony blok po wyborze odpowiedzi i 3 potwierdzenia. Jeden zweryfikowany przelew nagrody na zaakceptowaną odpowiedź; hasha nie można ponownie użyć jako tip/edycja/nagroda. Dopiero wtedy odbiorca widzi powiadomienie You received X NS for your answer z linkiem do explorera, również po zamknięciu tematu. Wypłaty pozostają ręczne, formularz niczego nie przelewa. Nie skanuje automatycznie historii niezgłoszonych wypłat.
4. Report przy pytaniu/odpowiedzi otwiera wybór przyczyny i opcjonalne szczegóły (500 znaków). Dostęp tylko dla uprawnionego uczestnika; jeden raport osoby na treść. Admin / Content reports pokazuje snapshot i pozwala oznaczyć rozwiązanie; brak automatycznego usuwania. Panel odświeża nowe zgłoszenia.
5. Preview question przed podpisem pokazuje treść, tematy i liczbę unikalnych odbiorców bez autora. Nie tworzy pytania i nie prosi o podpis. Sign & send dopiero wywołuje portfel. Liczba odbiorców może się zmienić do chwili wysłania — jawnie opisane w podglądzie.
Kategorie zwracają memberCount (liczba kont z tematem w profilu) i pokazują ją przy rejestracji/edycji oraz w Ask a Question. Liczby dwóch kategorii nie są sumowane jako odbiorcy; suma unikalnych kont obliczana na serwerze. Wybrana nazwa nie zawiera tekstu licznika. Limit 4+4 profilu pozostaje.
Bez punktu 6 / odznak. Testy 90/90: snapshoty, prywatność, preview bez zapisu, unikalni odbiorcy, zgłoszenia, błędne nagrody (nadawca/token/blok/czas/status), wymagane potwierdzenia i powiadomienia tylko odbiorcy. Browser QA na izolowanej bazie: preview → podpis → pytanie; save → akceptacja i zamknięcie → nadal dostępna kopia; report → admin → resolved; licznik i poprawna nazwa kategorii na 390px. Brak rzeczywistych przelewów i publikacji. Nowe tabele przechowywane w istniejącej trwałej bazie aplikacji.

## 0.15.0 — wygoda pytań, rejestracja i mobilne tipy
- Szkic tekstu i tematów pytania zapisuje się lokalnie, osobno dla konta. Przywracanie po odświeżeniu/nawigacji przez 7 dni; Clear draft usuwa szkic, udana wysyłka usuwa pasujący szkic. Nie ma synchronizacji pomiędzy urządzeniami.
- Questions for You / My Questions: wyszukiwanie pełnej treści i autora, filtr dziedziny, bez odpowiedzi, zamknięcie w 24h; sortowanie priorytetem, terminem lub datą.
- Debate: dźwięk nowych cudzych wiadomości tylko podczas otwartej rozmowy; Mute this debate osobno dla konta i wątku na urządzeniu. Globalne wyciszenie nadal obowiązuje.
- Przypomnienie w Notifications dla autora w ostatnich 24 godzinach pytania, jeden raz. Widoczne tylko w aplikacji; nie jest powiadomieniem push przy zamkniętej przeglądarce. Po przestoju serwera sprawdzane przy uruchomieniu i następnym żądaniu. Zamknięte pytania nie mają aktywnych przypomnień.
- Block member przy pytaniu/odpowiedzi; zarządzanie w My Profile → Blocked members. Obustronnie wyklucza nowe dostarczenia i bezpośrednie odpowiedzi, ukrywa wiadomości i obecność Debate pomiędzy blokującymi kontami. Wcześniejsze formalne treści wspólnych rozmów pozostają; administrator zachowuje dostęp moderacyjny. Adresów blokowanych kont nie udostępnia publiczne API.
- Rejestracja po zweryfikowanym podpisie przechodzi od razu do profilu. Brak obowiązkowego importu NS i oświadczenia o dodaniu tokena. Stare potwierdzenia są zachowane wyłącznie dla zgodności; nie nadają uprawnień.
- Kliknięcie Sign in bez wykrytego portfela otwiera https://www.pelaguswallet.io/ w tej samej karcie, aby działało bez popupów. Obecny Pelagus/Blip zachowuje dwuetapowe logowanie. Oficjalny adres sprawdzony na stronie Pelagus i stronie portfeli Quai.
- Tip NS i Pending NS payment: szerokie okno mobilne, duże pole kwoty, czcionka minimum 16px w polach, przyciski minimum 48px i przewijanie w niskim oknie. Otwarcie nie uruchamia klawiatury automatycznie.
- Zgodnie z końcową decyzją użytkownika NIE ma dodawania plików ani endpointów uploadu. Archiwum i Saved Answers pozostają tekstowe.


### 0.16.0 — projekt regulaminu i akceptacja podpisem
- Publiczne `/terms` i `/privacy`, czytelne na telefonie, zawierają angielski projekt dokumentów.
- `local-app/legal-config.json` pozostaje `published: false`: brakuje rzeczywistych danych operatora, kraju, kontaktu i daty obowiązywania. Projekt NIE jest aktywnym regulaminem; obecne logowanie nadal działa. Nie publikować jako gotowego dokumentu prawnego.
- Przed aktywacją uzupełnić dane operatora, dostosować dokumenty do jego jurysdykcji oraz zweryfikować retencję, transfery danych i wymagania dotyczące cookies. Projekt zakłada pełnoletnich użytkowników. Po zatwierdzeniu ustawić datę, wersję i `published: true`, następnie zrestartować serwer.
- Przy aktywnym regulaminie każde logowanie (także pierwsza rejestracja) wymaga niezaznaczonego domyślnie checkboxa przed podpisem w Pelagus/Blip. Podpis zawiera wersję, linki i SHA-256 dokładnej treści obu dokumentów. Brak zgody lub nieaktualny hash blokują challenge; zmiana regulaminu unieważnia wcześniejszy challenge.
- Dopiero zweryfikowany podpis zapisuje akceptację w SQLite razem z kontem/sesją. `legal_documents` przechowuje niezmienny snapshot, `legal_acceptances` pierwszy dowód dla konta i wersji treści. Dane nie są publicznie udostępniane.
- Istniejące sesje nie są automatycznie wylogowywane. Kolejne logowanie wymaga aktualnej akceptacji. Zmieniając dokumenty, zwiększyć również ich wersję i datę, nie tylko numer aplikacji.

Zasady rozwoju projektu: `CONTRIBUTING.md`. Skrypt uruchamiania korzysta z Node.js dostepnego w PATH.
