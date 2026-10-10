-- Poslovi: uvezena krojna lista (izvorni bajtovi + stanje), njeni konačni zapisi i izvozi.
-- Vremena su milisekunde od epohe (UTC). Izvorni bajtovi se posle upisa ne menjaju.

CREATE TABLE jobs (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  source_name    TEXT NOT NULL,
  source_kind    TEXT NOT NULL CHECK (source_kind IN ('csv', 'ods', 'xlsx', 'tab')),
  source_size    INTEGER NOT NULL,
  source_sha256  TEXT NOT NULL,
  -- putanja samo kad je fajl uvezen kroz dijalog (prevučen fajl je nema); renderer je nikad ne vidi
  source_path    TEXT,
  -- JobState kao JSON; proverava ga parseJobState pri upisu i pri čitanju
  state          TEXT NOT NULL,
  part_count     INTEGER NOT NULL DEFAULT 0,
  -- trenutni izlazni fajlovi posla: JSON [{material, name, sha256, count}], upisuje se pri svakom čuvanju
  outputs        TEXT NOT NULL DEFAULT '[]',
  -- 'never' = nikad izvezen, 'current' = izvezen i nepromenjen, 'changed' = menjan posle izvoza
  export_status  TEXT NOT NULL DEFAULT 'never' CHECK (export_status IN ('never', 'current', 'changed')),
  last_export_at INTEGER,
  -- sklopljen tekst za pretragu (ime, napomena, fajl, materijali, nazivi delova, datum), bez dijakritika, malim slovima
  search         TEXT NOT NULL DEFAULT '',
  source_bytes   BLOB NOT NULL
) STRICT;
CREATE INDEX jobs_created ON jobs (created_at DESC, id DESC);
CREATE INDEX jobs_source_sha ON jobs (source_sha256);

-- Konačni zapisi posla (posle ručnih izmena); zamenjuju se u istoj transakciji kad i state.
-- wt_code je šifra WT materijala ('' = nijedan), ne materials.id: ugrađeni red može da nestane iz kataloga.
CREATE TABLE job_parts (
  job_id   INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  material TEXT NOT NULL,
  wt_code  TEXT NOT NULL,
  dim1     INTEGER NOT NULL,
  dim2     INTEGER NOT NULL,
  edge1    INTEGER NOT NULL,
  edge2    INTEGER NOT NULL,
  grain    INTEGER NOT NULL,
  qty      INTEGER NOT NULL,
  name     TEXT NOT NULL,
  PRIMARY KEY (job_id, position)
) STRICT, WITHOUT ROWID;

-- Svaki upis .tab fajla u WT folder (i slučaj kad je u folderu već bio isti fajl). Bajtovi su tačno ono što je upisano.
CREATE TABLE exports (
  id           INTEGER PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  material     TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  folder       TEXT NOT NULL,
  exported_at  INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  result       TEXT NOT NULL CHECK (result IN ('written', 'identical')),
  bytes        BLOB NOT NULL
) STRICT;
CREATE INDEX exports_job ON exports (job_id, id);
