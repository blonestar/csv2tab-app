# csv2tab-app

Desktop verzija (Electron, Windows i Linux) web aplikacije [csv2tab](https://github.com/blonestar/csv2tab), koja
pretvara CSV / ODS / XLSX krojne liste u binarni WT Input `.tab`.

Repo je u fazi kostura: sadrži plan (`PROJECT.md`), pravila za agente (`AGENTS.md`) i web aplikaciju kao submodul u
`web/`. Electron ljuska još nije napisana.

## Postavljanje

```sh
git submodule update --init
npm run web:install   # zavisnosti web aplikacije
npm run web:build     # web/dist, koji će ljuska pakovati
```

Potreban je Node 20+.
