/** Aureon CAD • double-precision geometry helpers; column-major GPU matrices. */
export const EPS = 1e-7;
export const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(...a),
    norm(a) { const l = Math.hypot(...a); return l > 1e-14 ? this.mul(a, 1 / l) : [0, 0, 1]; },
    lerp: (a, b, t) => a.map((v, i) => v + (b[i] - v) * t),
    min: (a, b) => a.map((v, i) => Math.min(v, b[i])), max: (a, b) => a.map((v, i) => Math.max(v, b[i]))
};
export const M = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    multiply(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
            for (let k = 0; k < 4; k++)
                o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; },
    translation(x, y, z) { const m = this.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
    rotation(axis, a) { const m = this.identity(), c = Math.cos(a), s = Math.sin(a); if (axis === 0) {
        m[5] = c;
        m[6] = s;
        m[9] = -s;
        m[10] = c;
    }
    else if (axis === 1) {
        m[0] = c;
        m[2] = -s;
        m[8] = s;
        m[10] = c;
    }
    else {
        m[0] = c;
        m[1] = s;
        m[4] = -s;
        m[5] = c;
    } return m; },
    compose(p = [0, 0, 0], r = [0, 0, 0], s = 1) { let m = this.translation(...p); for (let i = 2; i >= 0; i--)
        m = this.multiply(m, this.rotation(i, r[i] * Math.PI / 180)); for (let i = 0; i < 12; i++)
        m[i] *= s; return m; },
    point(m, p) { const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]; return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w, (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w]; },
    vector: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]],
    inverse(a) { const rows = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => c < 4 ? a[c * 4 + r] : +(c - 4 === r))); for (let i = 0; i < 4; i++) {
        let p = i;
        for (let j = i + 1; j < 4; j++)
            if (Math.abs(rows[j][i]) > Math.abs(rows[p][i]))
                p = j;
        if (Math.abs(rows[p][i]) < 1e-14)
            throw Error('Singular transform');
        [rows[p], rows[i]] = [rows[i], rows[p]];
        const q = rows[i][i];
        rows[i] = rows[i].map(x => x / q);
        for (let j = 0; j < 4; j++)
            if (j !== i) {
                const f = rows[j][i];
                rows[j] = rows[j].map((x, k) => x - f * rows[i][k]);
            }
    } return new Float32Array(Array.from({ length: 16 }, (_, i) => rows[i % 4][4 + Math.floor(i / 4)])); },
    lookAt(eye, target, up = [0, 0, 1]) { const z = V.norm(V.sub(eye, target)), x = V.norm(V.cross(up, z)), y = V.cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]); },
    perspective(fov, aspect, near, far) { const f = 1 / Math.tan(fov / 2); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0]); },
    ortho(l, r, b, t, n, f) { return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, 1 / (n - f), 0, -(r + l) / (r - l), -(t + b) / (t - b), n / (n - f), 1]); }
};
export function bounds(vertices, stride = 6) { let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < vertices.length; i += stride) {
    const p = Array.from(vertices.slice(i, i + 3));
    min = V.min(min, p);
    max = V.max(max, p);
} return { min, max }; }
export function rayBox(o, d, min, max, limit = Infinity) { let lo = 0, hi = limit; for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
        if (o[i] < min[i] || o[i] > max[i])
            return false;
        continue;
    }
    let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
    if (a > b)
        [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (hi < lo)
        return false;
} return true; }
export function rayTriangle(o, d, a, b, c) { const e1 = V.sub(b, a), e2 = V.sub(c, a), h = V.cross(d, e2), det = V.dot(e1, h); if (Math.abs(det) < 1e-10)
    return null; const f = 1 / det, s = V.sub(o, a), u = f * V.dot(s, h); if (u < 0 || u > 1)
    return null; const q = V.cross(s, e1), v = f * V.dot(d, q); if (v < 0 || u + v > 1)
    return null; const t = f * V.dot(e2, q); return t > 1e-6 ? t : null; }
/** Median-split CPU BVH. Geometry never needs a GPU readback for picking. */
export class BVH {
    constructor(data) { this.data = data; this.root = this.build(Array.from({ length: data.length / 18 }, (_, i) => i)); }
    build(ids, depth = 0) { let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (const id of ids)
        for (let j = 0; j < 3; j++) {
            const k = id * 18 + j * 6;
            for (let c = 0; c < 3; c++) {
                min[c] = Math.min(min[c], this.data[k + c]);
                max[c] = Math.max(max[c], this.data[k + c]);
            }
        } const n = { min, max }; if (ids.length <= 12 || depth > 28) {
        n.ids = ids;
        return n;
    } const ext = V.sub(max, min), axis = ext.indexOf(Math.max(...ext)); ids.sort((a, b) => (this.data[a * 18 + axis] + this.data[a * 18 + 6 + axis] + this.data[a * 18 + 12 + axis]) - (this.data[b * 18 + axis] + this.data[b * 18 + 6 + axis] + this.data[b * 18 + 12 + axis])); const mid = ids.length >> 1; n.left = this.build(ids.slice(0, mid), depth + 1); n.right = this.build(ids.slice(mid), depth + 1); return n; }
    intersect(o, d, accept = () => true) { let best = Infinity, hit = null; const walk = n => { if (!rayBox(o, d, n.min, n.max, best))
        return; if (n.ids) {
        for (const id of n.ids) {
            const k = id * 18, a = Array.from(this.data.slice(k, k + 3)), b = Array.from(this.data.slice(k + 6, k + 9)), c = Array.from(this.data.slice(k + 12, k + 15));
            const t = rayTriangle(o, d, a, b, c);
            if (t !== null && t < best) {
                const point = V.add(o, V.mul(d, t));
                if (!accept(point))
                    continue;
                best = t;
                hit = { t, point, normal: V.norm(V.cross(V.sub(b, a), V.sub(c, a))), triangle: id };
            }
        }
    }
    else {
        walk(n.left);
        walk(n.right);
    } }; if (this.data.length)
        walk(this.root); return hit; }
}
export class Camera {
    constructor() { this.target = [0, 0, 35]; this.yaw = .69; this.pitch = .52; this.distance = 280; this.scale = 210; this.perspective = false; this.aspect = 1; this.eye = [0, 0, 0]; this.update(); }
    update() { const c = Math.cos(this.pitch); this.eye = V.add(this.target, [this.distance * c * Math.sin(this.yaw), -this.distance * c * Math.cos(this.yaw), this.distance * Math.sin(this.pitch)]); this.view = M.lookAt(this.eye, this.target); this.proj = this.perspective ? M.perspective(Math.PI / 4, this.aspect, .1, 10000) : M.ortho(-this.scale * this.aspect / 2, this.scale * this.aspect / 2, -this.scale / 2, this.scale / 2, .1, 10000); this.vp = M.multiply(this.proj, this.view); this.inv = M.inverse(this.vp); return this; }
    ray(x, y, w, h) { const a = M.point(this.inv, [2 * x / w - 1, 1 - 2 * y / h, 0]), b = M.point(this.inv, [2 * x / w - 1, 1 - 2 * y / h, 1]); return { o: a, d: V.norm(V.sub(b, a)) }; }
    project(p, w, h) { const n = M.point(this.vp, p); return [(n[0] + 1) * w / 2, (1 - n[1]) * h / 2, n[2]]; }
    orbit(dx, dy) { this.yaw -= dx * .007; this.pitch = Math.max(-1.565, Math.min(1.565, this.pitch + dy * .007)); this.update(); }
    pan(dx, dy, w, h) { const right = [this.view[0], this.view[4], this.view[8]], up = [this.view[1], this.view[5], this.view[9]], k = (this.perspective ? this.distance * .828 : this.scale) / h; this.target = V.add(this.target, V.add(V.mul(right, -dx * k), V.mul(up, dy * k))); this.update(); }
    zoom(delta) { const k = Math.exp(Math.max(-1, Math.min(1, delta * .001))); this.scale = Math.max(.1, Math.min(20000, this.scale * k)); this.distance = Math.max(.1, Math.min(20000, this.distance * k)); this.update(); }
    preset(name) { const presets = { iso: [.69, .52], front: [0, 0], back: [Math.PI, 0], top: [0, 1.565], bottom: [0, -1.565], right: [Math.PI / 2, 0], left: [-Math.PI / 2, 0] }; [this.yaw, this.pitch] = presets[name] || presets.iso; this.update(); }
}
