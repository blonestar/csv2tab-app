// Pretvara izvedeni posao u ono što se čuva u bazi: konačni zapisi i izlazni .tab fajlovi (glavni proces sam
// računa njihove heševe). Izvor istine ostaje JobState; ovo je izvedena kopija za pretragu i stanje izvoza.
import type { JobState } from '../../shared/job';
import type { JobSave, SavedOutput, SavedPart } from '../../shared/jobs';
import { exportFiles, type DerivedJob } from './derive';

export function buildSave(state: JobState, d: DerivedJob): JobSave {
  const wt = new Map(d.materials.map((m) => [m.source, m.wt?.code ?? '']));
  const parts: SavedPart[] = d.records.map(({ rec }) => ({
    material: rec.material,
    wt: wt.get(rec.material) ?? '',
    dim1: rec.dim1,
    dim2: rec.dim2,
    edge1: rec.edge1,
    edge2: rec.edge2,
    grain: rec.grain,
    qty: rec.qty,
    name: rec.name,
  }));
  let outputs: SavedOutput[] = [];
  try {
    outputs = exportFiles(d).map((f) => ({ material: f.material, name: f.name, count: f.count, bytes: f.bytes }));
  } catch {
    // npr. više od 65535 zapisa u jednom materijalu: nema izlaznih fajlova, izvoz je i tako nemoguć
  }
  return { state, parts, outputs };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
