// Sačuvani položaj glavnog prozora se prilagođava sadašnjim ekranima (isključen monitor ne sme da sakrije prozor).
export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowState extends Bounds { maximized: boolean }

export function restoreWindowState(raw: string | undefined, areas: readonly Bounds[]): WindowState | null {
  if (!raw || !areas.length) return null;
  let value: WindowState;
  try { value = JSON.parse(raw) as WindowState; } catch { return null; }
  if (!value || typeof value !== 'object' || typeof value.maximized !== 'boolean' ||
      !['x', 'y', 'width', 'height'].every((k) => Number.isSafeInteger(value[k as keyof Bounds])) || value.width <= 0 || value.height <= 0) return null;
  const area = areas.find((a) => value.x < a.x + a.width && value.x + value.width > a.x && value.y < a.y + a.height && value.y + value.height > a.y) ?? areas[0];
  const width = Math.min(area.width, Math.max(760, value.width));
  const height = Math.min(area.height, Math.max(480, value.height));
  return {
    x: Math.max(area.x, Math.min(value.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(value.y, area.y + area.height - height)),
    width, height, maximized: value.maximized,
  };
}
