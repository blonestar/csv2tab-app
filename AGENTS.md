# Uputstva za agente

Plan aplikacije, arhitektura i faze su u `PROJECT.md`. Pročitaj ga pre rada i označi fazu kad je završiš.

## Dva repoa

- Ovaj repo je **cela desktop aplikacija**: interfejs, baza, glavni proces i pakovanje. **Jezgro konverzije**
  (`web/src/lib`, katalog, fixture fajlovi) živi u repou `csv2tab`, koji je ovde git submodul u `web/`. Jezgro se
  uvozi preko aliasa `@core`; ne kopiraj kod iz `web/` i ne menjaj ga u prolazu. Web UI se ovde ne koristi.
- Izmena u `web/` je izmena u drugom repou: posebna grana i PR u `csv2tab`, po pravilima iz `web/AGENTS.md`
  (grane, verzija, merge). Tek kad je tamo mergeovano, ovde se pomera pokazivač submodula
  (`git -C web fetch && git -C web checkout origin/main`, pa commit).
- Posle kloniranja ili pravljenja worktree-a: `git submodule update --init`.
- Više sesija može da radi nad istim checkoutom. Ne prebacuj granu preko tuđih necommitovanih izmena; radi u
  posebnom worktree-u.

## Grane

- Svaka nova grana se pravi **iz `main`-a** (`git switch -c <grana> main`), nikad iz trenutne feature grane,
  čak i ako prethodna grana još nije spojena.

## Verzija (SemVer)

Verzija aplikacije je `version` u `package.json`, nezavisna od verzije weba (`web/package.json`). Agent je **sam podiže**
kad promena to zahteva. Format je `MAJOR.MINOR.PATCH`.

| Deo | Kada se podiže | Primeri |
| --- | --- | --- |
| **MAJOR** | Nekompatibilna promena za korisnika | baza ili podešavanja koji se više ne čitaju, uklonjena funkcija, promenjen `.tab` izlaz |
| **MINOR** | Nova funkcija | nova stavka menija, nov tip paketa, asocijacija fajla, nova tabela u bazi, minor jezgra u submodulu |
| **PATCH** | Ispravka ili sitnica | greška u dijalogu, ikonica, patch jezgra u submodulu |

- **Dok je verzija `0.y.z`**, nekompatibilna promena podiže **MINOR**. Prelazak na `1.0.0` je odluka korisnika.
- **Jedno podizanje po grani/PR-u**, u posebnom commitu na kraju grane (npr. `Verzija 0.2.0`). Proveri
  `git diff main -- package.json` pre podizanja.
- **Ne podiže se** za testove, dokumentaciju, refaktorisanje bez promene ponašanja, dev zavisnosti i CI, ni za
  pomeranje submodula koje dira samo web UI.
- Promena šeme baze ide uvek kao **nova migracija**; postojeće migracije se ne menjaju posle merge-a.
- Komanda: `npm version <major|minor|patch> --no-git-tag-version`.
- Git tag (`v0.2.0`) se pravi posle merge-a u `main` i samo na zahtev korisnika. Tag pokreće izdanje.
- U završnoj poruci navedi staru i novu verziju i zašto je izabran taj nivo.

## Pull request i merge

Repo je `blonestar/csv2tab-app` (javan, kao i submodul `blonestar/csv2tab`). Posle otvaranja PR-a agent ga
**sam mergeuje** u `main` kad provere prođu. GitHub Actions proverava Linux i Windows, uključujući pakovanje;
agent pre merge-a pokreće i lokalnu proveru iz odeljka „Provera pre predaje" i navodi stvarne rezultate u PR-u.

1. Otvori PR, pa `gh pr checks <broj> --watch --fail-fast` (ako provere postoje).
2. Ako su provere prošle: `gh pr merge <broj> --merge --delete-branch`, pa lokalno `git switch main && git pull`.
3. Mehanički konflikt (verzija u `package.json`/`package-lock.json`, pokazivač submodula) agent rešava sam: spoji
   `origin/main` u granu, ponovo podigne verziju, proveri build i testove, pushuje i vrati se na korak 1.
4. Ako provera padne ili konflikt traži odluku o ponašanju: **ne mergeuje**, već javi korisniku šta je palo.

- Merge commit (`--merge`), ne squash/rebase.
- Ne mergeuje se ako korisnik kaže da PR treba da sačeka ili ako je PR draft.

## Provera pre predaje

- Jezgro: `npm --prefix web test` ako je submodul pomeren.
- Aplikacija: `npm run typecheck`, `npm run build` (već pokreće typecheck), `npm test` (vitest: jezgro preko `@core`,
  `app://` putanje, baza), `npm run test:smoke` (pokreće **izgrađenu** aplikaciju kroz Playwright, treba prozor/ekran;
  proverava i da podešavanje preživi restart). Posle promene u `migrations/` ili `src/main/db/` obavezno oba.
  `npm run web:build` i dalje mora da prolazi.
- Posle `npm ci` Electron se preuzima pri prvom pokretanju; ako ne uspe: `node node_modules/electron/install.js`.
- Electron pokrenut iz alata koji je i sam Electron aplikacija može da nasledi `ELECTRON_RUN_AS_NODE=1` i tada se
  ponaša kao običan Node. Pokreći ga sa `env -u ELECTRON_RUN_AS_NODE`.
- Ne tvrdi da nešto radi na Windowsu ako je provereno samo na Linuxu. Napiši šta je gde provereno.
