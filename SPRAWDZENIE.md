# Sprawdzenie etapu 1 — 29.09.2026

Wynik: 14/14 automatycznych testów zakończonych powodzeniem.

- Sam adres nie tworzy sesji; wymagany jest prawdziwy podpis kryptograficzny.
- Poprawny podpis generowany w teście przez oficjalne quais tworzy sesję na rzeczywistym serwerze HTTP.
- Błędny podpis i podpis innego portfela są odrzucane.
- Ponowne i równoczesne użycie wyzwania jest odrzucane; tylko jedna próba może się udać.
- Wyzwanie jest przypisane do przeglądarki i wygasa po 5 minutach.
- Sesja wygasa po 8 godzinach; wylogowanie unieważnia poprzedni token.
- Baza przechowuje skrót tokenu, nie sam token sesji.
- Kolejne logowanie zachowuje jeden rekord konta i zmienia token sesji.
- Konto i sesja działają po ponownym otwarciu bazy.
- Obca domena, nieprawidłowy Host, adres i nieprawidłowe dane są odrzucane.
- Podanie adresu administratora ani pola role nie daje uprawnień bez właściwego podpisu.
- Testy adaptera sprawdzają brak portfela, odmowę podpisu, zmianę konta i kodowanie UTF-8.

Ręczne sprawdzenie w przeglądarce Codex:
- Strona oraz dostarczony obraz logo wyświetlają się poprawnie na dużym ekranie i przy szerokości 390 px.
- Przycisk obsługuje klawiaturę; próba logowania bez portfela pokazuje czytelny komunikat.
- Brak błędów JavaScript w odczytanym dzienniku przeglądarki.
- Podgląd lokalny: http://localhost:3000, odpowiedź HTTP 200.

Ograniczenie: przeglądarka Codex nie ma Pelagus. Test adaptera korzysta z kontrolowanego providera i prawdziwych podpisów testowych, ale NIE zastępuje próby z rozszerzeniem użytkownika.
Nie wykonano podpisu portfelem użytkownika. Nie potwierdzono jeszcze działania konkretnej zainstalowanej wersji Pelagus.
Nie wysłano transakcji. Nie publikowano strony. Pełna zgodność przyszłych funkcji Quai nie jest przedmiotem tego etapu.

Do wykonania przez użytkownika:
1. Otworzyć http://localhost:3000 w przeglądarce z Pelagus.
2. Wybrać konto QUAI i kliknąć „Zaloguj przez Pelagus”.
3. Zezwolić na połączenie i podpisać jednorazową wiadomość logowania.
4. Sprawdzić komunikat „Jesteś zalogowany”, odświeżyć stronę i użyć „Wyloguj”.

Logo skopiowano bez zmian z pliku użytkownika. Plik oryginalny na dysku D: pozostaje nietknięty.

## Poprawka po rzeczywistej próbie Pelagus

Użytkownik potwierdził, że kliknął podpisanie wiadomości, a strona pokazała „Logowanie anulowane”.
Potwierdzony błąd aplikacji: każdy kod 4001/ACTION_REJECTED był błędnie przedstawiany jako pewne anulowanie.
W źródle Pelagus istnieje ścieżka mapująca błędy wewnętrzne na userRejectedRequest; nie można ustalić faktycznej przyczyny z samego kodu.
Parametry personal_sign (hex UTF-8, adres) i weryfikacja quais są zgodne z kodem portfela. Nie zmieniono algorytmu podpisu ani nie dodano alternatywy bez podpisu.

Zmiany:
- osobny krok połączenia, następnie świadome kliknięcie „Podpisz i zaloguj”;
- nowa wiadomość tworzona dopiero w kroku podpisu;
- etap i kod błędu zamiast nieuzasadnionego stwierdzenia anulowania;
- rozróżnienie błędów serwera, braku uprawnień, oczekującej prośby i nieobsługiwanej metody;
- dodatkowe sprawdzenie wybranego konta przed podpisem;
- brak automatycznego ponawiania odrzuconego podpisu.

18/18 testów przechodzi. Nie odtworzono błędu na rzeczywistym rozszerzeniu użytkownika; jego źródłowa przyczyna pozostaje niepotwierdzona.
Rozdzielenie okien ogranicza możliwy konflikt ich kolejności, ale nie jest dowodem, że taki konflikt wystąpił u użytkownika.
Nowa próba: odświeżyć stronę, „Zaloguj przez Pelagus”, potwierdzić połączenie, „Podpisz i zaloguj”, podpisać.
Jeżeli ponownie wystąpi błąd, potrzebny jest pełny nowy komunikat z etapem i kodem oraz wersja Pelagus.

Źródła sprawdzone przy poprawce:
https://github.com/PelagusWallet/pelagus-extension/blob/1.0/background/services/internal-quai-provider/index.ts
https://github.com/PelagusWallet/pelagus-extension/blob/1.0/background/services/provider-bridge/index.ts
https://github.com/PelagusWallet/pelagus-extension/blob/1.0/background/services/signing/index.ts
https://www.pelaguswallet.io/docs

## Etap 2 — profile i angielski interfejs (aktualny wynik)

25/25 testów automatycznych przeszło. Dodatkowo sprawdzono w przeglądarce:
- pierwsze otwarcie pustego profilu i angielską walidację wymaganego pseudonimu;
- zapis samego pseudonimu + hobby bez zawodu;
- My Profile po zapisie i po odświeżeniu;
- edycję imienia, dodanie dziedziny pracy, zapis zmian i ponowne odświeżenie;
- odrzucenie powtórzonego tematu z inną wielkością liter i dodatkowymi spacjami;
- pola, temat, zapis i układ przy szerokości 390 px oraz widok komputerowy 1365 px.

Testy serwera obejmują ponowne logowanie, utrwalenie po otwarciu bazy, wspólne kategorie między kontami, deduplikację, izolację profili, ignorowanie podsuniętego adresu i roli, administratora bez profilu, walidację, sesję wygasłą i obce źródło żądania.

Kontrolę interfejsu wykonano na odizolowanym serwerze z losowym portfelem testowym uwierzytelnionym prawdziwym podpisem i bazą w pamięci. Dane testowe nie trafiły do prywatnej bazy. Użytkownik wcześniej potwierdził działanie Pelagus; nowego formularza nie zapisywano w jego imieniu.
Końcowa próba użytkownika: odśwież http://localhost:3000 w jego przeglądarce; jeśli sesja wygasła, Sign in with Pelagus → Sign message & continue. Następnie wypełnij Create your profile i Save profile. Zapis powinien otworzyć My Profile; Edit profile umożliwia zmiany.
Nie publikowano strony ani nie wykonywano transakcji.


## Home / Ask a Question — 29.09.2026
29/29 testów przechodzi, w tym wielotematyczna wysyłka między obiema grupami, deduplikacja odbiorców, odrzucanie pustych/nieistniejących tematów i liczniki z bazy. Zachowane testy logowania, profili, trwałości i uprawnień wątków. W przeglądarce na oddzielnej bazie w pamięci sprawdzono: domyślne Home, walidację wyboru, pojawienie się nowej kategorii z profilu, wybór obu grup, wysłanie jednego pytania, powrót przez markę i aktualizację liczników oraz układ mobilny 390px. Dane testowe nie trafiły do prywatnej bazy.


## Wyszukiwanie i oceny — 29.09.2026
32/32 testy przechodzą. Nowe sprawdzenia: jedna ocena mimo równoległego powtórzenia, dwie osoby = dwie gwiazdki, zmiana/cofnięcie głosu, blokada samooceny i obcego konta, sesja/origin, ignorowanie podsuniętych punktów, trwałość ocen i gwiazdek po ponownym otwarciu bazy oraz filtrowanie kategorii bez aktywnego profilu. W odizolowanej przeglądarce sprawdzono wyszukiwanie, brak wyników, zachowanie wyboru po filtrowaniu, dwa upvotes od oddzielnych kont i ★ 2 stars w profilu autora odpowiedzi.
Dodatkowo: układ wyszukiwanej listy sprawdzony przy 390px; brak błędów JavaScript w dzienniku testowej przeglądarki. Prywatna baza nie zawiera danych testowych.

Home z sekcją główną: 32/32 testy. W przeglądarce potwierdzono nowe hasło przed logowaniem, sekcję nad formularzem po logowaniu oraz ukrywanie w Inbox i powrót przez Home.


Przeniesienie How Neuron Storm works: 32/32 testy; przeglądarka potwierdziła położenie pod statystykami oraz powrót do sekcji landing po wylogowaniu.



## Admin Dashboard / Notifications / v0.2.2
36/36 testów przechodzi. Testy obejmują: autoryzację administratora i odporność na role z profilu, dostęp do obcych zamkniętych wątków, wyszukiwanie/paginację, potwierdzenie delete, origin, soft-delete i restore, blokadę odczytu/odpowiedzi/ocen/mark-read po usunięciu, ukrycie powiadomień i gwiazdek, odzyskanie, zachowanie profili i kategorii oraz trwały audit. Powiadomienia: wielu odbiorców i kategorii bez duplikatów, brak własnych i automatycznych kopii admina, izolacja kont, pojedynczy odczyt/odczyt wszystkich do znanej granicy, odczyt według rewizji i trwałość po ponownym otwarciu bazy.
Przeglądarka: domyślny panel testowego admina, wyszukiwanie, pełny obcy wątek, jawne potwierdzenie delete, kosz i restore, brak nawigacji admina u członka; powiadomienia pojedyncze/wszystkie, automatyczna aktualizacja po odpowiedzi z drugiego klienta i otwarcie wątku z odczytem. Desktop i 390px: panel, lista powiadomień i dialog; brak błędów JS.
Testy wyłącznie na bazach tymczasowych i w pamięci. Testowa sesja administratora została jawnie utworzona wyłącznie w izolowanym preview.mjs; nie użyto podpisu ani sesji rzeczywistego administratora. Produkcyjny serwer nie ma ścieżek /qa ani testowego obejścia logowania. Nie usunięto żadnej rzeczywistej rozmowy.

0.2.3: 37/37 testów. Anonimowe statystyki zgodne z zalogowanymi; odpowiedź ma wyłącznie cztery liczniki; delete/restore zmienia sumy poprawnie; brak anonimowego dostępu do chronionych zasobów. Przeglądarka: identyczne wartości przed/po wylogowaniu, desktop i mobile 390px, brak błędów JS. localhost:3000 odpowiada 200, publiczne stats 200, wersja v0.2.3. Testy na odrębnych danych.


## Wallet 0.3.0
39/39 testów. Zweryfikowano wymaganie sesji, ignorowanie obcego adresu w URL, precyzję sald, cache, pustą listę i awarie dostawcy. Rzeczywisty odczyt Quaiscan sprawdzony na publicznym adresie zerowym. Przeglądarka: testowe QUAI i token DEMO, odświeżanie, wylogowanie, układ 390 px bez poziomego przewijania, brak błędów JS. Screenshot wallet-preview.png przedstawia wyłącznie dane testowe.

## Neuron Storm token 0.4.0
43/43 testy: wymóg oświadczenia przed nowym profilem, sesja i origin, błędny kontrakt, odczyt tylko adresu sesji, prawidłowa sieć RPC, format wyniku, błędy dostawcy, odmowa watchAsset i zmiana konta. Przeglądarka: symulowana rejestracja od Add NS do formularza profilu, NS + QUAI + DEMO w Wallet, wylogowanie czyści saldo, 390 px bez przewijania poziomego, nagłówek NS widoczny po przewinięciu, brak błędów JS. Testowy provider występuje tylko w test/preview.mjs. Rzeczywisty Pelagus wymaga zatwierdzenia użytkownika; nie podpisywano za niego.
Odczyt rzeczywistego kontraktu przez oficjalny RPC potwierdził podaż 10 000 000 NS. Serwer na localhost:3000 został zrestartowany do 0.4.0; /api/wallet zwraca 401 bez sesji zamiast 404, /api/token zwraca dane on-chain. Wersja HTML/API wskazuje uruchomioną wersję serwera. Screenshoty: ns-registration-preview.png, ns-wallet-preview.png (symulowane dane); ns-live-preview.png (rzeczywista publiczna strona).

## Cena NS 0.5.0
46/46 testów: wybór właściwej puli i płynności, zmiana dodatnia/ujemna/zerowa/brak danych, nowa pula, cache i awarie. Rzeczywisty odczyt GeckoTerminal działa; serwer zrestartowany do 0.5.0. Sprawdzono dokładny href Quainance z ?ve, widok desktop i 390 px, brak przepełnienia i błędów JS. Podgląd ns-price-preview.png.


## Wersja 0.6.0 — 30.09.2026
51/51 testów przez node --test local-app/test/*.test.mjs. Sprawdzono: Wallet tylko NS bez zapytań do indeksu innych aktywów; Quainance jako jedyne źródło ceny, cache i brak danych; podpis treści/domeny/konta/sesji/wątku, odmowę i zmianę konta, termin ważności, równoległe ponowienie i utratę odpowiedzi sieciowej; dwie kategorie prowadzą do jednego odbiorcy i jednego powiadomienia; identyczna odpowiedź nie zwiększa ponownie liczby odpowiedzi i powiadomień.
Debate: dostęp wyłącznie uczestników/administratora, odmowa dla anonimowego i obcego konta, ochrona Origin, powtórzenie żądania nie powiela wiadomości, oddzielna historia bez formalnych odpowiedzi/powiadomień, obecność wygasa, paginacja starszych i nowszych wiadomości, usunięty wątek blokuje odczyt i wysłanie.
Przeglądarka na odizolowanej bazie w pamięci i testowych portfelach: wysłanie podpisanego pytania oraz odpowiedzi, wspólna historia Debate między Alex i Sam, lista online, brak powtórzenia tytułu w kartach, Wallet tylko NS, 390 px bez przepełnienia poziomego, brak błędów JS. Zrzuty: debate-preview.png i ns-only-wallet-preview.png (dane testowe). Lokalny serwer uruchomiony jako 0.6.0; rzeczywiste publiczne API pokazuje source Quainance, a stronę sprawdzono po restarcie (ns-quainance-price-preview.png). Nie podpisywano prawdziwym portfelem użytkownika i nie wdrażano na Render. Historyczne duplikaty nie zostały skasowane ani scalone.


## Wersja 0.7.0
53/53 testy zaliczone, w tym identyfikacja własnej wiadomości z sesji, monotoniczne nowe zdarzenia, brak powtórzeń dźwięku, przełączenie konta, wyciszenie i brak odtwarzania zaległych wyciszonych zdarzeń. Syntezę dźwięku sprawdzono przez test AudioContext; nie deklarujemy odsłuchu fizycznych głośników. Przeglądarka: dymki dwóch testowych uczestników, zapamiętane wyciszenie po odświeżeniu, przełącznik obok dzwonka, 390 px bez przepełnienia, brak błędów JS. Animację obejrzano w chwili łączenia neuronów na rzeczywistej lokalnej stronie. Zrzuty debate-bubbles-preview.png (konta testowe), neuron-background-preview.png. Lokalny serwer uruchomiony jako 0.7.0, Render nie był wdrażany.


## Wersja 0.7.1
Nowy krój nagłówka hero: Segoe UI, bez kursywy w błękitnym fragmencie. Oryginalny PNG pozostał bez zmian; hero i profil mają maskę miękkich krawędzi w obu osiach, mieszanie screen i minimalny ruch 2 px / 0,3% w cyklu 16 sekund. Systemowe ograniczenie ruchu wyłącza animację. 53/53 testy zaliczone. Przeglądarka: desktop i 390 px bez przepełnienia, brak prostokątnych krawędzi logo, brak błędów JS. Podgląd hero-blended-logo-preview.png. Lokalny serwer 0.7.1; bez wdrożenia Render.


## Wersja 0.8.0
61/61 testów: limity profilu 4+4 po stronie serwera, brak drugiej odpowiedzi również po usunięciu, sortowanie po upvotes, tygodniowy reset UTC i zachowanie gwiazdek profilu, filtrowanie dziedzin, prywatne adresy administratora, obecność i tygodniowe przeglądarki. Płatności: dokładny odbiorca i kwota NS, konto, calldata, receipt, nieudana transakcja, stary blok, za mało potwierdzeń, zmiana kanonicznego bloku, brak podwójnego księgowania, tip do autora, reset ocen po edycji, usunięcie po potwierdzeniu. Testy nie wysyłają transakcji na Mainnet.
Przeglądarka na bazie w pamięci z jawnie oznaczonym symulowanym portfelem i RPC: pełna płatna edycja oraz tip 2,5 NS (symulacje), automatyczne zamknięcie po potwierdzeniu, jeden slot odpowiedzi, formularz z opłatą i adresem funduszu, ranking, katalog administratora, 390 px bez poziomego przepełnienia, brak błędów JS. Zrzuty weekly-ranking-preview.png i ns-tip-preview.png zawierają dane testowe. Lokalny serwer 0.8.0, rzeczywisty podgląd logo logo-transparent-render-preview.png. Bez prawdziwych transferów i bez wdrożenia Render. Weryfikacja z rzeczywistym Pelagus pozostaje po stronie użytkownika; agent nie potwierdza za niego płatności.
