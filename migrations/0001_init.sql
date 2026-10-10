-- Prva šema: podešavanja, katalog i meta podaci. Poslovi, izvozi i mapiranja dolaze kao nove migracije.

-- Podešavanja: ključ je iz zatvorenog skupa (src/shared/settings.ts), vrednost je JSON.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

-- Unutrašnji podaci aplikacije (npr. heš ugrađenog kataloga); renderer ih ne vidi.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

-- Katalog materijala. source: 'builtin' = iz wt-catalog.json (osvežava se), 'user' = korisnikov (ne dira se).
-- Šifra je jedinstvena među ugrađenim redovima; id ostaje isti pri osvežavanju, pa ga kasnije tabele mogu pominjati.
CREATE TABLE materials (
  id        INTEGER PRIMARY KEY,
  source    TEXT NOT NULL CHECK (source IN ('builtin', 'user')),
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  sheet_w   REAL NOT NULL,
  sheet_h   REAL NOT NULL,
  thickness REAL NOT NULL,
  grain     INTEGER NOT NULL CHECK (grain IN (0, 1)),
  position  INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE UNIQUE INDEX materials_builtin_code ON materials (code) WHERE source = 'builtin';

CREATE TABLE edge_bands (
  id       INTEGER PRIMARY KEY,
  source   TEXT NOT NULL CHECK (source IN ('builtin', 'user')),
  code     TEXT NOT NULL,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE UNIQUE INDEX edge_bands_builtin_code ON edge_bands (code) WHERE source = 'builtin';
