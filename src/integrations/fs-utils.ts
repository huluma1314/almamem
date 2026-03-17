import fs from 'fs/promises';
import path from 'path';

export async function listLogFiles(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.endsWith('.log')) continue;
        out.push(path.join(dir, e.name));
      }
    } catch {
      // ignore missing dir
    }
  }
  out.sort();
  return out;
}
