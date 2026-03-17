import fs from 'fs/promises';

export async function readNewText(filePath: string, pos: number): Promise<{ text: string; newPos: number }> {
  const st = await fs.stat(filePath);
  const size = st.size;
  const safePos = pos > size ? 0 : pos;
  if (size <= safePos) return { text: '', newPos: safePos };

  const fh = await fs.open(filePath, 'r');
  try {
    const len = size - safePos;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, safePos);
    return { text: buf.toString('utf8'), newPos: size };
  } finally {
    await fh.close();
  }
}
