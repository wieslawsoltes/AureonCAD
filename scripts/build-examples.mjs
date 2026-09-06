import { readFile, writeFile } from 'node:fs/promises';
import { Evaluator } from '../src/evaluate.js';
import { worldTriangles, binarySTL, drawingSVG, bomCSV } from '../src/io.js';

// Regenerate reference geometry from the editable document, not cached meshes.
const examples = new URL('../examples/', import.meta.url);
const file = suffix => new URL(`Precision-bearing-support${suffix}`, examples);
const doc = JSON.parse(await readFile(file('.aureon.json'), 'utf8'));
const meshes = new Map(new Evaluator().evaluate(doc).map(mesh => [mesh.id, mesh]));
const triangles = worldTriangles(doc, meshes);
await writeFile(file('.stl'), new Uint8Array(binarySTL(triangles)));
await writeFile(file('-projections.svg'), drawingSVG(doc, meshes));
await writeFile(file('-BOM.csv'), bomCSV(doc, meshes));
console.log(`Generated ${triangles.length} triangles across ${meshes.size} bodies.`);
