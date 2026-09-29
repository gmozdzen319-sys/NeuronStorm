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
