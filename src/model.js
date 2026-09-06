export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const MATERIALS = {
    aluminum: { name: 'Aluminum · 6061-T6', color: '#b7c5ce', metal: .78, rough: .28, density: .0027 },
    titanium: { name: 'Titanium · Ti-6Al-4V', color: '#8896aa', metal: .85, rough: .25, density: .00443 },
    steel: { name: 'Steel · AISI 304', color: '#c2ccd5', metal: .9, rough: .2, density: .008 },
    brass: { name: 'Bronze · CuSn12', color: '#cda05b', metal: .82, rough: .24, density: .0088 },
    dark: { name: 'Steel · Black oxide', color: '#374457', metal: .78, rough: .32, density: .00785 },
    blue: { name: 'Aluminum · Anodized blue', color: '#417b9e', metal: .7, rough: .3, density: .0027 },
    polymer: { name: 'Polymer · POM', color: '#e7e4db', metal: .03, rough: .55, density: .00141 }
};
export function feature(type, name, params, op) { return { id: uid(), type, name, params, suppressed: false, ...(op ? { op } : {}) }; }
export function body(name, features, material = 'aluminum', position = [0, 0, 0], rotation = [0, 0, 0]) { return { id: uid(), name, features, material, position, rotation, visible: true }; }
export function emptyDocument() { return { format: 'aureon-cad', version: 1, id: uid(), name: 'Untitled product', units: 'mm', bodies: [], created: new Date().toISOString() }; }
export function demoDocument() {
    const doc = emptyDocument();
    doc.name = 'Precision bearing support';
    const base = body('Mounting plate', [
        feature('pad', 'Pad.1 · Base plate', { shape: 'rectangle', width: 160, depth: 96, corner: 10, height: 12, x: 0, y: 0, z: 0 }),
        ...[-60, 60].flatMap(x => [-30, 30].flatMap(y => [feature('hole', `Hole · Ø10 / ${x}, ${y}`, { radius: 5, height: 14, x, y, z: -1, axis: 'Z', segments: 40 }), feature('hole', 'Counterbore · Ø16', { radius: 8, height: 5, x, y, z: 8, axis: 'Z', segments: 40 })]))
    ], 'titanium');
    const profile = [[-46, 0], [46, 0], [46, 42], ...Array.from({ length: 25 }, (_, i) => { const a = (i + 1) / 25 * Math.PI; return [46 * Math.cos(a), 42 + 46 * Math.sin(a)]; })];
    const carrier = body('Bearing carrier', [
        feature('pad', 'Pad.1 · Carrier profile', { shape: 'polygon', points: profile, height: 38, rotation: [90, 0, 0], x: 0, y: 19, z: 12 }),
        feature('hole', 'Hole.1 · Bearing seat Ø56', { radius: 28, height: 42, axis: 'Y', x: 0, y: -21, z: 54, segments: 64 }),
        ...[-1, 1].flatMap(s => [-1, 1].map(t => feature('hole', 'Hole · Flange fastener Ø5', { radius: 2.5, height: 42, axis: 'Y', x: s * 26, y: -21, z: 54 + t * 26, segments: 24 })))
    ], 'aluminum');
    const bushing = body('Bronze sleeve bearing', [feature('shaft', 'Shaft.1 · Sleeve', { radius: 28, innerRadius: 20.5, height: 40, angle: 360, segments: 64 })], 'brass', [0, 20, 54], [90, 0, 0]);
    const shaft = body('Drive shaft', [feature('shaft', 'Shaft.1 · Stepped spindle', { profile: [[0, 0], [16, 0], [16, 14], [20, 14], [20, 88], [17, 88], [17, 115], [0, 115]], radius: 20, innerRadius: 0, height: 115, angle: 360, segments: 64 }), feature('pocket', 'Pocket.1 · Keyway', { shape: 'rectangle', width: 7, depth: 30, height: 8, x: 0, y: 18, z: 44 })], 'steel', [0, -62, 54], [-90, 0, 0]);
    const front = body('Front retaining flange', [feature('shaft', 'Shaft.1 · Flange', { radius: 35, innerRadius: 21, height: 5, angle: 360, segments: 64 })], 'brass', [0, -19.3, 54], [90, 0, 0]);
    const back = body('Rear retaining flange', [feature('shaft', 'Shaft.1 · Flange', { radius: 35, innerRadius: 21, height: 5, angle: 360, segments: 64 })], 'dark', [0, 24.3, 54], [90, 0, 0]);
    doc.bodies.push(base, carrier, bushing, shaft, front, back);
    for (const x of [-26, 26])
        for (const z of [28, 80])
            doc.bodies.push(body(`Socket screw M5 · ${doc.bodies.length - 5}`, [feature('cylinder', 'Pad.1 · Socket head', { radius: 4.5, height: 4, segments: 32 }), feature('hole', 'Pocket.1 · Hex socket', { radius: 2.1, height: 2.6, z: 1.6, segments: 6, axis: 'Z' })], 'steel', [x, -19.05, z], [90, 0, 0]));
    return doc;
}
const TYPES = new Set(['pad', 'pocket', 'hole', 'box', 'cylinder', 'sphere', 'shaft', 'groove', 'pattern', 'boolean', 'mesh']);
export function validateDocument(input) { if (!input || input.format !== 'aureon-cad' || input.version !== 1 || !Array.isArray(input.bodies))
    throw Error('Not a supported Aureon CAD v1 project'); if (input.bodies.length > 250)
    throw Error('Project exceeds 250 bodies'); if (typeof input.name !== 'string')
    throw Error('Project name is missing'); const doc = structuredClone(input), ids = new Set(); let featureCount = 0; const inspect = (v, depth = 0) => { if (depth > 30)
    throw Error('Project nesting is too deep'); if (typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 1e7))
    throw Error('Invalid or out-of-range coordinate'); if (Array.isArray(v)) {
    if (v.length > 1000000)
        throw Error('Oversized geometry array');
    v.forEach(x => inspect(x, depth + 1));
}
else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(k))
            throw Error('Invalid object key');
        inspect(x, depth + 1);
    }
} }; inspect(doc); for (const b of doc.bodies) {
    if (typeof b.id !== 'string' || ids.has(b.id))
        throw Error('Duplicate or invalid body identifier');
    ids.add(b.id);
    if (!Array.isArray(b.features) || typeof b.name !== 'string')
        throw Error('Invalid body');
    for (const key of ['position', 'rotation'])
        if (!Array.isArray(b[key]) || b[key].length !== 3 || b[key].some(x => typeof x !== 'number'))
            throw Error('Invalid body transform');
    if (!MATERIALS[b.material])
        b.material = 'aluminum';
    for (const f of b.features) {
        if (!TYPES.has(f.type) || !f.params || typeof f.id !== 'string' || ids.has(f.id))
            throw Error('Unsupported or invalid feature');
        ids.add(f.id);
        const p = f.params;
        for (const k of ['width', 'depth', 'height', 'radius'])
            if (p[k] !== undefined && (typeof p[k] !== 'number' || p[k] <= 0 || p[k] > 100000))
                throw Error('Invalid feature dimension: ' + k);
        if (p.segments !== undefined && (!Number.isInteger(p.segments) || p.segments < 3 || p.segments > 256))
            throw Error('Segment count must be 3–256');
        if (p.rings !== undefined && (!Number.isInteger(p.rings) || p.rings < 2 || p.rings > 128))
            throw Error('Sphere rings must be 2–128');
        for (const k of ['points', 'profile'])
            if (p[k] !== undefined && (!Array.isArray(p[k]) || p[k].length > 512 || p[k].length < 3 || p[k].some(v => !Array.isArray(v) || v.length !== 2 || v.some(n => typeof n !== 'number'))))
                throw Error('Invalid closed profile');
        if (f.type === 'pattern' && (!Number.isInteger(p.count) || p.count < 2 || p.count > 64))
            throw Error('Pattern instances must be 2–64');
        if (f.type === 'boolean' && (!['union', 'subtract', 'intersect'].includes(p.operation) || typeof p.tool !== 'string'))
            throw Error('Invalid Boolean definition');
        if (f.type === 'mesh' && (!Array.isArray(p.polygons) || p.polygons.length > 200000 || p.polygons.some(t => !Array.isArray(t) || t.length !== 3 || t.some(v => !Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number')))))
            throw Error('Invalid imported mesh');
        if (++featureCount > 2000)
            throw Error('Project exceeds 2,000 features');
    }
} return doc; }
export class History extends EventTarget {
    constructor(doc) { super(); this.doc = doc; this.undoStack = []; this.redoStack = []; this.revision = 0; }
    commit(label, mutate) { const before = JSON.stringify(this.doc), next = structuredClone(this.doc); mutate(next); const after = JSON.stringify(next); if (before === after)
        return false; validateDocument(next); this.undoStack.push({ label, before, after }); while (this.undoStack.length > 1 && (this.undoStack.length > 70 || this.undoStack.reduce((n, e) => n + e.before.length + e.after.length, 0) > 32 * 1024 * 1024))
        this.undoStack.shift(); this.redoStack = []; this.doc = next; this.changed(label); return true; }
    changed(label) { this.revision++; this.dispatchEvent(new CustomEvent('change', { detail: { label, revision: this.revision } })); }
    undo() { const e = this.undoStack.pop(); if (!e)
        return; this.redoStack.push(e); this.doc = JSON.parse(e.before); this.changed(`Undo ${e.label}`); }
    redo() { const e = this.redoStack.pop(); if (!e)
        return; this.undoStack.push(e); this.doc = JSON.parse(e.after); this.changed(`Redo ${e.label}`); }
    replace(doc) { this.doc = validateDocument(doc); this.undoStack = []; this.redoStack = []; this.changed('Open project'); }
}
