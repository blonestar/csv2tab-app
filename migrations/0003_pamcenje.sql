-- Pamćenje izbora: sledeći uvoz nudi ono što je prošli put izabrano. Pamćenje utiče samo na nove poslove
-- (izbori se pri pravljenju posla kopiraju u njegov JobState). Vremena su milisekunde od epohe (UTC).

-- Izbor po materijalu iz fajla. name je ključ: naziv sveden funkcijom memoryKey (NFC, bez razmaka na krajevima,
-- jedan razmak između reči, mala slova). Svako polje je zasebno: NULL = ništa nije zapamćeno za to polje.
CREATE TABLE material_map (
  name       TEXT PRIMARY KEY,
  -- naziv onako kako je poslednji put viđen u fajlu (za prikaz)
  label      TEXT NOT NULL,
  -- šifra WT materijala (ne materials.id: ugrađeni red može da nestane iz kataloga); '' = izričito „nijedan"
  wt_code    TEXT,
  -- šifra trake; '' = izričito bez trake
  band       TEXT,
  -- „Prati teksturu"
  grain      INTEGER CHECK (grain IN (0, 1)),
  updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- Mapiranje kolona po zaglavlju. signature: ćelije prvog reda svedene normHeader-om, spojene znakom U+001F,
-- bez praznih ćelija na kraju. Pamti se samo kad korisnik mapiranje promeni ručno.
CREATE TABLE column_maps (
  signature  TEXT PRIMARY KEY,
  -- JSON: ColumnMapping (indeks kolone po polju, -1 = nema)
  mapping    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
