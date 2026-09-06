import { Evaluator } from './evaluate.js';
const evaluator = new Evaluator();
self.onmessage = ({ data }) => { const start = performance.now(); try {
    const meshes = evaluator.evaluate(data.doc);
    self.postMessage({ id: data.id, meshes, elapsed: performance.now() - start }, meshes.flatMap(m => [m.vertices.buffer, m.edges.buffer]));
}
catch (error) {
    self.postMessage({ id: data.id, error: error.message, elapsed: performance.now() - start });
} };
