// Stanje ažuriranja: glavni proces ga šalje rendereru pri svakoj promeni. Sadrži samo nazive, nikad putanje.

/** Kako aplikacija može da se ažurira: iz nje same (nsis, appimage), kao portable fajl ili nikako. */
export type UpdateVariant = 'nsis' | 'appimage' | 'portable' | 'unsupported';

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' } // nema novije verzije
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number } // 0–100, ceo broj
  | { kind: 'downloaded'; version: string; fileName?: string } // fileName samo za portable
  | { kind: 'error'; message: string };

export interface UpdateState {
  variant: UpdateVariant;
  /** Verzija koja radi (`version` u package.json). */
  currentVersion: string;
  /** Vreme poslednje uspešne provere (ms) ili null. */
  lastCheck: number | null;
  phase: UpdatePhase;
}
