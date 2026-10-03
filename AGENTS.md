# Instrukcje projektu Neuron Storm

- Pracuj wyłącznie w tym projekcie na pulpicie. Aktywna aplikacja jest w `local-app/`; `.starter-sites/` jest nieaktywnym archiwum szablonu.
- Rozmowa z użytkownikiem po polsku. CAŁY interfejs strony, podpis logowania, komunikaty i walidacja po angielsku. Nie tłumacz treści wpisanych przez użytkownika.
- Zachowaj dostarczone logo `local-app/public/neuron-storm-logo.png`, oryginał poza projektem i czarno-czerwono-błękitną paletę.
- Zachowaj działające dwuetapowe logowanie Pelagus i serwerową weryfikację jednorazowego podpisu. Sam adres nie daje uprawnień. Nie podpisuj za użytkownika.
- Dane i uprawnienia wynikają z sesji serwera. Jedyny administrator ma adres zapisany w `server.mjs` oraz specyfikacji. Pola profilu nie mogą nadawać ról.
- Aktualny zatwierdzony zakres: landing, logowanie, tworzenie/zapis/edycja profilu, wspólne listy tematów, Home / Ask a Question, Inbox, My Questions i wspólne prywatne wątki. Minimum: pseudonim i jedna pozycja łącznie w dwóch grupach.
- Nie dodawaj lat/poziomu doświadczenia, e-maila, telefonu, awatara ani portfolio. Dalsze funkcje wymagają kolejnego zlecenia.
- Bez publikacji, transakcji i tworzenia tokena. Dane testowe oddziel od prywatnej bazy użytkownika.
- Sprawdzaj zmiany przez `node --test local-app/test/*.test.mjs`, a interfejs w przeglądarce. Pełna wizja w SPECYFIKACJA.md.

- Home po zalogowaniu i kliknięciu Neuron Storm zawiera Ask a Question: 1–100 tematów łącznie z obu grup. Odbiorcy to unikalna suma pasujących kont poza autorem, ustalana przy wysyłaniu. Statystyki: konta, tematy, pytania, odpowiedzi.

- Zatwierdzone: wyszukiwane listy kategorii używanych w profilach, łapki góra/dół pod odpowiedziami, jedna ocena na konto/odpowiedź bez samooceny. Gwiazdki profilu = aktualne otrzymane upvotes; downvotes nie odejmują punktów.

- Przy każdej kolejnej zmianie aplikacji zwiększ wersję w local-app/package.json. Serwer wyświetla ją w lewym dolnym rogu; nie wpisuj odrębnej wersji w HTML. Drobne zmiany: patch; nowe funkcje: minor.

- Zatwierdzone: Wallet tylko do odczytu dla adresu zalogowanej sesji, QUAI i tokeny z Quaiscan na Mainnet; jawnie opisuj zakres bez innych kont, Qi i testnetu. Nie dodawaj transakcji ani podpisów do podglądu sald.

- Zatwierdzone 0.4.0: token Neuron Storm (NS), kontrakt 0x003bc332Ef45fdd554F9e81786be6312A72540E6, Quai Mainnet (chain ID 9), 18 decimals. Odczyt balanceOf/totalSupply przez oficjalny RPC, saldo w nagłówku, informacja NS is live. Nowa rejestracja wymaga wallet_watchAsset i jawnego oświadczenia użytkownika, że NS jest widoczny; API Pelagus nie dowodzi trwałego dodania. Nigdy nie przedstawiaj oświadczenia jako weryfikacji on-chain ani nie wymagaj zakupu tokenów. Zachowaj istniejące profile.

- Zatwierdzone 0.6.0: Wallet tylko NS. Cena i zmiana z Quainance. Pytania i formalne odpowiedzi wymagają podpisu personal_sign w Pelagus i serwerowej weryfikacji treści, sesji i nonce; bez transakcji. Debate to wspólny prywatny czat w pytaniu, bez dodatkowego podpisu, z obecnością online. Nie scalać ani nie usuwać historycznych wątków na podstawie podobnej treści.

- Zatwierdzone 0.8.0: jedna formalna odpowiedź na konto/pytanie, także po jej usunięciu; dalsza dyskusja w Debate. Maksymalnie 4 tematy Work & Education i 4 Hobbies & Interests w profilu (UI i serwer). Edycja/usunięcie własnej odpowiedzi: 1 NS do 0x001d5bE0940145De0c2c1D851b99f33968DED764. Tipy NS bezpośrednio do autora odpowiedzi. Aplikacja przygotowuje przelew, który zawsze zatwierdza sam użytkownik w Pelagus; agent nie wykonuje rzeczywistych transakcji. Serwer weryfikuje potwierdzony transfer NS i blokuje ponowne użycie transakcji. Edycja resetuje oceny. Pula nagród = aktualne saldo wskazanego adresu; wypłaty ręczne przez administratora. Ranking od poniedziałku 00:00 UTC: otrzymane w tygodniu upvotes, aktywność = pytania + odpowiedzi, osobno filtrowane dziedziny. Gwiazdki profilu nie resetują się co tydzień. Admin ma katalog portfeli i adresy przy pozycjach rankingu/odpowiedziach; zwykłe konta nie otrzymują tego katalogu. Liczniki online i unikalnych przeglądarek w tygodniu są przybliżone.

- Zatwierdzone 0.9.0: pytania wygasają po 7 dniach od utworzenia, także istniejące. Autor może podpisać wybór najlepszej cudzej odpowiedzi w Pelagus; zamknięcie usuwa temat z widoków użytkowników. Bez wyboru automatycznie wygrywa najwięcej upvotes, potem najwcześniejsza odpowiedź. Brak odpowiedzi — brak zwycięzcy. Prywatny snapshot Accepted answers dla administratora zawiera pytanie, odpowiedź, adres i sposób wyboru; wypłaty ręczne. Rekordy do statystyk/płatności pozostają, gwiazdki nie znikają, zamkniętych tematów nie można przywracać. Weryfikuj wersję odpowiedzi i deadline przy podpisanej akceptacji i płatnych zmianach.

- Zatwierdzone 0.10.0: subtelne pulsowanie nieprzeczytanych elementów, globus krajów osób online z dobrowolnym udziałem i pełnym ekranem. Lokalna baza IP, bez wysyłania IP poza serwer, bez dokładnych pozycji i identyfikacji osób w API globusa.

- Zatwierdzone 0.11.0: Blip na smartfonach obok Pelagus, oficjalny deep link i provider. Zachowaj serwerowe podpisy i weryfikację płatności. Portfel Blip jest osobny dla origin; nie scalać kont. Brak automatycznego finansowania. Import NS: przy unsupported instrukcja ręczna i jawne potwierdzenie użytkownika.
