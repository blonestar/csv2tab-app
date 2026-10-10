# csv2tab-app

Desktop aplikacija (Electron, Windows i Linux) koja pretvara CSV / ODS / XLSX krojne liste u binarni WT Input `.tab`
i čuva ih kao poslove u lokalnoj bazi. Jezgro konverzije deli sa web aplikacijom
[csv2tab](https://github.com/blonestar/csv2tab), a interfejs i baza su njeni.

Aplikacija uvozi i pregleda fajlove, čuva poslove i izmene, izvozi u WT folder i pamti izbore materijala i kolona.
Podešavanja imaju pravila kantovanja, temu i rezervnu kopiju sa vraćanjem. Plan i otvorene stavke su u `PROJECT.md`.
Provereno na Linuxu; Windows još čeka proveru.

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

## Paketi

```sh
npm run build:linux   # AppImage, Linux x64
npm run build:win     # NSIS po korisniku i portable, Windows x64
npm run pack          # raspakovan paket za trenutni sistem
npm run test:package -- "release/csv2tab-app-0.8.0-linux-x86_64.AppImage"
```

Paketi su u `release/`. AppImage je proveren na Fedori (potreban je FUSE 2); Windows instalacija, nadogradnja i
deinstalacija još čekaju ručnu proveru. Portable koristi istu lokalnu bazu kao instalirana aplikacija.
Ikonice su izvedene iz postojećeg web logoa i priložene u repou; ponovno generisanje (`npm run icons`) traži ImageMagick.
