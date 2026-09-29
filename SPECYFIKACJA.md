# Neuron Storm — trwała specyfikacja

Stan decyzji: 29.09.2026. Wszystkie dalsze prace w tym projekcie na pulpicie, krok po kroku.

## Cel
Ludzie wymieniają wiedzę, doświadczenia zawodowe i pasje.
Publiczna strona jest bardzo prosta: nazwa, czym jest platforma i jak działa, dyskretne logowanie Pelagus.
Bez publicznych pytań, rankingów i rozbudowanych paneli. Logo dostarczone przez użytkownika: czerwono-błękitny mózg z metalicznym napisem na czerni. Strona ma podobną paletę: czerń, ciemny granat, czerwień, elektryczny błękit. Oryginał zachowany bez zmian, kopia w local-app/public/neuron-storm-logo.png.

## Pierwszy ukończony zakres — etap 1 (historia)
Tylko landing page, rzeczywisty podpis jednorazowego wyzwania, weryfikacja na serwerze, trwała lokalna baza,
sesja, wylogowanie i potwierdzenie konta. Lokalny podgląd i testy. Bez publikacji, transakcji i tokena.
Pelagus nie jest zastępowany atrapą. Sam adres nie daje dostępu. Użytkownik podpisuje osobiście.
Nie pobieramy kluczy prywatnych, fraz odzyskiwania ani haseł.
Integracja z Quai Network jest wymaganiem do sprawdzania; nie deklarujemy pełnej kompatybilności całej przyszłej platformy.
Jeden adres = jedno konto, docelowo jeden profil. Nie oznacza to jednej osoby na profil.

## Architektura
Treści, profile i głosy w bazie poza blockchainem, kontrola dostępu po stronie serwera.
Na początek lokalna trwała baza jest wystarczająca; chmura nie jest wymagana.
Jedyny administrator: `0x00198C77e2cce7C839A34aF8C54Eb82106862640`.
Rola ustalana na serwerze po poprawnym uwierzytelnieniu. Panel powstanie później.

## Profil — zatwierdzony i wdrożony etap 2
Pseudonim, opcjonalne imię i nazwisko. Dwie kategorie: „Praca i wykształcenie” oraz „Hobby i zainteresowania”.
W obu wspólne listy tworzone przez użytkowników: wybór istniejącej pozycji lub dodanie brakującej, dostępnej potem wszystkim.
Duplikaty rozpoznawane niezależnie od wielkości liter i spacji. Szczegóły normalizacji należy utrwalić przy implementacji.
Użytkownik edytuje swoje dane i dziedziny; gwiazdki wyliczane automatycznie.
NIE dodawać lat ani poziomu doświadczenia — użytkownik je usunął.
Języki, awatar, portfolio i obowiązkowy opis są dawnymi, niezatwierdzonymi propozycjami.

## Pytania i rozmowy
Pytanie można kierować do dowolnej dziedziny, niezależnie od własnej, np. kucharz pyta elektryków.
Trafia do wszystkich osób z wybraną pozycją. Jedno pytanie tworzy wspólny zamknięty wątek dla autora i odbiorców.
Wszyscy odbiorcy widzą wszystkie odpowiedzi wraz z autorami, także zanim sami odpowiedzą.
Osoby spoza grupy nie mają dostępu. Administrator widzi wszystko; użytkownicy muszą o tym wiedzieć.
Nie deklarować szyfrowania end-to-end. Dostęp po zmianie dziedziny pozostaje do ustalenia.

## Panel użytkownika
Skrzynka, Moje pytania, Nagrody, Mój profil. U góry nazwa, „Zadaj pytanie”, pseudonim.
Docelowo pierwsze logowanie prowadzi do utworzenia profilu, kolejne do skrzynki.
Listy pytań: autor, kategoria, fragment, liczba odpowiedzi i oznaczenie nowych.

## Oceny
Pod odpowiedziami oddzielne widoczne liczniki kciuków w górę i w dół.
Plus dodaje autorowi gwiazdkę, minus odejmuje. Profil pokazuje wynik netto i osobno oceny dodatnie oraz ujemne.
Ujemne czerwone. Przykład: +20 i -5 = 15 gwiazdek.
Cofanie głosów, samoocena i minimalny wynik pozostają nieustalone.

## Nagrody
Ranking wszystkich użytkowników dostępny po zalogowaniu: pseudonim, liczba kciuków w górę i miejsce.
Kolejność malejąca, własny wiersz wyróżniony. Ranking nie ujawnia zamkniętych rozmów.
Planowany token Quai jako nagroda za polubienia.
NIEUSTALONE: okres nagród, pula, podaż, symbol, nazwa, zasady beneficjentów i wypłat.
Miesięczne nagrody z akceptacją administratora były wyłącznie propozycją. Nie tworzyć tokena teraz.

## Docelowy administrator
Statystyki, wszyscy użytkownicy i wątki, zarządzanie i łączenie kategorii,
zgłoszenia, moderacja, blokady, ukrywanie treści i historia działań.
Wszystkie uprawnienia muszą być egzekwowane przez serwer.



## Aktualne ustalenia — etap 2, 29.09.2026

Użytkownik potwierdził poprawne logowanie Pelagus i zlecił formularz po zalogowaniu.
CAŁA STRONA PO ANGIELSKU: landing, tytuły, język HTML, przyciski, pola, komunikaty, błędy, walidacja i wiadomość podpisywana w portfelu. Rozmowa w czacie po polsku. Nie tłumaczyć wpisanych danych użytkowników.
Nowe uwierzytelnione konto (także administrator) bez profilu otwiera Create your profile.
Pseudonim wymagany; imię i nazwisko opcjonalne. Work & Education oraz Hobbies & Interests z wyborem wspólnych pozycji lub dodaniem nowej.
Przyjęte minimum walidacji: pseudonim i co najmniej jedna pozycja łącznie w obu grupach. Nie wymagamy zawodu od osoby wybierającej wyłącznie hobby.
Limity: pseudonim 40 znaków, imię/nazwisko po 80, temat 60, 20 tematów na grupę.
Po zapisie My Profile z możliwością edycji; kolejne logowanie otwiera ten sam profil.
Zapis lokalny w SQLite, powiązany wyłącznie z sesją. Kategorie wspólne w obrębie każdej grupy; deduplikacja NFKC + usunięcie białych znaków + małe litery.
Profil nie nadaje uprawnień. Żadnych dalszych paneli, rozmów, rankingów ani tokenów w tym etapie.


## Aktualizacja — Home i pytania wielotematyczne (29.09.2026)
Po zalogowaniu z gotowym profilem otwiera się Home z Ask a Question. Kliknięcie Neuron Storm w nagłówku także prowadzi do Home. Formularz udostępnia wszystkie zapisane wspólne kategorie w dwóch listach Work & Education i Hobbies & Interests. Wymagany jest co najmniej jeden temat łącznie (maksymalnie 100) oraz treść pytania.
Pytanie tworzy jeden wspólny wątek dla unikalnej sumy osób mających dowolny wybrany temat, bez autora. Odbiorcy są ustalani przy wysyłaniu; późniejsze zmiany profilu nie zmieniają dostępu do istniejących wątków. Brak odbiorców blokuje wysłanie. Autor, odbiorcy i administrator mają dostęp zgodnie z sesją serwera. Inbox i My Questions pozostają dostępne w nawigacji.
Na dole Home są rzeczywiste globalne liczniki z bazy: zarejestrowane konta portfeli, tematy, pytania i odpowiedzi. Statystyki nie ujawniają treści ani uczestników wątków. Odświeżają się przy otwarciu Home. Tabela question_categories zachowuje wiele tematów; migracja uzupełnia dotychczasowe pytania ich pierwotnym tematem.
Ta aktualizacja zastępuje wcześniejszy opis domyślnego ekranu po zalogowaniu oraz pojedynczego tematu pytania.


## Wyszukiwanie tematów i oceny odpowiedzi — 29.09.2026
Home ma dwie rozwijane listy z wyszukiwaniem i wielokrotnym wyborem. Pokazują kategorie występujące aktualnie w co najmniej jednym profilu; wpisanie tekstu filtruje listę i nie tworzy kategorii. Zaznaczenia są zachowywane podczas filtrowania i widoczne pod listą.
Każdą odpowiedź mogą ocenić osoby z dostępem do wątku, poza autorem tej odpowiedzi. Jedna ocena na konto i odpowiedź: +1, -1 lub cofnięcie. Powtórne kliknięcie aktywnej oceny cofa ją. Łapka w górę daje autorowi odpowiedzi 1 gwiazdkę; łapka w dół nie odejmuje gwiazdek. Zmiana lub cofnięcie łapki w górę usuwa przyznaną za nią gwiazdkę. Profil pokazuje sumę aktualnie otrzymanych łapek w górę we wszystkich odpowiedziach. Punkty są wyliczane przez serwer, pola profilu nie mogą ich ustawiać. Oceny i punkty odświeżają się co 5 sekund w widocznym wątku/profilu. Nie dodano rankingu.

Home po zalogowaniu pokazuje sekcję główną z logo i hasłem Share what you know. Learn from others’ experience. nad Ask a Question. Home i marka przewijają do góry; przycisk Ask a Question w nagłówku prowadzi bezpośrednio do formularza. Sekcja główna jest ukryta w Inbox, My Questions i My Profile.


Po zalogowaniu sekcja How Neuron Storm works znajduje się na końcu Home, pod formularzem i statystykami. Przed logowaniem pozostaje pod sekcją z logo.


Nazwa zakładki odbieranych pytań: Questions for You (wcześniej Inbox).
