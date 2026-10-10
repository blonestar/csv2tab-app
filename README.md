# csv2tab-app

Desktop aplikacija (Electron, Windows i Linux) koja pretvara CSV / ODS / XLSX krojne liste u binarni WT Input `.tab`
i čuva ih kao poslove u lokalnoj bazi. Jezgro konverzije deli sa web aplikacijom
[csv2tab](https://github.com/blonestar/csv2tab), a interfejs i baza su njeni.

Aplikacija uvozi i pregleda fajlove, čuva poslove i izmene, izvozi u WT folder i pamti izbore materijala i kolona.
Podešavanja imaju pravila kantovanja, temu i rezervnu kopiju sa vraćanjem. Plan i otvorene stavke su u `PROJECT.md`.
Lokalno provereno na Linuxu; CI proverava aplikaciju i bazu i na Windowsu. Ručna proba na Windowsu 10/11 ostaje otvorena.

## Postavljanje

```sh
git submodule update --init
npm ci
npm run web:install   # zavisnosti web aplikacije
npm run web:build     # provera da se web deo gradi
npm run dev

# Izgrađena aplikacija i provere
npm run build         # uključuje typecheck
npm test
DISPLAY=:0 env -u ELECTRON_RUN_AS_NODE npm run test:smoke  # Linux sa ekranom
env -u ELECTRON_RUN_AS_NODE npm start
```

Potreban je Node 24.

Linux smoke i provera paketa koriste X11 na zadatom `DISPLAY`-u, jer Wayland ograničava programski fokus i položaj prozora.

## Paketi

```sh
npm run build:linux   # AppImage, Linux x64
npm run build:win     # NSIS po korisniku i portable, Windows x64
npm run pack          # raspakovan paket za trenutni sistem
npm run test:package -- "release/csv2tab-app-0.8.1-linux-x86_64.AppImage"
```

Paketi su u `release/`. AppImage je proveren na Fedori (potreban je FUSE 2); Windows instalacija, nadogradnja,
portable omotač i deinstalacija još čekaju ručnu proveru. Raspakovana Windows aplikacija prolazi proveru paketa u CI-u.
Portable koristi istu lokalnu bazu kao instalirana aplikacija.
Ikonice su izvedene iz postojećeg web logoa i priložene u repou; ponovno generisanje (`npm run icons`) traži ImageMagick.

GitHub Actions proverava PR-ove i `main` na Linuxu i Windowsu, a paketi i izveštaji su među artefaktima provere.
Tag `v<verzija iz package.json>` pokreće izdanje sa AppImage, NSIS i portable paketom na GitHub Release, tek kada
obe provere prođu. Tag se pravi posle merge-a u `main`, na zahtev korisnika. Oba repoa su javna; submodul se
preuzima preko HTTPS-a bez dodatnih CI tajni. Paketi su bez potpisa i automatsko ažuriranje nije uvedeno.
