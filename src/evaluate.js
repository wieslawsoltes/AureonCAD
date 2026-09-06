import { M } from './math.js';
import { Solid, shapeFor, tessellate } from './kernel.js';
/** Prefix caches retain immutable solids; invalidated from the first changed feature. */
export class Evaluator {
    constructor() { this.cache = new Map(); }
    evaluate(doc) {
        const byId = new Map(doc.bodies.map(b => [b.id, b])), done = new Map(), visiting = new Set();
        const build = b => { if (done.has(b.id))
            return done.get(b.id); if (visiting.has(b.id))
            throw Error('Circular Boolean body dependency'); visiting.add(b.id); let solid = new Solid(), prefix = '', lastShape = null; const old = this.cache.get(b.id) || [], entries = []; const errors = []; for (let i = 0; i < b.features.length; i++) {
            const f = b.features[i];
            let key = JSON.stringify(f), tool = null;
            if (f.type === 'boolean' && !f.suppressed) {
                const other = byId.get(f.params.tool);
                if (!other)
                    throw Error(`Boolean tool body was deleted: ${f.name}`);
                const result = build(other);
                tool = result.solid.transform(M.multiply(M.inverse(M.compose(b.position, b.rotation)), M.compose(other.position, other.rotation)));
                key += result.key + JSON.stringify([b.position, b.rotation, other.position, other.rotation]);
            }
            prefix += key;
            if (old[i]?.key === prefix) {
                solid = old[i].solid;
                lastShape = old[i].lastShape;
                entries.push(old[i]);
                continue;
            }
            try {
                if (!f.suppressed) {
                    if (f.type === 'boolean') {
                        solid = f.params.operation === 'subtract' ? solid.subtract(tool) : f.params.operation === 'intersect' ? solid.intersect(tool) : solid.union(tool);
                    }
                    else if (f.type === 'pattern') {
                        const source = b.features.find(g => g.id === f.params.source);
                        if (!source)
                            throw Error('Pattern source not found');
                        const shape = shapeFor(source), count = Math.max(2, Math.min(64, Math.round(f.params.count || 3)));
                        for (let n = 1; n < count; n++) {
                            const m = f.params.circular ? M.rotation(2, n * (f.params.angle || 360) / count * Math.PI / 180) : M.translation((f.params.dx || 0) * n, (f.params.dy || 0) * n, (f.params.dz || 0) * n);
                            const repeated = shape.transform(m);
                            solid = ['hole', 'pocket', 'groove'].includes(source.type) ? solid.subtract(repeated) : solid.union(repeated);
                        }
                    }
                    else {
                        const s = shapeFor(f);
                        lastShape = s;
                        if (['hole', 'pocket', 'groove'].includes(f.type) || f.op === 'subtract')
                            solid = solid.subtract(s);
                        else if (f.op === 'intersect')
                            solid = solid.intersect(s);
                        else
                            solid = solid.union(s);
                    }
                }
                entries.push({ key: prefix, solid, lastShape });
            }
            catch (error) {
                throw Error(`${b.name} → ${f.name}: ${error.message}`);
            }
        } this.cache.set(b.id, entries); visiting.delete(b.id); const result = { solid, key: prefix, errors }; done.set(b.id, result); return result; };
        const meshes = [];
        for (const b of doc.bodies) {
            const result = build(b);
            const mesh = tessellate(result.solid);
            meshes.push({ id: b.id, signature: result.key, ...mesh });
        }
        for (const id of this.cache.keys())
            if (!byId.has(id))
                this.cache.delete(id);
        return meshes;
    }
}
