// Sadržaj posebnog prozora za poređenje; podatke daje glavni proces na osnovu id-a iz adrese (#compare=<id>).
import { useEffect, useState } from 'react';
import type { ComparePayload } from '../../shared/api';
import { DiffTable } from '../components/DiffTable';

export function Compare({ id }: { id: string }) {
  const [data, setData] = useState<ComparePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.api.compare.get(id).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  return (
    <main className="compare-page" data-testid="compare-page">
      <h1>Poređenje</h1>
      {error && <p role="alert" className="banner error">{error}</p>}
      {data && <DiffTable a={data.a} b={data.b} aLabel={data.aName} bLabel={data.bName} />}
    </main>
  );
}
