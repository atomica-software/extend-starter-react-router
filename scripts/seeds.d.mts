export function seedFiles(folder: string): string[];
export function applySeeds(
  sql: unknown,
  folder: string,
  opts?: { log?: (msg: string) => void; warn?: (msg: string) => void },
): Promise<{ applied: string[]; failed: { name: string; message: string }[] }>;
