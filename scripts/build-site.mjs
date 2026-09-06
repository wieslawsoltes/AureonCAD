import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('_site/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Publish only the application and user-facing examples/documentation.
for (const path of ['index.html', 'styles.css', 'src', 'dist', 'examples', 'LICENSE', 'README.md']) {
  await cp(new URL(path, root), new URL(path, output), { recursive: true });
}
await mkdir(new URL('docs/', output), { recursive: true });
for (const path of ['SOURCES.md', 'VERIFICATION.md', 'DEPLOYMENT.md', 'workbench.png', 'sketcher.png', 'exploded.png', 'browser-test-results.json', 'unit-test-results.txt']) {
  await cp(new URL(`docs/${path}`, root), new URL(`docs/${path}`, output));
}
// Suppress an unrelated origin-root favicon request on project Pages URLs.
const icon = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%23132540%22/%3E%3Cpath d=%22M7 25 16 7 25 25M11 19h10%22 fill=%22none%22 stroke=%22%233fa7ee%22 stroke-width=%223%22/%3E%3C/svg%3E">';
for (const path of ['index.html', 'dist/AureonCAD.html']) {
  const file = new URL(path, output);
  await writeFile(file, (await readFile(file, 'utf8')).replace('</head>', `${icon}\n</head>`));
}
await writeFile(new URL('.nojekyll', output), '');
await writeFile(new URL('version.json', output), JSON.stringify({
  application: 'Aureon CAD',
  version: JSON.parse(await readFile(new URL('package.json', root), 'utf8')).version,
  commit: process.env.GITHUB_SHA || 'local',
  repository: 'wieslawsoltes/AureonCAD'
}, null, 2) + '\n');
console.log('GitHub Pages site prepared in _site/.');
