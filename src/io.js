import { M, V } from './math.js';
import { body, feature, validateDocument, MATERIALS } from './model.js';
export function download(data, name, type = 'application/octet-stream') { const blob = data instanceof Blob ? data : new Blob([data], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export const safeName = s => s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 80) || 'aureon';
export function projectJSON(doc) { return JSON.stringify({ ...doc, modified: new Date().toISOString() }, null, 2); }
export function worldTriangles(doc, meshes, selection = null) { const out = []; for (const b of doc.bodies) {
    if (!b.visible || selection?.size && !selection.has(b.id))
        continue;
    const mesh = meshes.get(b.id);
    if (!mesh)
        continue;
    const m = M.compose(b.position, b.rotation);
    for (let i = 0; i < mesh.vertices.length; i += 18) {
        const a = M.point(m, Array.from(mesh.vertices.slice(i, i + 3))), c = M.point(m, Array.from(mesh.vertices.slice(i + 6, i + 9))), d = M.point(m, Array.from(mesh.vertices.slice(i + 12, i + 15)));
        out.push({ a, b: c, c: d, n: V.norm(V.cross(V.sub(c, a), V.sub(d, a))), name: b.name });
    }
} return out; }
export function binarySTL(triangles) { const buffer = new ArrayBuffer(84 + triangles.length * 50), view = new DataView(buffer); new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode('Aureon CAD | millimeters | tessellated mesh; not exact CAD geometry').slice(0, 80)); view.setUint32(80, triangles.length, true); let offset = 84; for (const t of triangles) {
    for (const v of [...t.n, ...t.a, ...t.b, ...t.c]) {
        view.setFloat32(offset, v, true);
        offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
} return buffer; }
export function objText(triangles) { let text = '# Aureon CAD\n# Units: millimeters\n', id = 1, group = ''; for (const t of triangles) {
    if (group !== t.name) {
        group = t.name;
        text += `g ${safeName(group)}\n`;
    }
    for (const p of [t.a, t.b, t.c])
        text += `v ${p.map(v => v.toFixed(6)).join(' ')}\n`;
    text += `vn ${t.n.map(v => v.toFixed(8)).join(' ')}\n`;
    const n = (id + 2) / 3;
    text += `f ${id}//${n} ${id + 1}//${n} ${id + 2}//${n}\n`;
    id += 3;
} return text; }
export async function readFile(file) { if (file.size > 32 * 1024 * 1024)
    throw Error('Maximum import size is 32 MiB'); if (!file.name.toLowerCase().endsWith('.stl'))
    return { document: validateDocument(JSON.parse(await file.text())) }; const buffer = await file.arrayBuffer(), view = new DataView(buffer), polygons = []; const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0; if (buffer.byteLength >= 84 && 84 + count * 50 === buffer.byteLength) {
    if (count > 200000)
        throw Error('STL exceeds 200,000 triangles');
    for (let i = 0; i < count; i++) {
        const tri = [];
        for (let v = 0; v < 3; v++)
            tri.push(Array.from({ length: 3 }, (_, k) => view.getFloat32(84 + i * 50 + 12 + v * 12 + k * 4, true)));
        polygons.push(tri);
    }
}
else {
    const text = new TextDecoder().decode(buffer);
    const re = /\bvertex\s+([+-]?[\d.]+(?:e[+-]?\d+)?)\s+([+-]?[\d.]+(?:e[+-]?\d+)?)\s+([+-]?[\d.]+(?:e[+-]?\d+)?)/gi;
    let match, tri = [];
    while ((match = re.exec(text))) {
        tri.push(match.slice(1).map(Number));
        if (tri.length === 3) {
            polygons.push(tri);
            tri = [];
        }
        if (polygons.length > 200000)
            throw Error('STL exceeds 200,000 triangles');
    }
} if (!polygons.length)
    throw Error('No STL triangles found'); for (const tri of polygons)
    for (const p of tri)
        if (p.some(x => !Number.isFinite(x) || Math.abs(x) > 1e7))
            throw Error('Invalid STL coordinates'); return { body: body(file.name.replace(/\.stl$/i, ''), [feature('mesh', 'Imported STL mesh', { polygons })]) }; }
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function drawingSVG(doc, meshes) { const views = [{ name: 'FRONT', axes: [0, 2], x: 45, y: 65 }, { name: 'TOP', axes: [0, 1], x: 425, y: 65 }, { name: 'RIGHT', axes: [1, 2], x: 45, y: 370 }]; let content = ''; for (const v of views) {
    const segments = [];
    let min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    for (const b of doc.bodies) {
        if (!b.visible)
            continue;
        const mesh = meshes.get(b.id);
        if (!mesh)
            continue;
        const m = M.compose(b.position, b.rotation);
        for (let i = 0; i < mesh.edges.length; i += 12) {
            const a = M.point(m, Array.from(mesh.edges.slice(i, i + 3))), c = M.point(m, Array.from(mesh.edges.slice(i + 6, i + 9)));
            const seg = [v.axes.map(k => a[k]), v.axes.map(k => c[k])];
            segments.push(seg);
            for (const p of seg)
                for (let k = 0; k < 2; k++) {
                    min[k] = Math.min(min[k], p[k]);
                    max[k] = Math.max(max[k], p[k]);
                }
        }
    }
    if (!segments.length)
        continue;
    const scale = Math.min(305 / Math.max(1, max[0] - min[0]), 220 / Math.max(1, max[1] - min[1]));
    const point = p => [v.x + 15 + (p[0] - min[0]) * scale, v.y + 235 - (p[1] - min[1]) * scale];
    let path = '';
    for (const s of segments) {
        const a = point(s[0]), b = point(s[1]);
        path += `M${a[0].toFixed(2)},${a[1].toFixed(2)}L${b[0].toFixed(2)},${b[1].toFixed(2)}`;
    }
    content += `<text x="${v.x}" y="${v.y}" font-size="11" fill="#667085">${v.name} · WIREFRAME PROJECTION</text><path d="${path}" fill="none" stroke="#334155" stroke-width=".55"/>`;
} return `<svg xmlns="http://www.w3.org/2000/svg" width="841" height="680" viewBox="0 0 841 680"><rect width="841" height="680" fill="white"/><rect x="20" y="20" width="801" height="640" fill="none" stroke="#94a3b8"/><g font-family="Arial,sans-serif">${content}<rect x="425" y="475" width="350" height="155" fill="#f8fafc" stroke="#94a3b8"/><text x="442" y="505" font-size="18" fill="#334155">${xml(doc.name)}</text><text x="442" y="532" font-size="11" fill="#64748b">AUREON CAD · GENERAL ARRANGEMENT</text><text x="442" y="558" font-size="10" fill="#64748b">Units: mm · Not to scale · ${new Date().toISOString().slice(0, 10)}</text><text x="442" y="585" font-size="9" fill="#64748b">Tessellated wireframe; hidden lines are not removed.</text><text x="442" y="608" font-size="9" fill="#64748b">Not a manufacturing drawing. Verify all dimensions.</text></g></svg>`; }
export function bomCSV(doc, meshes) { const quote = s => `"${String(s).replaceAll('"', '""')}"`; return [['Item', 'Part', 'Material', 'Quantity', 'Volume (mm3)', 'Approximate mass (g)'].map(quote).join(','), ...doc.bodies.map((b, i) => { const m = MATERIALS[b.material], volume = meshes.get(b.id)?.stats.volume || 0; return [i + 1, b.name, m.name, 1, volume.toFixed(3), (volume * m.density).toFixed(3)].map(quote).join(','); })].join('\r\n'); }
