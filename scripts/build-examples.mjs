import { readFile, writeFile } from 'node:fs/promises';
import { Evaluator } from '../src/evaluate.js';
import { worldTriangles, binarySTL, drawingSVG, bomCSV } from '../src/io.js';

// Regenerate reference geometry from the editable document, not cached meshes.
const base = new URL('../examples/Precision-bearing-support', import.meta.url);
const doc = JSON.parse(await readFile(`${base.pathname}.aureon.json`, 'utf8'));
const meshes = new Map(new Evaluator().evaluate(doc).map(mesh => [mesh.id, mesh]));
const triangles = worldTriangles(doc, meshes);
await writeFile(`${base.pathname}.stl`, new Uint8Array(binarySTL(triangles)));
await writeFile(`${base.pathname}-projections.svg`, drawingSVG(doc, meshes));
await writeFile(`${base.pathname}-BOM.csv`, bomCSV(doc, meshes));
console.log(`Generated ${triangles.length} triangles across ${meshes.size} bodies.`);
