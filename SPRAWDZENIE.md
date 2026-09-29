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
