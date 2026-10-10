# csv2tab-app — plan desktop aplikacije

Desktop verzija web aplikacije [csv2tab](https://github.com/blonestar/csv2tab) za **Windows** i **Linux**, rađena u
Electronu. Ovaj dokument je plan cele aplikacije. Pravila rada za agente su u `AGENTS.md`.

Stanje: **postavljen je samo kostur repoa** (ovaj plan, `AGENTS.md`, `package.json`, submodul `web/`). Koda još nema.
Kad se faza završi, označi je u odeljku [Faze](#faze).

## Cilj

Korisnik (stolarska radionica, Windows) pretvara krojne liste iz CSV / ODS / XLSX u binarni WT Input `.tab`. Web
verzija to već radi u browseru. Desktop verzija treba da radi isto to, plus ono što browser ne može:

1. **Čuvanje direktno u folder**: dijalog „Sačuvaj kao" umesto Downloads, uz pamćenje poslednjeg foldera (tipično
   WT-ov folder sa krojnim listama).
2. **Izvoz po materijalu bez ZIP-a**: `.tab` fajlovi se upisuju pravo u izabrani folder. Pre prepisivanja postojećih
   fajlova korisnik dobija pitanje sa spiskom imena.
3. **Otvaranje iz Explorera**: „Otvori pomoću" i prevlačenje fajla na ikonicu za `.csv`, `.ods`, `.xlsx`, `.tab`.
   Aplikacija ima jednu instancu; drugi poziv prosleđuje fajlove već otvorenom prozoru.
4. **Rad bez interneta**, ikonica u Start meniju, instalacija i portable verzija.
5. **Meni i prečice**: Otvori (Ctrl+O), Sačuvaj/Izvezi (Ctrl+S), tema, O programu.

Van obima: izmena logike konverzije, novi ulazni formati, macOS, nalog/licenca, telemetrija.

## Osnovno pravilo: logika živi u web repou

Sva logika konverzije (`web/src/lib/*`), UI (`web/src/main.ts`, `web/index.html`, `web/src/style.css`) i testovi
ostaju u repou `csv2tab`. Ovaj repo sadrži **samo Electron ljusku i pakovanje**. Ništa se ne kopira.

- `web/` je **git submodul** repoa `csv2tab`, zakačen na određeni commit. Desktop build prvo izgradi `web/dist`, pa ga
  spakuje u aplikaciju.
- Ispravka konverzije ili UI-a ide kao PR u `csv2tab` (važe pravila iz `web/AGENTS.md`), a ovde se posle merge-a samo
  pomeri submodul (`git -C web pull origin main`, pa commit pokazivača).
- Web verzija na Vercelu se ne menja u ponašanju. Kod koji se dodaje u web za potrebe desktopa mora da bude neaktivan
  kad most ne postoji (vidi [Most](#most-web--desktop)).

## Arhitektura

```
csv2tab-app/
├─ web/                  submodul csv2tab (izvor UI-a i logike)
├─ electron/
│  ├─ main.ts            glavni proces: prozor, app:// protokol, meni, dijalozi, upis na disk
│  ├─ preload.ts         most: contextBridge izlaže window.csv2tabDesktop
│  └─ bridge.d.ts        tipovi mosta (isti ugovor koristi i web)
├─ build/                ikonice i resursi za electron-builder
├─ tests/                smoke test ljuske
├─ electron-builder.yml
└─ package.json
```

### Učitavanje UI-a: sopstveni protokol `app://`

UI se **ne učitava preko `file://`**. Razlozi:

- `web/src/worker.ts` je module Worker (`worker: { format: 'es' }`), a Chromium ih ne učitava sa `file://`.
- Vite build koristi apsolutne putanje (`/assets/...`), koje na `file://` pokazuju na koren diska.
- localStorage je vezan za origin. Tu su tema (`csv2tab.theme`) i tabela šifara kantovanja. Origin mora da ostane
  isti kroz sve verzije, inače korisnik gubi podešavanja.

Zato glavni proces registruje `app://` kao standardnu i sigurnu šemu (`protocol.registerSchemesAsPrivileged`, sa
`standard`, `secure`, `supportFetchAPI`) i služi fajlove iz spakovanog `web/dist`. Adresa je uvek `app://csv2tab/`.
Handler mora da odbije putanje koje izlaze iz `dist` (`..`).

U razvoju se prozor učitava sa Vite dev servera web projekta (`npm --prefix web run dev`), da radi HMR.

### Bezbednost

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- CSP bez `unsafe-eval`; dozvoljeni izvori su samo `app:` (i `blob:`/`data:` gde ih UI već koristi — proveri inline
  skriptu za temu u `web/index.html`).
- Navigacija van `app://csv2tab/` se blokira, a spoljni linkovi se otvaraju u sistemskom browseru
  (`setWindowOpenHandler`, `will-navigate`).
- Most ne izlaže `ipcRenderer` ni proizvoljne putanje. Renderer nikad ne bira putanju sam: putanju uvek bira
  korisnik kroz sistemski dijalog u glavnom procesu, a imena fajlova koja stignu iz renderera se svode na osnovno ime
  (bez separatora) pre upisa.

## Most (web ↔ desktop)

Preload izlaže `window.csv2tabDesktop`. Web kod ga koristi ako postoji, inače radi kao danas. Predlog ugovora
(konačan oblik se utvrđuje u fazi 1 i zapisuje u `electron/bridge.d.ts`):

```ts
interface Csv2tabDesktop {
  /** verzija ljuske, za footer i „O programu" */
  readonly appVersion: string;
  /** „Sačuvaj kao"; null ako je korisnik odustao */
  saveFile(req: { suggestedName: string; bytes: Uint8Array }): Promise<{ path: string } | null>;
  /** izbor foldera, pa upis svih fajlova; pita pre prepisivanja; null ako je korisnik odustao */
  saveFiles(req: { files: Record<string, Uint8Array> }): Promise<{ dir: string; written: string[] } | null>;
  /** fajlovi otvoreni iz Explorera, menija ili druge instance */
  onOpenFiles(cb: (files: { name: string; bytes: Uint8Array }[]) => void): void;
  /** komande iz menija: 'open' | 'export' … */
  onMenu(cb: (cmd: string) => void): void;
}
```

Izmene u web repou (jedan PR u `csv2tab`, faza 1):

- Novi `src/platform.ts` sa dve implementacije: web (današnji `download()` iz `src/main.ts`) i desktop (most).
- `doExportTab`, `doDownload`, `doDownloadAll` zovu platform sloj. U desktop režimu izvoz „po materijalu" i „svi
  listovi" idu kroz `saveFiles` umesto `zipSync`.
- `onOpenFiles` pravi `File` objekte i zove postojeći `addFiles()`. `onMenu('open')` klikće `#file-input`.
- Tekstovi po platformi: „Preuzmi/Preuzeto" → „Sačuvaj/Sačuvano", a „obrada u browseru" i „čuva se u ovom browseru"
  dobijaju desktop varijantu. Footer prikazuje verziju ljuske.
- Bez mosta ponašanje weba mora da ostane bajt-identično. Web testovi (`npm --prefix web test`) moraju da prolaze.

## Verzije

- Ovaj repo ima svoju SemVer verziju u `package.json`, nezavisnu od weba, počev od `0.1.0`. Pravila su u `AGENTS.md`.
- Footer i „O programu" prikazuju obe: verziju ljuske i verziju web jezgra (`web/package.json`).
- Pomeranje submodula nasleđuje nivo promene weba (web patch → ovde patch, web minor → ovde minor).

## Pakovanje i izdanja

- **electron-builder**. Windows: NSIS instalacija (po korisniku, bez administratorskih prava) i portable `.exe`,
  x64. Linux: AppImage, x64.
- Asocijacije fajlova (`fileAssociations`) za `.tab`, `.csv`, `.ods`, `.xlsx`, bez preuzimanja podrazumevanog programa
  za `.csv`/`.xlsx` (samo stavka u „Otvori pomoću").
- Ikonice se generišu iz postojećeg logoa web aplikacije (`.ico` za Windows, PNG skup za Linux).
- Electron je u `devDependencies`; u paket ulaze samo `web/dist` i izgrađeni `electron/` fajlovi (`asar`).
- CI: GitHub Actions, matrica `windows-latest` + `ubuntu-latest`, pokreće se na tag `v*`, gradi pakete i kači ih na
  GitHub Release. Submodul je privatan repo, pa checkout traži deploy ključ ili token sa pristupom repou `csv2tab`.

## Faze

Svaka faza je posebna grana iz `main`-a i poseban PR. Faza 1 je u web repou, ostale ovde.

- [x] **0. Kostur** (urađeno pri postavljanju): repo, submodul, plan, pravila.
- [ ] **1. Platform sloj u webu** (PR u `csv2tab`): `src/platform.ts` i ugovor mosta, bez promene ponašanja weba.
      *Gotovo kad:* web testovi i build prolaze, web radi kao pre, a sa lažnim `window.csv2tabDesktop` u konzoli
      izvoz ide kroz most.
- [ ] **2. Ljuska**: Electron, TypeScript, build skripte, `app://` protokol, bezbednosna podešavanja, pamćenje
      veličine i položaja prozora. *Gotovo kad:* `npm run dev` otvara prozor sa aplikacijom, Worker parsira CSV,
      tema i tabela kantova preživljavaju restart, a `npm run build` daje pokretljiv nespakovan build.
- [ ] **3. Desktop funkcije**: `saveFile`, `saveFiles` sa pitanjem pre prepisivanja, pamćenje poslednjeg foldera,
      meni i prečice, jedna instanca, otvaranje fajlova iz argumenata i druge instance. *Gotovo kad:* fixture iz
      `web/tests/fixtures/` izvezen kroz aplikaciju je bajt-identičan referentnom `.tab` fajlu.
- [ ] **4. Pakovanje**: electron-builder, ikonice, asocijacije fajlova. *Gotovo kad:* AppImage radi na Fedori, a
      NSIS instalacija i portable `.exe` rade na čistom Windows 10/11 (instalacija, „Otvori pomoću", deinstalacija).
- [ ] **5. CI i izdanja**: GitHub Actions na tag, paketi na Release, smoke test u CI-u.
- [ ] **6. Obaveštenje o novoj verziji** (zavisi od odluke ispod).

## Testiranje

- Logiku pokrivaju vitest testovi u `web/tests`. Ovde se ne dupliraju.
- Ljuska dobija smoke test (Playwright `_electron`): pokreni aplikaciju, učitaj fixture, izvezi u privremeni folder,
  uporedi bajtove sa referentnim `.tab`. Dijalozi se u testu zaobilaze promenljivom okruženja koja zadaje putanju.
- Ručna provera na Windowsu pre svakog izdanja: instalacija, otvaranje fajla sa dijakritikom u imenu i putanji,
  izvoz u folder sa postojećim fajlovima.

## Otvorene odluke (odlučuje korisnik)

- **Potpisivanje za Windows.** Bez sertifikata SmartScreen pri prvoj instalaciji prikazuje „Unknown publisher".
  Pretpostavka dok se ne odluči drugačije: bez potpisa.
- **Ažuriranje.** Repo je privatan, pa `electron-updater` ne može da čita GitHub Releases bez tokena.
  Pretpostavka: bez automatskog ažuriranja; faza 6 samo proverava javni JSON sa poslednjom verzijom i nudi link.
  Gde stoji taj JSON i instalacije (javni repo samo za izdanja, Vercel, nešto treće) nije odlučeno.
- **Linux paketi.** Pretpostavka: samo AppImage. `.rpm` na zahtev.
