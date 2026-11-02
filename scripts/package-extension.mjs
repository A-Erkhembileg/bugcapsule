import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { zipSync } from 'fflate';

// Run after `pnpm build`. Only the unpacked extension goes into the ZIP.
const extension = resolve('dist');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
const files = {};
const archiveDate = new Date(1980, 0, 1);

async function addDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectory(path);
    } else if (entry.isFile()) {
      const archivePath = relative(extension, path).split(sep).join('/');
      files[archivePath] = [await readFile(path), { mtime: archiveDate }];
    }
  }
}

await addDirectory(extension);
await mkdir('release', { recursive: true });
const output = join('release', `bugcapsule-${manifest.version}.zip`);
await writeFile(output, zipSync(files, { level: 9 }));
console.log(`Packaged ${Object.keys(files).length} extension files in ${output}`);
