import { V, M } from './math.js';
/** Polygonal constructive-solid-geometry kernel. Coordinates are millimeters.
 * Geometry uses JS float64. This is deliberately NOT an exact B-rep kernel.
 * BSP splits preserve interpolated normals and share no mutable vertices.
 */
export const TOLERANCE = 1e-5;
const MAX_POLYGONS = 180000;
export class Vertex {
    constructor(p, n) { this.p = p; this.n = n; }
    clone() { return new Vertex([...this.p], [...this.n]); }
    flip() { this.n = V.mul(this.n, -1); }
    interpolate(b, t) { return new Vertex(V.lerp(this.p, b.p, t), V.norm(V.lerp(this.n, b.n, t))); }
}
export class Plane {
    constructor(n, w) { this.n = n; this.w = w; }
    clone() { return new Plane([...this.n], this.w); }
    flip() { this.n = V.mul(this.n, -1); this.w = -this.w; }
    split(poly, cf, cb, front, back) { let type = 0; const types = poly.v.map(v => { const t = V.dot(this.n, v.p) - this.w, k = t < -TOLERANCE ? 2 : t > TOLERANCE ? 1 : 0; type |= k; return k; }); if (type === 0)
        (V.dot(this.n, poly.plane.n) > 0 ? cf : cb).push(poly);
    else if (type === 1)
        front.push(poly);
    else if (type === 2)
        back.push(poly);
    else {
        const f = [], b = [];
        for (let i = 0; i < poly.v.length; i++) {
            const j = (i + 1) % poly.v.length, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
            if (ti !== 2)
                f.push(vi);
            if (ti !== 1)
                b.push(ti !== 2 ? vi.clone() : vi);
            if ((ti | tj) === 3) {
                const t = (this.w - V.dot(this.n, vi.p)) / V.dot(this.n, V.sub(vj.p, vi.p));
                const v = vi.interpolate(vj, Math.max(0, Math.min(1, t)));
                f.push(v);
                b.push(v.clone());
            }
        }
        for (const [vs, out] of [[f, front], [b, back]]) {
            const clean = vs.filter((v, i) => V.len(V.sub(v.p, vs[(i + 1) % vs.length].p)) > 1e-8);
            if (clean.length >= 3) {
                const p = Polygon.tryCreate(clean, poly.tag);
                if (p)
                    out.push(p);
            }
        }
    } }
}
export class Polygon {
    constructor(vertices, tag = 0) { this.v = vertices; this.tag = tag; let n = null; for (let i = 1; i < vertices.length - 1; i++) {
        const c = V.cross(V.sub(vertices[i].p, vertices[0].p), V.sub(vertices[i + 1].p, vertices[0].p));
        if (V.len(c) > 1e-10) {
            n = V.norm(c);
            break;
        }
    } if (!n)
        throw Error('Degenerate polygon'); this.plane = new Plane(n, V.dot(n, vertices[0].p)); }
    static tryCreate(v, tag) { try {
        return new Polygon(v, tag);
    }
    catch {
        return null;
    } }
    clone() { return new Polygon(this.v.map(v => v.clone()), this.tag); }
    flip() { this.v.reverse().forEach(v => v.flip()); this.plane.flip(); }
}
class BSP {
    constructor(polygons = []) { this.plane = null; this.front = null; this.back = null; this.polygons = []; if (polygons.length)
        this.build(polygons); }
    invert() { for (const p of this.polygons)
        p.flip(); this.plane?.flip(); this.front?.invert(); this.back?.invert(); [this.front, this.back] = [this.back, this.front]; }
    clipPolygons(polys, depth = 0) { if (!this.plane)
        return polys.slice(); if (depth > 900)
        throw Error('Boolean exceeds BSP depth limit'); let f = [], b = []; for (const p of polys)
        this.plane.split(p, f, b, f, b); if (this.front)
        f = this.front.clipPolygons(f, depth + 1); if (this.back)
        b = this.back.clipPolygons(b, depth + 1);
    else
        b = []; return f.concat(b); }
    clipTo(bsp) { this.polygons = bsp.clipPolygons(this.polygons); this.front?.clipTo(bsp); this.back?.clipTo(bsp); }
    all() { return this.polygons.concat(this.front?.all() || [], this.back?.all() || []); }
    build(polys, depth = 0) { if (!polys.length)
        return; if (depth > 900 || polys.length > MAX_POLYGONS)
        throw Error('Geometry complexity limit reached'); if (!this.plane) {
        let best = polys[0].plane, score = Infinity;
        const step = Math.max(1, Math.floor(polys.length / 7));
        for (let i = 0; i < polys.length; i += step) {
            const plane = polys[i].plane;
            let f = 0, b = 0, s = 0;
            for (let j = 0; j < polys.length; j += Math.max(1, Math.floor(polys.length / 80))) {
                let lo = false, hi = false;
                for (const v of polys[j].v) {
                    const d = V.dot(plane.n, v.p) - plane.w;
                    lo ||= d < -TOLERANCE;
                    hi ||= d > TOLERANCE;
                }
                if (lo && hi)
                    s++;
                else if (lo)
                    b++;
                else if (hi)
                    f++;
            }
            const cost = s * 8 + Math.abs(f - b);
            if (cost < score) {
                score = cost;
                best = plane;
            }
        }
        this.plane = best.clone();
    } const f = [], b = []; for (const p of polys)
        this.plane.split(p, this.polygons, this.polygons, f, b); if (f.length) {
        this.front ||= new BSP();
        this.front.build(f, depth + 1);
    } if (b.length) {
        this.back ||= new BSP();
        this.back.build(b, depth + 1);
    } }
}
export class Solid {
    constructor(polys = []) { this.polys = polys; }
    clone() { return new Solid(this.polys.map(p => p.clone())); }
    union(other) { if (!this.polys.length)
        return other.clone(); if (!other.polys.length)
        return this.clone(); const a = new BSP(this.clone().polys), b = new BSP(other.clone().polys); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); return new Solid(a.all()); }
    subtract(other) { if (!this.polys.length || !other.polys.length)
        return this.clone(); const a = new BSP(this.clone().polys), b = new BSP(other.clone().polys); a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); a.invert(); return new Solid(a.all()); }
    intersect(other) { if (!this.polys.length || !other.polys.length)
        return new Solid(); const a = new BSP(this.clone().polys), b = new BSP(other.clone().polys); a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.all()); a.invert(); return new Solid(a.all()); }
    transform(m) { return new Solid(this.polys.map(p => new Polygon(p.v.map(v => new Vertex(M.point(m, v.p), V.norm(M.vector(m, v.n)))), p.tag))); }
}
function poly(points, normal = null) { const n = normal || V.norm(V.cross(V.sub(points[1], points[0]), V.sub(points[2], points[0]))); return new Polygon(points.map(p => new Vertex(p, [...n]))); }
export function signedArea(points) { return points.reduce((s, p, i) => { const q = points[(i + 1) % points.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2; }
function cross2(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
export function triangulate(points) { const ids = points.map((_, i) => i), out = []; let guard = 0; while (ids.length > 3) {
    let found = false;
    for (let i = 0; i < ids.length; i++) {
        const a = ids[(i + ids.length - 1) % ids.length], b = ids[i], c = ids[(i + 1) % ids.length];
        if (cross2(points[a], points[b], points[c]) <= 1e-10)
            continue;
        let inside = false;
        for (const j of ids)
            if (j !== a && j !== b && j !== c && cross2(points[a], points[b], points[j]) >= -1e-10 && cross2(points[b], points[c], points[j]) >= -1e-10 && cross2(points[c], points[a], points[j]) >= -1e-10) {
                inside = true;
                break;
            }
        if (!inside) {
            out.push([a, b, c]);
            ids.splice(i, 1);
            found = true;
            break;
        }
    }
    if (!found || guard++ > 10000)
        throw Error('Profile must be a simple, closed, non-self-intersecting polygon');
} if (ids.length === 3)
    out.push([...ids]); return out; }
export function rectProfile(width, depth, radius = 0, segments = 8) { const w = Math.max(.01, width) / 2, d = Math.max(.01, depth) / 2, r = Math.max(0, Math.min(radius, w - .001, d - .001)); if (r < 1e-6)
    return [[-w, -d], [w, -d], [w, d], [-w, d]]; const pts = []; for (let c = 0; c < 4; c++) {
    const angle = c * Math.PI / 2, cx = (c === 0 || c === 3) ? w - r : -w + r, cy = c < 2 ? d - r : -d + r;
    for (let i = 0; i <= segments; i++) {
        const a = angle + i / segments * Math.PI / 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
} return pts; }
export function circleProfile(radius, segments = 48) { return Array.from({ length: segments }, (_, i) => { const a = i / segments * Math.PI * 2; return [Math.cos(a) * radius, Math.sin(a) * radius]; }); }
export function extrude(input, height, z = 0) { validateProfile(input); if (!Number.isFinite(height) || height <= 0)
    throw Error('Pad length must be positive'); let pts = input.map(p => [...p]); if (pts.length < 3)
    throw Error('A closed profile needs at least three points'); if (signedArea(pts) < 0)
    pts.reverse(); if (Math.abs(signedArea(pts)) < 1e-8)
    throw Error('Profile area is zero'); const out = []; const convex = pts.every((p, i) => cross2(pts[(i + pts.length - 1) % pts.length], p, pts[(i + 1) % pts.length]) >= -1e-9); const caps = convex ? [pts.map((_, i) => i)] : triangulate(pts); for (const ids of caps) {
    out.push(poly(ids.map(i => [...pts[i], z]).reverse(), [0, 0, -1]));
    out.push(poly(ids.map(i => [...pts[i], z + height]), [0, 0, 1]));
} const normals = pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return V.norm([b[1] - a[1], a[0] - b[0], 0]); }); for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length, a = pts[i], b = pts[j], n = normals[i], prev = normals[(i + pts.length - 1) % pts.length], next = normals[j], na = V.dot(prev, n) > .93 ? V.norm(V.add(prev, n)) : n, nb = V.dot(n, next) > .93 ? V.norm(V.add(n, next)) : n;
    out.push(new Polygon([new Vertex([...a, z], na), new Vertex([...b, z], nb), new Vertex([...b, z + height], nb), new Vertex([...a, z + height], na)]));
} return new Solid(out); }
export function box({ width = 40, depth = 30, height = 20, radius = 0, x = 0, y = 0, z = 0 } = {}) { return extrude(rectProfile(width, depth, radius), height).transform(M.translation(x, y, z)); }
export function cylinder({ radius = 15, height = 30, x = 0, y = 0, z = 0, segments = 48, axis = 'Z' } = {}) { const out = []; for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
    const n1 = [Math.cos(a), Math.sin(a), 0], n2 = [Math.cos(b), Math.sin(b), 0], p1 = V.mul(n1, radius), p2 = V.mul(n2, radius);
    out.push(new Polygon([new Vertex(p1, n1), new Vertex(p2, n2), new Vertex(V.add(p2, [0, 0, height]), n2), new Vertex(V.add(p1, [0, 0, height]), n1)]));
} const points = circleProfile(radius, segments); out.push(poly(points.map(p => [...p, 0]).reverse(), [0, 0, -1])); out.push(poly(points.map(p => [...p, height]), [0, 0, 1])); let s = new Solid(out); if (axis === 'Y')
    s = s.transform(M.rotation(0, -Math.PI / 2)); if (axis === 'X')
    s = s.transform(M.rotation(1, Math.PI / 2)); return s.transform(M.translation(x, y, z)); }
export function sphere({ radius = 15, x = 0, y = 0, z = 0, segments = 32, rings = 16 } = {}) { const out = []; const vertex = (u, v) => { const n = [Math.cos(u) * Math.sin(v), Math.sin(u) * Math.sin(v), Math.cos(v)]; return new Vertex(V.mul(n, radius), n); }; for (let j = 0; j < rings; j++)
    for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2, c = j / rings * Math.PI, d = (j + 1) / rings * Math.PI;
        const vs = [vertex(a, c), vertex(a, d), vertex(b, d), vertex(b, c)];
        if (j === 0)
            vs.shift();
        if (j === rings - 1)
            vs.splice(2, 1);
        const p = Polygon.tryCreate(vs);
        if (p)
            out.push(p);
    } return new Solid(out).transform(M.translation(x, y, z)); }
/** A closed radius/elevation profile revolved about local Z; angle in degrees. */
export function revolve({ profile = null, radius = 20, innerRadius = 10, height = 25, angle = 360, segments = 64, x = 0, y = 0, z = 0 } = {}) { let pts = profile || [[Math.max(0, innerRadius), 0], [radius, 0], [radius, height], [Math.max(0, innerRadius), height]]; pts = pts.map(p => [...p]); validateProfile(pts); if (pts.some(p => p[0] < 0))
    throw Error('Revolved radii cannot be negative'); if (signedArea(pts) < 0)
    pts.reverse(); angle = Math.max(1, Math.min(360, angle)); const n = Math.max(3, Math.ceil(segments * angle / 360)), out = []; const vertex = (p, t, norm) => new Vertex([p[0] * Math.cos(t), p[0] * Math.sin(t), p[1]], norm); for (let j = 0; j < pts.length; j++) {
    const a = pts[j], b = pts[(j + 1) % pts.length];
    if (a[0] < 1e-8 && b[0] < 1e-8)
        continue;
    const edge = V.norm([b[1] - a[1], 0, a[0] - b[0]]);
    for (let i = 0; i < n; i++) {
        const t0 = i / n * angle * Math.PI / 180, t1 = (i + 1) / n * angle * Math.PI / 180, n0 = [edge[0] * Math.cos(t0), edge[0] * Math.sin(t0), edge[2]], n1 = [edge[0] * Math.cos(t1), edge[0] * Math.sin(t1), edge[2]];
        let vs = [vertex(a, t0, n0), vertex(a, t1, n1), vertex(b, t1, n1), vertex(b, t0, n0)];
        vs = vs.filter((v, k) => V.len(V.sub(v.p, vs[(k + 1) % vs.length].p)) > 1e-8);
        const p = Polygon.tryCreate(vs);
        if (p)
            out.push(p);
    }
} if (angle < 359.999) {
    for (const tri of triangulate(pts)) {
        const start = tri.map(i => [pts[i][0], 0, pts[i][1]]);
        out.push(poly(start));
        const end = start.map(p => M.point(M.rotation(2, angle * Math.PI / 180), p));
        out.push(poly(end.reverse()));
    }
} return new Solid(out).transform(M.translation(x, y, z)); }
export function profileFor(p) { if (p.shape === 'circle')
    return circleProfile(p.radius || 15, p.segments || 48); if (p.shape === 'polygon')
    return p.points; return rectProfile(p.width || 40, p.depth || 30, p.corner || 0); }
export function shapeFor(feature) { const p = feature.params || {}; switch (feature.type) {
    case 'pad':
    case 'pocket': return extrude(profileFor(p), p.height || 20).transform(M.compose([p.x || 0, p.y || 0, p.z || 0], p.rotation || [0, 0, 0]));
    case 'hole':
    case 'cylinder': return cylinder(p);
    case 'box': return box(p);
    case 'sphere': return sphere(p);
    case 'shaft':
    case 'groove': return revolve(p);
    case 'mesh': return new Solid(p.polygons.map(v => poly(v)));
    default: throw Error(`Unknown feature: ${feature.type}`);
} }
/** Convert convex polygon soup into GPU triangle/crease buffers and mass properties. */
export function tessellate(solid) { const data = [], edgeMap = new Map(); let area = 0, volume = 0, centroid = [0, 0, 0], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; const key = p => p.map(x => Math.round(x / TOLERANCE)).join(','); for (const poly of solid.polys) {
    const verts = poly.v;
    for (let i = 1; i < verts.length - 1; i++) {
        const tri = [verts[0], verts[i], verts[i + 1]], a = tri[0].p, b = tri[1].p, c = tri[2].p;
        const ar = V.len(V.cross(V.sub(b, a), V.sub(c, a))) / 2;
        if (ar < 1e-9)
            continue;
        area += ar;
        const vol = V.dot(a, V.cross(b, c)) / 6;
        volume += vol;
        centroid = V.add(centroid, V.mul(V.add(V.add(a, b), c), vol / 4));
        for (const v of tri) {
            data.push(...v.p, ...v.n);
            min = V.min(min, v.p);
            max = V.max(max, v.p);
        }
    }
    for (let i = 0; i < verts.length; i++) {
        const a = verts[i].p, b = verts[(i + 1) % verts.length].p, ka = key(a), kb = key(b), k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const item = edgeMap.get(k);
        if (item)
            item.normals.push(poly.plane.n);
        else
            edgeMap.set(k, { a, b, normals: [poly.plane.n] });
    }
} const edges = extractCreases(edgeMap); if (!data.length) {
    min = [0, 0, 0];
    max = [0, 0, 0];
} return { vertices: new Float32Array(data), edges: new Float32Array(edges), bounds: { min, max }, stats: { triangles: data.length / 18, polygons: solid.polys.length, area, volume: Math.abs(volume), centroid: Math.abs(volume) > 1e-9 ? V.mul(centroid, 1 / volume) : [0, 0, 0] } }; }
/** Merge collinear edge intervals before classifying creases. This removes
 * coplanar BSP seams even when neighboring polygons contain T-junctions. */
function extractCreases(edgeMap) {
    const edges = [], groups = new Map();
    const emit = (a, b) => edges.push(...a, 0, 0, 0, ...b, 0, 0, 0);
    for (const e of edgeMap.values()) {
        if (e.normals.length > 1) {
            if (e.normals.some(n => V.dot(n, e.normals[0]) < .8))
                emit(e.a, e.b);
            continue;
        }
        let d = V.norm(V.sub(e.b, e.a));
        const axis = d.findIndex(x => Math.abs(x) > 1e-7);
        if (d[axis] < 0)
            d = V.mul(d, -1);
        const moment = V.cross(e.a, d), key = [...d.map(x => Math.round(x * 1e5)), ...moment.map(x => Math.round(x * 1e4))].join(',');
        const a = V.dot(e.a, d), b = V.dot(e.b, d);
        let group = groups.get(key);
        if (!group) {
            group = { d, origin: V.sub(e.a, V.mul(d, a)), intervals: [] };
            groups.set(key, group);
        }
        group.intervals.push({ min: Math.min(a, b), max: Math.max(a, b), normal: e.normals[0] });
    }
    for (const { d, origin, intervals } of groups.values()) {
        const endpoints = intervals.flatMap(x => [x.min, x.max]).sort((a, b) => a - b), points = endpoints.filter((v, i) => !i || v - endpoints[i - 1] > TOLERANCE);
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i], b = points[i + 1];
            if (b - a < TOLERANCE)
                continue;
            const mid = (a + b) / 2, active = intervals.filter(x => x.min < mid + TOLERANCE && x.max > mid - TOLERANCE);
            if (active.length > 1 && active.some(x => V.dot(x.normal, active[0].normal) < .8))
                emit(V.add(origin, V.mul(d, a)), V.add(origin, V.mul(d, b)));
            else if (active.length === 1 && intervals.length === 1)
                emit(V.add(origin, V.mul(d, a)), V.add(origin, V.mul(d, b)));
        }
    }
    return edges;
}
export function validateProfile(points) {
    if (!Array.isArray(points) || points.length < 3 || points.length > 512)
        throw Error('Profile needs 3–512 vertices');
    for (const p of points)
        if (!Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v)))
            throw Error('Invalid profile vertex');
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8)
            throw Error('Profile has a zero-length edge');
    }
    const on = (a, b, p) => Math.abs(cross2(a, b, p)) < 1e-8 && p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8 && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8)
            throw Error('Profile has a zero-length edge');
        for (let j = i + 1; j < points.length; j++) {
            if (j === i + 1 || (i === 0 && j === points.length - 1))
                continue;
            const c = points[j], d = points[(j + 1) % points.length], ac = cross2(a, b, c), ad = cross2(a, b, d), ca = cross2(c, d, a), cb = cross2(c, d, b);
            if ((ac * ad < 0 && ca * cb < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b))
                throw Error('Profile is self-intersecting or self-touching');
        }
    }
    return points;
}
