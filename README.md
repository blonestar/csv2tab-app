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
