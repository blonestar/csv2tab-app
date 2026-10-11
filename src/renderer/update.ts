// Stanje ažuriranja u rendereru: prvo stanje iz glavnog procesa, pa svaka promena. Deli ga kartica Ažuriranja i
// obaveštenje u bočnoj traci. Renderer ne pravi mrežne zahteve; sve ide kroz window.api.update.
import { useEffect, useState } from 'react';
import type { UpdateState } from '../shared/update';

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let alive = true;
    // događaj stigao pre odgovora na prvi poziv je noviji od tog odgovora, pa ga odgovor ne sme da prepiše
    let changed = false;
    const off = window.api.update.onState((next) => {
      changed = true;
      if (alive) setState(next);
    });
    window.api.update.state().then(
      (next) => {
        if (alive && !changed) setState(next);
      },
      () => undefined,
    );
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

/** Verzija koja čeka (dostupna ili preuzeta); inače null. */
export function waitingVersion(state: UpdateState | null): string | null {
  const phase = state?.phase;
  return phase && (phase.kind === 'available' || phase.kind === 'downloaded') ? phase.version : null;
}
