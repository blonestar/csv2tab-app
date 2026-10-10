# csv2tab-app

Desktop aplikacija (Electron, Windows i Linux) koja pretvara CSV / ODS / XLSX krojne liste u binarni WT Input `.tab`
i čuva ih kao poslove u lokalnoj bazi. Jezgro konverzije deli sa web aplikacijom
[csv2tab](https://github.com/blonestar/csv2tab), a interfejs i baza su njeni.

Repo je u fazi kostura: sadrži plan (`PROJECT.md`), pravila za agente (`AGENTS.md`) i web repo kao submodul u
`web/`. Koda aplikacije još nema.

## Postavljanje

```sh
git submodule update --init
npm run web:install   # zavisnosti web aplikacije
npm run web:build     # provera da se web deo gradi
```

Potreban je Node 24.
