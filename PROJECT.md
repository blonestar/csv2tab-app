# csv2tab-app — plan desktop aplikacije

Desktop aplikacija za **Windows** i **Linux**, rađena u Electronu, koja pretvara krojne liste iz CSV / ODS / XLSX u
binarni WT Input `.tab`. Nastala je iz web aplikacije [csv2tab](https://github.com/blonestar/csv2tab) i deli s njom
jezgro konverzije, ali ima **svoj interfejs i svoju bazu**. Ovaj dokument je plan cele aplikacije. Pravila rada za
agente su u `AGENTS.md`.

Stanje: **faza 1 (osnova) je gotova**: prozor sa bočnom trakom, `app://` protokol, most sa probnom operacijom i jezgro
preko `@core`. Baze, poslova i uvoza još nema. Kad se faza završi, označi je u odeljku [Faze](#faze).

## Cilj

Korisnik je stolarska radionica, jedan računar sa Windowsom. Web verzija pretvara jedan fajl i ne pamti ništa.
Desktop verzija vodi **poslove**: svaka uvezena krojna lista ostaje sačuvana zajedno sa ispravkama i izvozima.

Prvo izdanje:

1. **Poslovi.** Uvezena krojna lista je posao sa imenom, datumom, materijalima, ručnim ispravkama i spiskom izvezenih
   fajlova. Lista poslova ima pretragu; posao se ponovo otvara i izvozi bez originalnog fajla. Posao menjan posle
   poslednjeg izvoza je označen.
2. **WT folder zadat jednom.** Izvoz je jedan klik, bez dijaloga, pravo u folder iz podešavanja (po materijalu, bez
   ZIP-a). Ako fajl sa tim imenom već postoji, aplikacija ga sama uporedi sa novim i pokaže razlike pre prepisivanja.
3. **Pamćenje izbora.** Materijal iz CSV-a → WT materijal i traka, mapiranje kolona po zaglavlju, „Prati teksturu" po
   materijalu. Sledeći uvoz nudi ono što je prošli put izabrano.
4. **Podešavanja.** Folderi, tabela šifara kantovanja, pravilo za jednobojne dekore, spajanje istih delova, tema,
   rezervna kopija baze.
5. **Desktop integracija.** „Otvori pomoću" i prevlačenje fajla za `.csv`, `.ods`, `.xlsx`, `.tab`, jedna instanca,
   meni i prečice, rad bez interneta, instalacija i portable verzija.

Kasnije (posle prvog izdanja, vidi [Faze](#faze)): praćenje foldera, potrošnja po poslu, urednik kataloga, štampa.

Van obima: izmena logike konverzije, novi ulazni formati, macOS, nalog/licenca, telemetrija, rad sa više računara
nad istom bazom, sporedni TSV/tekst izvoz (ostaje samo u webu).

## Osnovno pravilo: jezgro konverzije živi u web repou

`web/` je **git submodul** repoa `csv2tab`, zakačen na određeni commit. Iz njega se koristi samo jezgro:

- `web/src/lib/*` — parseri (`csv`, `ods`, `xlsx`, `encoding`), pravljenje zapisa (`parts`), čitanje i pisanje `.tab`
  (`wtTab`), katalog (`catalog`), poređenje (`compare`).
- `web/src/data/wt-catalog.json` — početni katalog materijala i traka.
- `web/tests/fixtures/` — referentni fajlovi za testove.

Jezgro se **uvozi, ne kopira** (alias `@core` → `web/src/lib`). Web UI (`web/src/main.ts`, `index.html`, `style.css`,
`sketch.ts`, `theme.ts`, `worker.ts`) se ovde ne koristi.

- Ispravka konverzije ide kao PR u `csv2tab` (važe pravila iz `web/AGENTS.md`), a ovde se posle merge-a pomeri
  submodul. Tako `.tab` izlaz ostaje isti u webu i u desktopu.
- Web aplikacija se zbog desktopa ne menja. Ako jezgru zatreba nešto novo (npr. izvezena funkcija), to je običan PR u
  `csv2tab` koji ne menja ponašanje weba.
- Sve ostalo (interfejs, baza, poslovi, podešavanja, pakovanje) živi u ovom repou.

## Arhitektura

```
csv2tab-app/
├─ web/                    submodul csv2tab (jezgro konverzije)
├─ src/
│  ├─ main/                glavni proces
│  │  ├─ index.ts          prozori, app:// protokol, meni, jedna instanca
│  │  ├─ db/               baza: otvaranje, migracije, upiti
│  │  ├─ files.ts          dijalozi, čitanje i upis fajlova, WT folder
│  │  └─ ipc.ts            registracija IPC operacija
│  ├─ preload/index.ts     most: contextBridge izlaže window.api
│  ├─ shared/api.ts        tipovi mosta i zapisa iz baze (koriste ih obe strane)
│  └─ renderer/            interfejs (React + TypeScript)
├─ migrations/             numerisane SQL migracije
├─ build/                  ikonice i resursi za electron-builder
├─ tests/                  testovi baze i smoke test aplikacije
├─ electron-builder.yml
└─ package.json
```

### Podela posla između procesa

- **Renderer** radi konverziju. Jezgro traži `DOMParser` (ODS, XLSX), a on postoji samo u rendereru. Renderer dobija
  bajtove fajla od glavnog procesa, poziva jezgro i prikazuje zapise.
- **Glavni proces** drži sve što dodiruje disk: bazu, dijaloge, čitanje ulaznih fajlova, upis `.tab` fajlova.
- Renderer nema SQL ni putanje. Most izlaže imenovane operacije (`jobs.list`, `jobs.save`, `export.write`,
  `settings.get` …), a ne opšti upit ili `ipcRenderer`.

### Tehnologije

- **Electron 44** (Node 24), TypeScript, Vite. Alat za build tri cilja (main, preload, renderer) bira se u fazi 1:
  `electron-vite` ako radi sa aktuelnim Vite-om, inače Vite za renderer i esbuild za main i preload.
  **Odlučeno u fazi 1:** `electron-vite` 5 podržava Vite do 7, a aktuelni je Vite 8 (npm odbija instalaciju), pa se
  koristi Vite 8 za renderer i esbuild za main (ESM) i preload (jedan CommonJS fajl, `.cjs`). Skripte su u `scripts/`.
- **React** za interfejs. Aplikacija ima liste, tabele sa izmenom ćelija i forme za podešavanja, pa ručni DOM kao u
  webu (`main.ts` ima 1400 redova) ne bi bio održiv.
- **SQLite preko ugrađenog `node:sqlite`**, bez nativnog modula. Provereno 10. 10. 2026. na Linuxu: Electron 44.7.0,
  glavni proces, `DatabaseSync` radi (SQLite 3.53.4). Na Windowsu još nije provereno; to je deo faze 2.
  `better-sqlite3` je rezerva ako se pokaže problem.
- `fflate` (potreban jezgru za ODS/XLSX) je zavisnost ovog repoa; build mora da ga razreši i za fajlove iz `web/`.

### Učitavanje interfejsa: sopstveni protokol `app://`

Interfejs se **ne učitava preko `file://`**: Vite build koristi apsolutne putanje (`/assets/...`), a module Worker
(ako se parsiranje velikog CSV-a prebaci u Worker) ne radi sa `file://`.

Glavni proces registruje `app://` kao standardnu i sigurnu šemu (`protocol.registerSchemesAsPrivileged`, sa
`standard`, `secure`, `supportFetchAPI`) i služi izgrađeni renderer. Adresa je uvek `app://csv2tab/`. Handler mora da
odbije putanje koje izlaze iz foldera renderera (`..`). U razvoju se prozor učitava sa Vite dev servera, da radi HMR.

Podešavanja se **ne čuvaju u localStorage**, nego u bazi, pa ne zavise od origina.

### Bezbednost

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- CSP bez `unsafe-eval` i bez inline skripti; dozvoljen izvor je samo `app:` (i `blob:`/`data:` ako zatrebaju).
- Navigacija van `app://csv2tab/` se blokira, a spoljni linkovi se otvaraju u sistemskom browseru
  (`setWindowOpenHandler`, `will-navigate`).
- Renderer nikad ne zadaje putanju. Foldere (WT folder, folder za rezervne kopije) bira korisnik kroz sistemski
  dijalog u glavnom procesu, a oni se pamte u bazi. Imena fajlova iz renderera se svode na osnovno ime (bez
  separatora) pre upisa.
- Svaka IPC operacija proverava oblik argumenata pre nego što dodirne bazu ili disk.

## Interfejs

Običan desktop izgled: sistemski font, zbijene tabele, svetla i tamna tema. „Sketch" stil web aplikacije (rukopis,
rough.js, milimetarski papir) se **ne prenosi**. Jezik je srpski, latinica.

Jedan glavni prozor sa bočnom trakom:

- **Poslovi** — lista sa pretragom (ime, materijal, naziv dela, datum) i dugme za uvoz. Fajl može i da se prevuče.
- **Posao** (otvoren iz liste) — kartice:
  - *Zapisi*: tabela sa izmenom ćelija (ručne izmene su označene), zamena dimenzija po redu, upozorenja.
  - *Materijali*: za svaki materijal iz fajla WT materijal, traka, „Prati teksturu" i ime izlaznog fajla.
  - *Izvor*: sirovi redovi i mapiranje kolona.
  - *Izvozi*: šta je, kada i gde upisano.
- **Katalog** — pregled i pretraga materijala i traka (izmena dolazi kasnije).
- **Podešavanja**.

Poseban prozor se otvara samo za **poređenje** (posao naspram postojećeg `.tab` fajla), jer se gleda uporedo sa
zapisima. `.tab` fajl može i da se uveze kao posao radi pregleda i izmene.

Meni i prečice: Uvezi (Ctrl+O), Izvezi (Ctrl+S), Pretraga (Ctrl+F), Podešavanja, tema, O programu.

## Baza

Jedan SQLite fajl u `app.getPath('userData')` (`csv2tab.db`), WAL režim. Radi se na jednom računaru; baza se ne
stavlja na mrežni disk.

Nacrt šeme (konačan oblik se utvrđuje u fazi 2):

| Tabela | Sadržaj |
| --- | --- |
| `settings` | ključ → JSON vrednost (folderi, tema, tabela šifara kantovanja, pravila) |
| `materials`, `edge_bands` | katalog; kolona `source` razlikuje ugrađene redove od korisnikovih |
| `jobs` | ime, napomena, datumi, izvorni fajl (ime, putanja, tip, heš, **bajtovi**), `state` (JSON) |
| `job_parts` | konačni zapisi posla po materijalu (za pretragu, potrošnju i štampu) |
| `exports` | posao, materijal, ime fajla, folder, vreme, broj zapisa, heš i **bajtovi** izvezenog `.tab` |
| `material_map` | naziv materijala iz CSV-a → WT materijal, traka, „Prati teksturu" |
| `column_maps` | potpis zaglavlja → mapiranje kolona |

- **Posao čuva ulaz i odluke, ne samo rezultat.** `jobs.state` nosi ono što web drži u `FileEntry`: kodiranje,
  separator, list, mapiranje kolona, spajanje, izbor po materijalu, ime fajla i ručne izmene. Pri otvaranju se zapisi
  ponovo računaju jezgrom iz sačuvanih bajtova izvornog fajla. Fajlovi su mali (KB do nekoliko MB), pa stoje u bazi.
- **Izvoz čuva tačne bajtove.** Kasnija ispravka jezgra može da promeni rezultat za stari posao; sačuvani `.tab`
  pokazuje šta je stvarno otišlo u WT. „Menjano posle izvoza" je poređenje heša trenutnog rezultata sa poslednjim
  izvozom.
- **Katalog.** Pri prvom pokretanju se puni iz `wt-catalog.json`. Kad nova verzija donese izmenjen katalog, ugrađeni
  redovi se osvežavaju, a korisnikovi se ne diraju.
- **Migracije.** Numerisani SQL fajlovi, verzija u `PRAGMA user_version`, svaka u transakciji. Pre migracije se
  pravi kopija baze pored originala. Baza novija od aplikacije se ne otvara, uz jasnu poruku.
- **Rezervna kopija.** Ručno iz podešavanja u izabrani folder, plus vraćanje iz kopije.

## Verzije

- Ovaj repo ima svoju SemVer verziju u `package.json`, nezavisnu od weba, počev od `0.1.0`. Pravila su u `AGENTS.md`.
- „O programu" prikazuje verziju aplikacije, verziju jezgra (`web/package.json`) i verziju šeme baze.
- Pomeranje submodula nasleđuje nivo promene jezgra samo ako menja ponašanje desktopa (izmena u `web/src/lib` ili u
  katalogu). Izmena koja dira samo web UI ne podiže verziju ovde.

## Pakovanje i izdanja

- **electron-builder**. Windows: NSIS instalacija (po korisniku, bez administratorskih prava) i portable `.exe`,
  x64. Linux: AppImage, x64.
- Asocijacije fajlova (`fileAssociations`) za `.tab`, `.csv`, `.ods`, `.xlsx`, bez preuzimanja podrazumevanog programa
  za `.csv`/`.xlsx` (samo stavka u „Otvori pomoću").
- Portable verzija koristi isti `userData` kao instalirana, da baza ne zavisi od toga odakle je `.exe` pokrenut.
- Ikonice se generišu iz logoa web aplikacije (`.ico` za Windows, PNG skup za Linux).
- Electron je u `devDependencies`; u paket ulaze izgrađeni `main`, `preload`, `renderer` i `migrations` (`asar`).
- CI: GitHub Actions, matrica `windows-latest` + `ubuntu-latest`, pokreće se na tag `v*`, gradi pakete i kači ih na
  GitHub Release. Submodul je privatan repo, pa checkout traži deploy ključ ili token sa pristupom repou `csv2tab`.

## Faze

Svaka faza je posebna grana iz `main`-a i poseban PR.

- [x] **0. Kostur** (urađeno pri postavljanju): repo, submodul, plan, pravila.
- [x] **1. Osnova**: Electron, TypeScript, build, `app://` protokol, bezbednosna podešavanja, most sa jednom
      probnom operacijom, prozor sa bočnom trakom, uvoz jezgra preko `@core`. *Gotovo kad:* `npm run dev` otvara
      prozor, renderer jezgrom pretvara CSV, ODS i XLSX fixture iz `web/tests/fixtures/` u iste `.tab` bajtove (a
      referentni `.tab` fajlovi prolaze čitanje pa pisanje bajt-identično), a `npm run build` daje pokretljiv
      nespakovan build.
- [ ] **2. Baza**: `node:sqlite`, migracije, `settings`, punjenje kataloga, IPC operacije sa proverom argumenata.
      *Gotovo kad:* testovi baze prolaze (prazna baza, migracija sa prethodne šeme, odbijanje novije baze), a
      podešavanje upisano kroz interfejs preživljava restart. Proveriti `node:sqlite` na Windowsu.
- [ ] **3. Uvoz, pregled, izvoz**: uvoz fajla (dijalog i prevlačenje), mapiranje kolona, tabela zapisa sa izmenom,
      materijali, izvoz u WT folder sa poređenjem pre prepisivanja, prozor za poređenje. *Gotovo kad:* fixture izvezen
      kroz aplikaciju je bajt-identičan referentnom `.tab`, a izvoz preko postojećeg fajla prikazuje razlike.
- [ ] **4. Poslovi**: čuvanje posla (izvor, `state`, zapisi, izvozi), lista sa pretragom, ponovno otvaranje, oznaka
      „menjano posle izvoza". *Gotovo kad:* posao sa ručnim izmenama posle restarta daje isti `.tab` bez originalnog
      fajla na disku.
- [ ] **5. Pamćenje izbora i podešavanja**: `material_map`, `column_maps`, stranica podešavanja (folderi, tabela
      kantova, pravila, tema), rezervna kopija i vraćanje. *Gotovo kad:* drugi uvoz fajla sa istim materijalima ne
      traži nijedan ručni izbor.
- [ ] **6. Desktop integracija**: meni i prečice, jedna instanca, otvaranje fajlova iz argumenata i druge instance,
      pamćenje veličine i položaja prozora.
- [ ] **7. Pakovanje**: electron-builder, ikonice, asocijacije fajlova. *Gotovo kad:* AppImage radi na Fedori, a
      NSIS instalacija i portable `.exe` rade na čistom Windows 10/11 (instalacija, „Otvori pomoću", nadogradnja
      preko starije verzije bez gubitka baze, deinstalacija).
- [ ] **8. CI i izdanja**: GitHub Actions na tag, paketi na Release, testovi i smoke test u CI-u.

Kasnije, redosled nije utvrđen:

- **Praćenje foldera**: aplikacija gleda folder u koji program za projektovanje izvozi i nudi nov fajl za uvoz.
- **Potrošnja po poslu**: m² po materijalu i metri trake po vrsti, iz `job_parts`.
- **Urednik kataloga**: dodavanje i izmena materijala i traka.
- **Štampa**: radionica za sada ne štampa liste. Mogućnost ostaje otvorena tako što `job_parts` čuva konačne zapise
  po poslu, a pregled posla je poseban prikaz koji može da dobije varijantu za štampu (`webContents.print` /
  `printToPDF`) ili nalepnice. Za to sada ne treba ništa dodatno graditi.
- **Obaveštenje o novoj verziji** (zavisi od odluke ispod).

## Testiranje

- Logiku konverzije pokrivaju vitest testovi u `web/tests`. Ovde se ne dupliraju.
- **Baza**: vitest testovi nad `node:sqlite` u običnom Node-u (bez Electrona), svaki nad privremenim fajlom:
  migracije, upiti, punjenje kataloga.
- **Smoke test** (Playwright `_electron`): pokreni aplikaciju sa privremenim `userData`, uvezi fixture, izvezi u
  privremeni folder, uporedi bajtove sa referentnim `.tab`, ponovo pokreni i proveri da posao postoji. Dijalozi se u
  testu zaobilaze promenljivom okruženja koja zadaje putanju.
- Ručna provera na Windowsu pre svakog izdanja: instalacija preko prethodne verzije, otvaranje fajla sa dijakritikom
  u imenu i putanji, izvoz u folder sa postojećim fajlovima.

## Otvorene odluke (odlučuje korisnik)

- **Potpisivanje za Windows.** Bez sertifikata SmartScreen pri prvoj instalaciji prikazuje „Unknown publisher".
  Pretpostavka dok se ne odluči drugačije: bez potpisa.
- **Ažuriranje.** Repo je privatan, pa `electron-updater` ne može da čita GitHub Releases bez tokena.
  Pretpostavka: bez automatskog ažuriranja; kasnija faza samo proverava javni JSON sa poslednjom verzijom i nudi
  link. Gde stoji taj JSON i instalacije (javni repo samo za izdanja, Vercel, nešto treće) nije odlučeno.
- **Linux paketi.** Pretpostavka: samo AppImage. `.rpm` na zahtev.
