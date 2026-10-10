# csv2tab-app — plan desktop aplikacije

Desktop aplikacija za **Windows** i **Linux**, rađena u Electronu, koja pretvara krojne liste iz CSV / ODS / XLSX u
binarni WT Input `.tab`. Nastala je iz web aplikacije [csv2tab](https://github.com/blonestar/csv2tab) i deli s njom
jezgro konverzije, ali ima **svoj interfejs i svoju bazu**. Ovaj dokument je plan cele aplikacije. Pravila rada za
agente su u `AGENTS.md`.

Stanje: **faze 0–6 su gotove**. Uvoz pravi posao u bazi, izmene se čuvaju same, a posao se otvara i izvozi bez
originalnog fajla. Novi poslovi preuzimaju zapamćene izbore materijala i kolona i snimak pravila iz podešavanja.
Podešavanja imaju tabelu kantovanja, pravilo za jednobojne dekore, spajanje, foldere, temu i rezervnu kopiju sa
vraćanjem. Meni ima prečice, jedna instanca prima fajlove iz argumenata i drugih pokretanja, a glavni prozor
pamti veličinu i položaj. Provere su na Linuxu; `node:sqlite` na Windowsu nije proveren.

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
│  │  ├─ db/               baza: otvaranje, migracije, katalog, podešavanja (bez Electrona, radi i u Node-u)
│  │  ├─ files.ts          dijalozi za fajl i folder (u testu zaobiđeni promenljivom okruženja)
│  │  ├─ export.ts         provera i atomičan upis .tab fajlova u WT folder; exportName.ts: bezbedno ime
│  │  ├─ operations/       IPC operacije po oblastima (app, settings, catalog ...), svaka sa validate + run
│  │  └─ ipc.ts            registracija IPC operacija
│  ├─ preload/index.ts     most: contextBridge izlaže window.api
│  ├─ shared/              api.ts: tipovi mosta; settings.ts: ključevi podešavanja sa tipom i proverom;
│  │                       job.ts: JobState, stanje jednog uvezenog fajla (obični JSON)
│  └─ renderer/            interfejs (React + TypeScript); job/derive.ts izvodi zapise iz bajtova + JobState
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

- **Poslovi** — lista (najnoviji prvi, po 50 sa „Prikaži još“) sa pretragom (ime, napomena, fajl, materijal, naziv
  dela, datum) i dugme za uvoz. Fajl može i da se prevuče. Svaki red pokazuje stanje izvoza: nije izvezen / izvezen /
  menjan posle izvoza. Ako je uvezen fajl isti (SHA-256) kao izvor postojećeg posla, pita se: otvori postojeći, napravi
  nov ili odustani.
- **Posao** (otvoren iz liste, dugme „← Poslovi“ vraća na listu) — ime i napomena se menjaju na licu mesta, indikator
  čuvanja (sačuvano / čeka / čuvam / nije sačuvano), brisanje posla (potvrda kaže da se brišu i sačuvani izvozi, a da
  fajlovi u WT folderu ostaju). Kartice:
  - *Zapisi*: tabela sa izmenom ćelija (ručne izmene su označene), zamena dimenzija po redu, upozorenja.
  - *Materijali*: za svaki materijal iz fajla WT materijal, traka, „Prati teksturu" i ime izlaznog fajla.
  - *Izvor*: sirovi redovi i mapiranje kolona.
  - *Izvozi*: trenutni fajlovi posla sa stanjem svakog (izvezen / menjan / nije izvezen) i istorija izvoza iz baze
    (vreme, fajl, broj zapisa, ishod „upisano“ ili „isti fajl već postoji“, folder).
- **Katalog** — pregled i pretraga materijala i traka (izmena dolazi kasnije).
- **Podešavanja**.

Poseban prozor se otvara samo za **poređenje** (posao naspram postojećeg `.tab` fajla), jer se gleda uporedo sa
zapisima. `.tab` fajl može i da se uveze kao posao radi pregleda i izmene.

Meni i prečice: Uvezi (Ctrl+O), Izvezi (Ctrl+S), Pretraga (Ctrl+F), Podešavanja, tema, O programu.

Jedna instanca (`requestSingleInstanceLock`) se zaključava pre otvaranja baze. Podržani fajlovi iz argumenata
prvog ili drugog procesa ulaze u red u glavnom procesu; relativne putanje se razrešavaju u folderu procesa
koji ih šalje. Renderer preuzima sledeće ime i bajtove kroz `files.next`, bez putanje. Važe ista pravila uvoza,
duplikata i čuvanja kao kroz dijalog. Drugo pokretanje vraća minimizovan glavni prozor i daje mu fokus.
Ctrl+F čuva i zatvara posao pre fokusa na pretragu liste; neuspešno čuvanje traži postojeću odluku o nastavku.
Pri zatvaranju se pamte normalne granice prozora i maksimizacija, a pri pokretanju prilagođavaju dostupnim
ekranima. Prozor poređenja ne menja sačuvani položaj glavnog prozora.

## Baza

Jedan SQLite fajl u `app.getPath('userData')` (`csv2tab.db`), WAL režim. Radi se na jednom računaru; baza se ne
stavlja na mrežni disk.

Šema se vodi migracijama u `migrations/`. **Konačan oblik (migracija `0001_init.sql`, faza 2):**

| Tabela | Kolone |
| --- | --- |
| `settings` | `key` (PK), `value` (JSON). Zatvoren skup u `src/shared/settings.ts`: `theme`, `wtFolder`, `backupFolder`, `edgeRules`, `decorRule`, `mergeDefault`, svaki sa strogom proverom. Nema ključa = podrazumevana vrednost. Folderi se upisuju samo izborom kroz `files.chooseFolder`; ostalo odmah kroz `settings.set`. |
| `materials` | `id` (PK), `source` (`builtin` / `user`), `code`, `name`, `sheet_w`, `sheet_h`, `thickness`, `grain` (0/1), `position` (redosled iz kataloga). `code` je jedinstven među `builtin` redovima (parcijalni indeks); korisnikov red sme da ima istu šifru. |
| `edge_bands` | `id` (PK), `source`, `code`, `name`, `position`; ista pravila kao za materijale. |
| `meta` | `key` (PK), `value`: unutrašnji podaci (`catalog_hash`, `window_state`: JSON normalnih granica glavnog prozora i maksimizacije). Ne izlaže se rendereru. |

**Migracija `0002_poslovi.sql` (faza 4)**, vremena su milisekunde (UTC):

| Tabela | Kolone |
| --- | --- |
| `jobs` | `id` (PK), `name`, `note`, `created_at`, `updated_at`, `source_name`, `source_kind` (`csv`/`ods`/`xlsx`/`tab`), `source_size`, `source_sha256`, `source_path` (samo za uvoz kroz dijalog, inače `NULL`; renderer je nikad ne vidi), `state` (JSON `JobState`), `part_count`, `outputs` (JSON: trenutni izlazni fajlovi `{material, name, sha256, count}`), `export_status` (`never`/`current`/`changed`), `last_export_at`, `search` (tekst za pretragu), `source_bytes` (BLOB, posle upisa se ne menja). Indeksi: `(created_at DESC, id DESC)` i `source_sha256`. |
| `job_parts` | konačni zapisi posla po materijalu, posle ručnih izmena: `job_id` → `jobs` (`ON DELETE CASCADE`), `position`, `material` (naziv iz fajla), `wt_code` (šifra WT materijala, `''` = nijedan; nije `materials.id`), `dim1`, `dim2`, `edge1`, `edge2`, `grain`, `qty`, `name`. PK `(job_id, position)`. Zamenjuju se pri svakom čuvanju, u istoj transakciji kao `state`. |
| `exports` | `id` (PK), `job_id` → `jobs` (`ON DELETE CASCADE`), `material`, `file_name`, `folder`, `exported_at`, `record_count`, `size`, `sha256`, `result` (`written` / `identical` = u folderu je već bio bajt-identičan fajl), `bytes` (BLOB: tačno upisano). Nastaje samo za upisane i bajt-identične fajlove, nikad za preskočene ili neuspele. |

**Migracija `0003_pamcenje.sql` (faza 5)**, vremena su milisekunde (UTC); obe tabele su `STRICT, WITHOUT ROWID`:

| Tabela | Kolone |
| --- | --- |
| `material_map` | `name` (PK: NFC, trim, jedan razmak između reči, mala slova; dijakritici ostaju), `label` (poslednji prikazani naziv), `wt_code` (šifra, nije `materials.id`; `''` = izričito nijedan), `band` (šifra trake; `''` = bez trake), `grain` (0/1), `updated_at`. `NULL` u svakom polju znači da ono nije zapamćeno. |
| `column_maps` | `signature` (PK: zaglavlje svedeno jezgrovim `normHeader`, bez praznih ćelija na kraju, spojeno U+001F), `mapping` (JSON `ColumnMapping`: indeksi, -1 = nema), `updated_at`. Bez zaglavlja nema potpisa. |

- **Ponovljivost i pamćenje.** Novi posao u `JobState` verzije 2 kopira zapamćene izbore i mapiranje, tabelu
  `edgeRules` i `decorRule`, uz početni `merge`. Kasnija promena podešavanja ili pamćenja utiče samo na nove
  poslove. Kartica Izvor pokazuje razliku pravila i nudi „Primeni trenutna podešavanja“ kao običnu izmenu posla
  koja se automatski čuva. Materijali pokazuju poreklo svakog izbora: pamćenje, predlog iz kataloga ili ručno.
  Verzija 1 se nadograđuje čistom funkcijom pri čitanju (`DEFAULT_EDGE_RULES`, uključeno pravilo za dekore),
  bez SQL prepisivanja poslova; testovi porede stare referentne heševe izlaza.
- **Kada se pamti.** Ručna izmena materijala ili mapiranja se upisuje u istoj transakciji sa poslom. Uspešan
  izvoz potvrđuje sve važeće izbore izvezenih materijala, uključujući predloge, smer po pravilu i „nijedan“.
  Ručno ime izlaznog fajla se ne pamti. Podešavanja nude pregled i brisanje zapamćenih stavki.
- **Nepodoban izbor.** Šifra WT materijala ili trake koje više nema u katalogu preskače se pri novom uvozu
  (ostaje u tabeli za pregled/brisanje); koristi se predlog iz kataloga. Mapiranje sa indeksom van novih kolona
  ili bez obavezne kolone se preskače i koristi se automatsko. Ključ materijala je naziv, bez debljine: isti
  naziv sa drugom debljinom preuzima isti izbor. Debljina WT materijala i predlog imena dolaze iz izabranog
  reda kataloga; druga debljina u fajlu ne bira novu šifru. Ako treba drugi WT materijal, bira se ručno i taj
  izbor važi za sledeće uvoze istog naziva.

- **Čuvanje posla.** Uvoz odmah poziva `jobs.create` (izvorni bajtovi, početno stanje, zapisi, izlazni fajlovi); svaka
  izmena stanja ide kroz `jobs.save` (stanje, zapisi, izlazni fajlovi; izvor se ne dira). Renderer šalje i izlazne
  `.tab` bajtove, a glavni proces sam računa SHA-256 (proverava samo da veličina odgovara broju zapisa). Sve što stiže
  proverava `src/main/operations/validate.ts`, a stanje `parseJobState` (`src/shared/jobStateCheck.ts`): nepoznato
  polje, tip, verzija ili preveliki spisak se odbijaju. Isti `parseJobState` se poziva pri čitanju iz baze; ako stanje
  ne prolazi (npr. iz novije verzije), `jobs.get` vraća `state: null` i poruku, a posao se prikazuje samo kao poruka
  (bez izmena i izvoza) i može da se obriše.
- **Automatsko čuvanje (`src/renderer/session.tsx`).** Izmena stanja pokreće tajmer od 700 ms (nova izmena ga
  restartuje); upisi idu jedan za drugim. Odmah (bez čekanja) se čuva pre: povratka na listu, otvaranja drugog posla,
  uvoza, izvoza i zatvaranja glavnog prozora (glavni proces šalje `app.flush`, čeka odgovor najviše 8 s, pa pita
  korisnika ako čuvanje nije uspelo). Neuspeo upis se vidi (indikator „Nije sačuvano“, poruka sa uzrokom), ponavlja se
  na 4 s i ima dugme „Pokušaj ponovo“; napuštanje posla tada traži odluku (ponovo / bez čuvanja / ostani). Prozor
  poređenja ne učestvuje.
- **Stanje izvoza (`jobs.export_status`).** Izračunava se pri svakom čuvanju posla i pri svakom beleženju izvoza
  (`computeExportStatus` u `src/main/db/jobs.ts`), pa je lista običan upit. Trenutni izlazni fajlovi posla su
  `jobs.outputs` (ime i SHA-256 iz poslednjeg čuvanja). Svaki se poredi sa NAJNOVIJIM izvozom pod istim imenom (bez
  razlike u veličini slova): nema izvoza = `never`, isti heš = `current`, drugi heš = `changed`. Posao: ništa nikad
  izvezeno = `never`; inače `current` samo ako je svaki trenutni fajl `current`. Posledice: jedan izmenjen materijal od
  tri daje „menjan“ (kartica Izvozi pokazuje koji); izmena pa vraćanje izmene daje opet „izvezen“ (porede se bajtovi);
  promenjeno ime fajla ili materijala posle izvoza daje „menjan“ dok se novo ime ne izveze (stari izvozi ostaju u
  istoriji, ali se ne računaju); preskočeno prepisivanje se ne beleži, pa posao ostaje „menjan“ (ili „nije izvezen“);
  posao koji je izvezen, a sad nema nijedan izlazni fajl, je „menjan“. Folder se ne poredi, samo ime i bajtovi.
- **Pretraga.** `LIKE` nad kolonom `jobs.search` (reči se spajaju sa AND), ne FTS5. FTS5 jeste ugrađen u `node:sqlite`
  Electrona 44 (provereno, uključujući `trigram`), ali SQLite-ov `lower()`/`LIKE` ne svode slova van ASCII (`lower('Š')`
  ostaje `Š`), pa bi indeks ionako tražio tekst svođen u JavaScript-u; trigram traži bar 3 znaka i udvostručuje bazu,
  a skeniranje kolone je za nekoliko hiljada poslova brzo (3000 poslova sa 20 zapisa: lista 1 ms, pretraga do 5 ms).
  Tekst se sklapa pri čuvanju (`src/main/db/search.ts`): mala slova, bez dijakritika (NFD), a `đ` se čuva i kao `d` i
  kao `dj` (nalazi se po `dorde` i po `djordje`). Isto svođenje prolazi upit, pa „sto“ nalazi „što“ i „ŠTO“ nalazi „sto“.
  Datum je u tekstu kao `dd.mm.gggg` i `gggg-mm-dd`. Ako lista poslova naraste toliko da ovo bude sporo, prelazi se na
  FTS5 sa istim svođenim tekstom.

- **Stanje posla (`JobState`, faza 3).** Tip je u `src/shared/job.ts`, običan JSON bez `Map`/`Set`/`Uint8Array`:
  kodiranje, separator, list, mapiranje (`'auto'` ili izbor), spajanje, izbor po materijalu (`MaterialChoice`: WT
  materijal, traka, „Prati teksturu", ime fajla; odsutno polje = predlog) i ručne izmene po ključu zapisa. Sve izvedeno
  računa čista funkcija `deriveJob(file, state, catalog, cache?)` u `src/renderer/job/derive.ts`; prelazi stanja
  (promena izvora briše izmene) su u `src/renderer/job/state.ts`. Posao u bazi čuva `bajtovi izvora + JobState`, a
  `deriveJob` se poziva pri otvaranju; interfejs ne sme da drži nijednu odluku van `JobState`. Početna pravila i
  spajanje dolaze iz podešavanja preko `src/renderer/job/defaults.ts`. Isključeno pravilo za dekore postavlja
  smer kroz `grainByMaterial`, bez promene jezgrovog `defaultGrain`; izričit izbor po materijalu ima prednost.
- **Posao čuva ulaz i odluke, ne samo rezultat.** `jobs.state` nosi ono što web drži u `FileEntry`: kodiranje,
  separator, list, mapiranje kolona, spajanje, izbor po materijalu, ime fajla i ručne izmene. Pri otvaranju se zapisi
  ponovo računaju jezgrom iz sačuvanih bajtova izvornog fajla. Fajlovi su mali (KB do nekoliko MB), pa stoje u bazi.
- **Izvoz čuva tačne bajtove.** Kasnija ispravka jezgra može da promeni rezultat za stari posao; sačuvani `.tab`
  pokazuje šta je stvarno otišlo u WT. „Menjano posle izvoza" je poređenje heša trenutnog rezultata sa poslednjim
  izvozom.
- **Katalog.** Pri prvom pokretanju se puni iz `wt-catalog.json` (uvezen u main bundle). Promena se prepoznaje po
  SHA-256 otisku materijala i traka, sačuvanom u `meta.catalog_hash`. Ako se otisak razlikuje, u **jednoj transakciji**
  se ugrađeni redovi dodaju/menjaju po šifri (`id` ostaje isti), ugrađeni kojih više nema se brišu, a `user` redovi se
  ne diraju. Kasnije tabele koje pominju materijal treba da koriste `materials.id` sa `ON DELETE SET NULL` (ili
  šifru), jer ugrađeni red može da nestane iz novog kataloga. Šifre u trenutnom katalogu su jedinstvene (860 + 10).
  Renderer dobija katalog operacijom `catalog.get` u obliku `WtCatalog`, pa radi `searchMaterials` iz jezgra.
- **Migracije.** Numerisani SQL fajlovi (`0001_ime.sql`, bez rupa), verzija u `PRAGMA user_version`, svaka u svojoj
  transakciji (zajedno sa podizanjem verzije). Pre migracije postojeće baze pravi se kopija `csv2tab.db.v<stara>.bak`
  pored originala (`VACUUM INTO`). Baza novija od aplikacije se ne otvara niti menja (verzija se čita otvaranjem samo
  za čitanje); aplikacija prikaže poruku na srpskom i izlazi. Folder `migrations/` se u izgrađenoj aplikaciji nalazi
  relativno u odnosu na `dist/main/index.js` (`../../migrations`); u asaru ostaje isti odnos (korenski folder asara),
  a čita se samo `fs`-om, što radi i unutar asara.
- **Tema.** Čuva se u bazi, a primenjuje je glavni proces preko `nativeTheme.themeSource` pre otvaranja prozora, pa
  CSS (`prefers-color-scheme`) prati izbor bez skripte i bez treperenja pri pokretanju.
- **Rezervna kopija.** Posle čuvanja otvorenog posla `VACUUM INTO` pravi samostalan fajl sa vremenom u imenu.
  Vraćanje bira fajl u glavnom procesu, pravi privremenu kopiju i proverava `integrity_check`, očekivane tabele
  i kolone, veze i `user_version`. Prikazuje broj poslova i datum najnovijeg i traži potvrdu. Starija kopija se
  migrira pre zamene. Zatim se trenutna baza zatvara uz checkpoint, uklanjaju stari WAL/SHM, a prethodna baza
  ostaje kao sigurnosna kopija pored nove. Prozor se ponovo učitava. Odustajanje ili neuspeh čuva trenutnu bazu.

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
  GitHub Release. Po odluci korisnika oba repoa su javna, pa submodul ne traži poseban ključ ili token.

## Faze

Svaka faza je posebna grana iz `main`-a i poseban PR.

- [x] **0. Kostur** (urađeno pri postavljanju): repo, submodul, plan, pravila.
- [x] **1. Osnova**: Electron, TypeScript, build, `app://` protokol, bezbednosna podešavanja, most sa jednom
      probnom operacijom, prozor sa bočnom trakom, uvoz jezgra preko `@core`. *Gotovo kad:* `npm run dev` otvara
      prozor, renderer jezgrom pretvara CSV, ODS i XLSX fixture iz `web/tests/fixtures/` u iste `.tab` bajtove (a
      referentni `.tab` fajlovi prolaze čitanje pa pisanje bajt-identično), a `npm run build` daje pokretljiv
      nespakovan build.
- [x] **2. Baza**: `node:sqlite`, migracije, `settings`, punjenje kataloga, IPC operacije sa proverom argumenata.
      *Gotovo kad:* testovi baze prolaze (prazna baza, migracija sa prethodne šeme, odbijanje novije baze), a
      podešavanje upisano kroz interfejs preživljava restart. Proveriti `node:sqlite` na Windowsu.
      **Otvoreno:** `node:sqlite` je proveren samo na Linuxu; provera na Windowsu ostaje za ručnu probu (i za fazu 7).
- [x] **3. Uvoz, pregled, izvoz**: uvoz fajla (dijalog i prevlačenje), mapiranje kolona, tabela zapisa sa izmenom,
      materijali, izvoz u WT folder sa poređenjem pre prepisivanja, prozor za poređenje. *Gotovo kad:* fixture izvezen
      kroz aplikaciju je bajt-identičan onome što jezgro daje za isti fajl (referentni `Kronospan Kasmir.tab` je
      ručno pravljen i namerno se razlikuje od CSV-a, pa nije mera), izvoz preko postojećeg fajla prikazuje razlike
      (ručni `.tab` naspram izvoza: 10 zapisa različito) i ništa ne prepisuje bez potvrde, a izmena ćelije kroz
      interfejs stiže u izvezeni fajl. Provereno smoke testom na Linuxu; na Windowsu nije.
      **Otvoreno:** tabela zapisa crta samo vidljive redove (bez ograničenja od 3000 kao u webu); CSV se parsira u
      glavnoj niti rendera (bez Workera); provereno sa 6000 redova.
- [x] **4. Poslovi**: čuvanje posla (izvor, `state`, zapisi, izvozi), lista sa pretragom, ponovno otvaranje, oznaka
      „menjano posle izvoza". *Gotovo kad:* posao sa ručnim izmenama posle restarta daje isti `.tab` bez originalnog
      fajla na disku. Provereno smoke testom na Linuxu (izvoz u prazan folder posle restarta je bajt-identičan prvom);
      na Windowsu nije.
      **Otvoreno:** nema poređenja sa sačuvanim izvozom u interfejsu (bajtovi su u bazi); nema izmene imena fajla ni
      ponovnog uvoza istog posla sa novog mesta; posao ne pamti u kom WT folderu je poslednji put izvezen osim kroz
      istoriju izvoza.
- [x] **5. Pamćenje izbora i podešavanja**: `material_map`, `column_maps`, stranica podešavanja (folderi, tabela
      kantova, pravila, tema), rezervna kopija i vraćanje. *Gotovo kad:* drugi uvoz fajla sa istim materijalima ne
      traži nijedan ručni izbor. Provereno smoke testom na Linuxu, uključujući snimak pravila i vraćanje kopije.
- [x] **6. Desktop integracija**: meni i prečice, jedna instanca, otvaranje fajlova iz argumenata i druge instance,
      pamćenje veličine i položaja prozora. Provereno na Linuxu kroz smoke; Windows čeka proveru.
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
  privremeni folder, uporedi bajtove sa referentnim `.tab`, ponovo pokreni i proveri da posao postoji. Test čeka na uslove
  na stranici (indikator čuvanja, `data-loaded` liste), nikad na fiksno vreme; uvozi iz privremene kopije fajla koju briše
  pre restarta; menja bazu samo dok je aplikacija zatvorena (neispravno stanje). Dijalozi se u
  testu zaobilaze promenljivama okruženja `CSV2TAB_TEST_IMPORT`, `CSV2TAB_TEST_COMPARE`, `CSV2TAB_TEST_FOLDER`,
  `CSV2TAB_TEST_RESTORE` i `CSV2TAB_TEST_FAIL_SAVE` (svako čuvanje posla pada) koje
  glavni proces čita pri svakom pozivu, ali samo uz `CSV2TAB_TEST=1` i nikad u spakovanoj aplikaciji
  (`src/main/testHooks.ts`).
- Ručna provera na Windowsu pre svakog izdanja: instalacija preko prethodne verzije, otvaranje fajla sa dijakritikom
  u imenu i putanji, izvoz u folder sa postojećim fajlovima.

## Otvorene odluke (odlučuje korisnik)

- **Potpisivanje za Windows.** Bez sertifikata SmartScreen pri prvoj instalaciji prikazuje „Unknown publisher".
  Pretpostavka dok se ne odluči drugačije: bez potpisa.
- **Ažuriranje.** Oba repoa su javna; automatsko ažuriranje i dalje nije uvedeno.
  Pretpostavka: bez automatskog ažuriranja; kasnija faza samo proverava javni JSON sa poslednjom verzijom i nudi
  link. Gde stoji taj JSON i instalacije (javni repo samo za izdanja, Vercel, nešto treće) nije odlučeno.
- **Linux paketi.** Pretpostavka: samo AppImage. `.rpm` na zahtev.
