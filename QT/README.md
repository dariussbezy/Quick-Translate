# Quick Translate pentru Valenced — 2.0.0-beta1

Rescriere nouă în TypeScript. Arhiva Rain a fost citită ca referință de comportament; sursele vechi nu au fost modificate și nu sunt incluse în pachet.

Ținta acestei beta: **Valenced 1.3.0 și Discord 352.6 Alpha**, conform versiunilor comunicate. Manifestul acceptă API Valenced >=1.3 <2 și Discord >=352.6 <352.7. Restricția declară ținta; nu înlocuiește testarea pe dispozitiv.

## Instalare

1. Deschide Discord cu Valenced.
2. Settings → Valenced → Plugins → rotița de setări → Install from file.
3. Selectează `Quick-Translate-Valenced-2.0.0-beta1.zip` (nu arhiva surselor).
4. Activează pluginul și reîncarcă Discord.
5. Deschide setările Quick Translate și alege limbile. Butonul „Open translator” permite testarea serviciului chiar dacă un hook al interfeței Discord nu mai corespunde versiunii instalate.
6. În chat: butonul 文 deschide traducătorul. Apăsarea lungă pe un mesaj adaugă „Translate”, dacă structura meniului este compatibilă.

Nu trebuie dezarhivat ZIP-ul de instalare. Pluginul instalat din fișier nu primește automat actualizări. ID nou: `dariuss.quick-translate`; nu importă automat datele Rain/Kettu.

## Funcții implementate

- Google Translate și DeepL (cheie proprie, inclusiv Free API).
- Limbi separate pentru mesaje primite și proprii; detectarea automată a limbii sursă.
- Traducător cu text editabil, rezultat, copiere, înlocuirea ciornei și revenire la original dacă utilizatorul nu a schimbat între timp ciorna/conversația.
- Meniu Translate pentru mesajele cu text; afișare sub original sau înlocuirea locală a afișării. Conținutul mesajului din store nu este modificat de renderer.
- Limbi memorate per conversație și maximum șase limbi favorite.
- Traducere automată opțională la trimitere. La eroare cererea de trimitere eșuează, fără trimiterea automată a originalului.
- Traducere automată a mesajelor noi de la alți utilizatori în conversația vizibilă, doar pentru conversațiile activate explicit.
- Selecție pentru traducerea a maximum 25 de mesaje deja încărcate în conversația curentă; fără descărcarea istoricului de pe server.
- Istoric local (maximum 100), traduceri locale ale mesajelor (maximum 300), cache în memorie (maximum 200).
- Protejarea codului, linkurilor, mențiunilor, emoji-urilor Discord și a termenilor aleși. Dacă serviciul alterează un marcaj protejat, rezultatul este respins.
- Cereri serializate, deduplicare, coadă limitată, timeout, pauză după HTTP 429 și anulare la oprire/ștergerea cache-ului.

## Diferențe față de versiunea Rain

Aceasta este prima versiune beta, nu o declarație de paritate completă și nici o versiune verificată pe telefon.

- Traducerea ciornei se confirmă în panou cu „Use in draft”; nu înlocuiește butonul Send cu un control în doi pași.
- Butonul are o singură poziție, lângă acțiunile composerului. Nu ascunde Gift și nu modifică alte butoane Discord.
- Traducerea automată în fundal, în toate conversațiile, este eliminată; lucrează numai în conversația vizibilă.
- Traducerea în lot folosește mesajele deja încărcate, fără paginarea istoricului de pe server.
- Istoricul permite copiere/ștergere; saltul la mesaj nu este implementat în această beta.
- Nu există fallback automat DeepL → Google. Schimbarea serviciului se face explicit în panou; nu trimitem textul către un al doilea furnizor fără alegerea utilizatorului.
- Cache-ul nu este salvat pe disc. Istoricul și traducerile mesajelor pot fi păstrate, conform opțiunilor.
- Traducerea afișată în chat este un nod de text simplu. Sintaxa protejată se păstrează în text, dar randarea ei ca mențiuni/emoji/Markdown în secțiunea tradusă nu este încă implementată. Culoarea din panou este implementată; culoarea din chat depinde de suportul rendererului pentru stilul nodului.

## Verificări și limite

Verificate: TypeScript strict, compilare folosind codul compilatorului oficial Valenced, structură ZIP, nouă teste automate pentru motor și contractul de lifecycle într-un runtime simulat.

NU sunt verificate pe un dispozitiv: descoperirea modulelor private Discord, locul butonului, structura meniului de apăsare lungă, actualizarea ciornei și regenerarea rândurilor native ale mesajelor. Acestea necesită versiunea concretă Discord/Valenced și testare în aplicație. Testele simulate nu dovedesc compatibilitatea acestor module.

Nu am măsurat FPS, timpul de pornire sau consumul de memorie pe telefon. Fișierul compilat este mai mic decât cel vechi; aceasta nu reprezintă un benchmark de performanță.

Nu există cod Kotlin/Java/Objective-C sau căi Android în plugin. Este proiectat pentru runtime-ul comun JavaScript/React Native; compatibilitatea iOS nu a fost testată și nu este garantată doar prin absența codului nativ.

Google folosește un endpoint neoficial și poate refuza sau limita cererile. DeepL poate avea costuri/limite asociate contului. Nu s-au făcut cereri reale către furnizori în verificările automate. Textul și termenii protejați sunt procesate prin marcaje, însă serviciul primește restul textului. Cheia DeepL și istoricul sunt în stocarea locală a pluginului, fără criptare proprie.

## Reconstruirea surselor

Din folderul `QT` rulează comenzile de mai jos.

Node 24 recomandat (minimum 22.18, pentru executarea TypeScript fără transpiler în teste).

```sh
npm ci --legacy-peer-deps
npm run check
npm test
```

`npm test` reconstruiește mai întâi pluginul. ZIP-ul apare în `build/quick-translate.zip` și este copiat ca `Quick-Translate-Valenced-2.0.0-beta1.zip` lângă manifest. Fișierul compilat este copiat și în `index.js`.

Pentru instalarea beta deja construite, descarcă [ZIP-ul pluginului](https://github.com/dariussbezy/Quick-Translate/raw/refs/heads/codex/quick-translate-valenced-beta/QT/Quick-Translate-Valenced-2.0.0-beta1.zip). Nu folosi „Download ZIP” al întregului repository pentru instalare în Valenced.

`tooling/official-cli/build.ts` este compilatorul oficial Valenced, inclus sub GPL, din commit-ul `9ea9f9bfc91319e2b18c6b1c9ac0b993f8600c1d`. Tipurile Valenced sunt fixate la commit-ul `c67dd726d1ec28b38d8ac93862fdd3b6029b1d29`.

Surse documentare: https://valenced.app/docs/plugin-development/ și https://github.com/Valenced/valenced-community-plugins .
