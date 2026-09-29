# Neuron Storm — lokalna aplikacja

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
Przeglądarka podglądu Codex nie ma Pelagus.

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
