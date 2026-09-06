import { icon } from './icons.js';
import { Renderer } from './renderer.js';
import { V, M } from './math.js';
import { MATERIALS, uid, feature, body, emptyDocument, demoDocument, validateDocument, History } from './model.js';
import { Sketcher } from './sketch.js';
import { download, safeName, projectJSON, worldTriangles, binarySTL, objText, readFile, drawingSVG, bomCSV } from './io.js';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const STORAGE = 'aureon-cad.project.v1';
const fillIcons = (root = document) => $$('[data-icon]', root).forEach(e => e.innerHTML = icon(e.dataset.icon));
fillIcons();
function toast(message, error = false) { const container = $('#toast-container'); let e = [...container.children].find(node => node.textContent === message); if (!e) {
    e = document.createElement('div');
    e.className = `toast${error ? ' error' : ''}`;
    e.textContent = message;
    container.append(e);
} clearTimeout(e.dismissTimer); e.dismissTimer = setTimeout(() => e.remove(), error ? 7000 : 4000); while (container.children.length > 3) {
    const first = container.firstElementChild;
    clearTimeout(first.dismissTimer);
    first.remove();
} }
function status(message) { $('#status-message').textContent = message; }
function report(error) { console.error(error); toast(error.message || String(error), true); status('Operation failed — see message'); }
let storageWarned = false;
let initial = demoDocument(), restored = false;
try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) {
        initial = validateDocument(JSON.parse(saved));
        restored = true;
    }
}
catch (e) {
    console.warn('Saved project could not be restored', e);
    $('#save-status').textContent = 'Local restore unavailable — use Open / Save';
}
const history = new History(initial);
let renderer, sketcher, workbench = 'part', selected = new Set(), selectedFeature = null, collapsed = new Set(initial.bodies.filter((_, i) => i !== 1).map(b => b.id)), rootCollapsed = false;
let measurements = [], measuring = false, showDimensions = true, navMode = 'select', lastHit = null, hoverPointer = null;
let buildSerial = 0, lastBuild = Promise.resolve(), lastBuildMs = 0, operation = null, previewTimer = null, editingSketch = null, saveTimer = null;
let cameraNeedsFit = true, modelBusy = false;
const activeBody = () => history.doc.bodies.find(b => selected.has(b.id));
const activeFeature = () => activeBody()?.features.find(f => f.id === selectedFeature);
class KernelBridge {
    constructor() { this.requests = new Map(); this.next = 0; this.create(); }
    create() { this.worker = globalThis.__AUREON_WORKER_FACTORY__ ? globalThis.__AUREON_WORKER_FACTORY__() : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); this.worker.onmessage = ({ data }) => { const p = this.requests.get(data.id); if (!p)
        return; clearTimeout(p.timer); this.requests.delete(data.id); data.error ? p.reject(Error(data.error)) : p.resolve(data); }; this.worker.onerror = e => { for (const p of this.requests.values()) {
        clearTimeout(p.timer);
        p.reject(Error(e.message || 'Geometry worker failed'));
    } this.requests.clear(); }; }
    build(doc) { const id = ++this.next; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.worker.terminate(); for (const p of this.requests.values()) {
        clearTimeout(p.timer);
        p.reject(Error('Geometry evaluation exceeded 30 seconds; simplify the feature and try again.'));
    } this.requests.clear(); this.create(); }, 30000); this.requests.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, doc }); }); }
}
const kernel = new KernelBridge();
async function rebuild(doc = history.doc, { preview = false, fit = false, quiet = false } = {}) { const ticket = ++buildSerial; modelBusy = true; $('#tree-state').textContent = preview ? 'Previewing feature…' : 'Updating geometry…'; status(preview ? 'Computing feature preview…' : 'Rebuilding feature history…'); if (fit)
    cameraNeedsFit = true; const promise = kernel.build(doc); lastBuild = promise; try {
    const result = await promise;
    if (ticket !== buildSerial)
        return result;
    renderer.setMeshes(result.meshes, doc);
    renderer.selected = selected;
    lastBuildMs = result.elapsed;
    modelBusy = false;
    $('#loading').hidden = true;
    $('#tree-state').textContent = preview ? 'Feature preview' : 'Model up to date';
    status(preview ? 'Preview ready — apply to commit' : 'Ready');
    $('#empty-model').hidden = doc.bodies.length > 0;
    $('#triangle-count').textContent = `${fmt(result.meshes.reduce((s, m) => s + m.stats.triangles, 0), 0)} triangles`;
    if (cameraNeedsFit) {
        renderer.fit();
        cameraNeedsFit = false;
    }
    if (!preview) {
        renderInspector();
        renderHistory();
    }
    return result;
}
catch (error) {
    if (ticket !== buildSerial)
        throw error;
    modelBusy = false;
    $('#loading').hidden = true;
    $('#tree-state').textContent = 'Feature evaluation failed';
    status('Geometry error');
    if (operation)
        $('#operation-error').textContent = error.message;
    else if (!quiet)
        report(error);
    throw error;
} }
function autosave() { clearTimeout(saveTimer); $('#save-status').textContent = 'Saving locally…'; saveTimer = setTimeout(() => { try {
    localStorage.setItem(STORAGE, JSON.stringify(history.doc));
    $('#save-status').textContent = 'All changes saved locally';
    storageWarned = false;
}
catch {
    $('#save-status').textContent = 'Local save unavailable — download your project';
    if (!storageWarned) {
        toast('Local autosave unavailable. Use Save to download your editable project.', true);
        storageWarned = true;
    }
} }, 400); }
history.addEventListener('change', () => { selected = new Set([...selected].filter(id => history.doc.bodies.some(b => b.id === id))); if (!activeBody()?.features.some(f => f.id === selectedFeature))
    selectedFeature = null; renderer.selected = selected; renderDocument(); rebuild().catch(() => { }); autosave(); });
const meta = {
    sketch: ['Create sketch', 'sketch', 'S'], pad: ['Pad / extrude', 'pad', ''], pocket: ['Pocket', 'pocket', ''], hole: ['Hole', 'hole', 'H'], shaft: ['Shaft / revolve', 'shaft', ''], groove: ['Revolved groove', 'shaft', ''], cylinder: ['Cylinder', 'hole', ''], sphere: ['Sphere', 'sphere', ''], pattern: ['Feature pattern', 'pattern', ''], boolean: ['Boolean bodies', 'union', ''], union: ['Boolean union', 'union', ''], subtract: ['Boolean subtract', 'cut', ''], intersect: ['Boolean intersect', 'intersect', ''], transform: ['Transform body', 'move', 'T'], duplicate: ['Duplicate body', 'copy', 'Ctrl D'], material: ['Assign material', 'material', ''], section: ['Section view', 'section', 'C'], measure: ['Measure distance', 'ruler', 'M'], explode: ['Exploded view', 'explode', 'E'], bom: ['Export bill of materials', 'document', ''], drawing: ['Export SVG projections', 'document', ''], new: ['New product', 'new', 'Ctrl N'], open: ['Open project / import STL', 'folder', 'Ctrl O'], save: ['Save editable project', 'save', 'Ctrl S'], undo: ['Undo', 'undo', 'Ctrl Z'], redo: ['Redo', 'redo', 'Ctrl Shift Z'], fit: ['Fit all', 'fit', 'F'], iso: ['Isometric view', 'cube', '0'], front: ['Front view', 'cube', '1'], top: ['Top view', 'cube', '2'], right: ['Right view', 'cube', '3'], projection: ['Perspective / orthographic', 'camera', 'P'], grid: ['Toggle grid', 'grid', 'G'], dimensions: ['Toggle dimensions', 'ruler', ''], 'render-mode': ['Cycle rendering style', 'cube', ''], screenshot: ['Export PNG image', 'camera', ''], stl: ['Export binary STL', 'export', ''], obj: ['Export OBJ mesh', 'export', ''], delete: ['Delete selection', 'trash', 'Del'], 'show-all': ['Show all bodies', 'eye', ''], 'hide': ['Hide selected bodies', 'hide', 'Space'], help: ['Workbench guide', 'info', '?'], demo: ['Load example assembly', 'cube', ''], rebuild: ['Rebuild geometry', 'settings', ''], 'edit-sketch': ['Edit profile sketch', 'sketch', ''], 'edit-feature': ['Edit selected feature', 'settings', ''], 'suppress': ['Suppress / restore feature', 'eye', '']
};
const ribbonSpecs = {
    part: [['Profile', [['sketch', 'Sketch']]], ['Sketch-based features', [['pad', 'Pad'], ['pocket', 'Pocket'], ['shaft', 'Shaft'], ['groove', 'Groove'], ['hole', 'Hole']]], ['Primitives', [['cylinder', 'Cylinder'], ['sphere', 'Sphere']]], ['Transformations', [['pattern', 'Pattern'], ['transform', 'Transform'], ['duplicate', 'Duplicate']]], ['Solid operations', [['boolean', 'Boolean'], ['material', 'Material']]], ['Analysis', [['section', 'Section'], ['measure', 'Measure']]]],
    assembly: [['Components', [['pad', 'New part'], ['duplicate', 'Duplicate'], ['open', 'Import']]], ['Placement', [['transform', 'Transform'], ['explode', 'Explode']]], ['Solid operations', [['union', 'Union'], ['subtract', 'Subtract'], ['intersect', 'Intersect']]], ['Visualization', [['material', 'Material'], ['section', 'Section'], ['measure', 'Measure']]], ['Documentation', [['bom', 'Bill of materials'], ['drawing', 'Projections'], ['screenshot', 'Capture']]]],
    inspect: [['Analysis', [['measure', 'Measure'], ['section', 'Section'], ['dimensions', 'Dimensions']]], ['Display', [['render-mode', 'Style'], ['grid', 'Grid'], ['explode', 'Explode'], ['material', 'Material']]], ['Orientation', [['iso', 'Isometric'], ['front', 'Front'], ['top', 'Top'], ['fit', 'Fit all']]], ['Documentation', [['bom', 'Bill of materials'], ['drawing', 'Projections'], ['screenshot', 'Capture']]], ['Exchange', [['stl', 'STL'], ['obj', 'OBJ']]]],
    sketch: [['Profiles', [['sketch-rectangle', 'Rectangle', 'rectangle'], ['sketch-circle', 'Circle', 'circle'], ['sketch-polygon', 'Polygon', 'polyline']]], ['Sketch', [['sketch-clear', 'Clear', 'trash'], ['finish-sketch', 'Pad sketch', 'pad'], ['cancel-sketch', 'Exit sketch', 'close']]]]
};
function renderRibbon() { const spec = ribbonSpecs[workbench]; $('#ribbon').innerHTML = spec.map(([label, items]) => `<div class="ribbon-group"><div class="ribbon-actions">${items.map(([cmd, name, ico]) => `<button class="tool${['hole', 'shaft', 'groove', 'material'].includes(cmd) ? ' warm' : ''}" data-command="${cmd}" title="${escape(meta[cmd]?.[0] || name)}${meta[cmd]?.[2] ? ' · ' + meta[cmd][2] : ''}">${icon(ico || meta[cmd]?.[1] || 'cube')}<span>${name}</span></button>`).join('')}</div><span class="ribbon-group-label">${label}</span></div>`).join('') + `<div class="ribbon-note">${icon(workbench === 'sketch' ? 'sketch' : 'cube', 28)}<div><strong>${workbench === 'sketch' ? 'Profile editor' : 'Aureon geometry'}</strong><span>${workbench === 'sketch' ? 'Grid snap · XY plane' : 'Feature-driven · Local-first'}</span></div></div>`; $$('[data-workbench]').forEach(e => { e.classList.toggle('active', e.dataset.workbench === workbench); e.setAttribute('aria-selected', String(e.dataset.workbench === workbench)); }); }
function renderDocument() { const doc = history.doc; $('#document-name').textContent = doc.name; document.title = `${doc.name} — Aureon CAD`; $('#view-subtitle').textContent = `${doc.name.toUpperCase()} / PRODUCT.1`; $('#document-detail').textContent = `${doc.bodies.length} bodies · ${doc.bodies.reduce((s, b) => s + b.features.length, 0)} features`; renderTree(); renderInspector(); renderHistory(); $$('[data-command="undo"]').forEach(b => b.disabled = !history.undoStack.length); $$('[data-command="redo"]').forEach(b => b.disabled = !history.redoStack.length); }
function renderTree() { const doc = history.doc, query = $('#tree-filter').value.toLowerCase().trim(); let html = `<div class="tree-row root${!selected.size ? ' selected' : ''}" role="treeitem" data-root="true"><button class="expander${rootCollapsed ? '' : ' open'}" data-root-expand="true" title="Toggle product">${icon('chevron', 10)}</button><span class="tree-icon">${icon('cube', 15)}</span><span class="tree-text">${escape(doc.name)}</span><span class="tree-marker"></span></div>`; if (!rootCollapsed || query) {
    if (!query)
        for (const p of ['XY plane', 'YZ plane', 'ZX plane'])
            html += `<div class="tree-row plane" style="padding-left:33px" data-plane="${p}" title="Double-click to orient the camera"><span class="tree-icon">${icon('plane', 13)}</span><span>${p}</span></div>`;
    for (const b of doc.bodies) {
        const matches = b.name.toLowerCase().includes(query), filtered = b.features.filter(f => f.name.toLowerCase().includes(query));
        if (query && !matches && !filtered.length)
            continue;
        const open = !collapsed.has(b.id) || !!query;
        html += `<div class="tree-row body${selected.has(b.id) ? ' selected' : ''}${b.visible ? '' : ' hidden-body'}" role="treeitem" aria-selected="${selected.has(b.id)}" data-body="${b.id}" style="padding-left:20px"><button class="expander${open ? ' open' : ''}" data-expand="${b.id}" title="Toggle feature history">${icon('chevron', 10)}</button><span class="tree-icon">${icon('cube', 15)}</span><span class="tree-text">${escape(b.name)}</span><button class="tree-visibility" data-visible="${b.id}" title="${b.visible ? 'Hide' : 'Show'} body">${icon(b.visible ? 'eye' : 'hide', 13)}</button></div>`;
        if (open)
            for (const f of b.features) {
                if (query && !matches && !f.name.toLowerCase().includes(query))
                    continue;
                html += `<div class="tree-row feature${selectedFeature === f.id ? ' selected' : ''}${f.suppressed ? ' suppressed' : ''}" role="treeitem" data-body="${b.id}" data-feature="${f.id}" style="padding-left:49px" title="${escape(f.name)} — double-click to edit"><span class="tree-icon">${icon(meta[f.type]?.[1] || 'cube', 13)}</span><span class="tree-text">${escape(f.name)}</span></div>`;
            }
    }
} $('#tree').innerHTML = html; }
function selectBody(id, { featureId = null, append = false, hit = null } = {}) { if (!append)
    selected.clear(); if (id) {
    if (append && selected.has(id))
        selected.delete(id);
    else
        selected.add(id);
} selectedFeature = featureId; lastHit = hit; renderer.selected = selected; renderer.invalidate(); $('#selection-status').textContent = selected.size ? `${selected.size} ${selected.size === 1 ? 'body' : 'bodies'} selected` : 'No selection'; renderTree(); renderInspector(); renderHistory(); }
function renderHistory() { const b = activeBody(), items = b ? b.features.map(f => ({ b, f })) : history.doc.bodies.flatMap(b => b.features.map(f => ({ b, f }))); $('#history-summary').textContent = b ? `${b.features.length} features · ${b.name}` : `${items.length} features · ${history.doc.bodies.length} bodies`; $('#history-track').innerHTML = items.map(({ b, f }) => `<button class="history-item${f.id === selectedFeature ? ' selected' : ''}${f.suppressed ? ' suppressed' : ''}" data-history-body="${b.id}" data-history-feature="${f.id}" title="${escape(b.name + ' / ' + f.name)}">${icon(meta[f.type]?.[1] || 'cube', 18)}</button>`).join(''); }
function propertySection(title, html) { return `<section class="property-section"><h3>${title}</h3>${html}</section>`; }
function propRow(label, value) { return `<div class="property-row"><span>${label}</span><strong>${value}</strong></div>`; }
function numberProp(key, label, value, { min = -10000, max = 10000, step = .1 } = {}) { return `<div class="property-input inline"><label for="prop-${key}">${label}</label><input id="prop-${key}" type="number" data-param="${key}" value="${Number(value ?? 0)}" min="${min}" max="${max}" step="${step}"></div>`; }
function meshFor(b) { return renderer?.objects.get(b?.id); }
function statsForDocument() { let triangles = 0, volume = 0, area = 0, mass = 0; for (const b of history.doc.bodies) {
    const s = meshFor(b)?.stats;
    if (!s)
        continue;
    triangles += s.triangles;
    volume += s.volume;
    area += s.area;
    mass += s.volume * (MATERIALS[b.material]?.density || .0027);
} return { triangles, volume, area, mass }; }
function renderInspector() {
    if (sketcher?.active) {
        renderSketchInspector();
        return;
    }
    const b = activeBody(), f = activeFeature();
    $('#inspector-title').textContent = measuring ? 'Measurement' : f ? 'Feature properties' : b ? 'Part properties' : 'Product properties';
    if (measuring) {
        let html = `<div class="inspector-hero"><div class="product-symbol">${icon('ruler')}</div><h3>Point-to-point distance</h3><p>Pick two surface points in the viewport. A third pick starts a new measurement.</p></div>`;
        if (measurements.length === 2) {
            const delta = V.sub(measurements[1], measurements[0]);
            html += propertySection('Measured distance', `<div class="measure-result">${fmt(V.len(delta), 3)} <small>mm</small></div>${delta.map((x, i) => propRow('Δ' + ['X', 'Y', 'Z'][i], `${fmt(Math.abs(x), 3)} mm`)).join('')}<p class="property-note">Distance between picked tessellated surface points; not a minimum-distance calculation.</p>`);
        }
        html += propertySection('Surface points', measurements.length ? measurements.map((p, i) => `<div class="measurement-point"><strong>Point ${i + 1}</strong><br>X ${fmt(p[0], 3)} · Y ${fmt(p[1], 3)} · Z ${fmt(p[2], 3)}</div>`).join('') : '<p class="property-note">No points selected.</p>');
        html += `<div class="property-section"><button class="primary" data-command="measure">Finish measurement</button></div>`;
        $('#inspector').innerHTML = html;
        return;
    }
    if (!b) {
        const stats = statsForDocument(), doc = history.doc;
        $('#inspector').innerHTML = `<div class="inspector-hero"><div class="product-symbol">${icon('cube')}</div><h3>${escape(doc.name)}</h3><p>Mechanical product · ${doc.bodies.length} components</p><div class="inspector-status"><span class="green-dot"></span> Feature-based assembly</div></div>` + propertySection('Overview', `<div class="metric-grid"><div class="metric"><strong>${doc.bodies.length}</strong><small>Solid bodies</small></div><div class="metric"><strong>${doc.bodies.reduce((s, b) => s + b.features.length, 0)}</strong><small>Design features</small></div></div>`) + propertySection('Product information', propRow('Document', 'Product.1') + propRow('Design method', 'Parametric CSG') + propRow('Length unit', 'Millimeters') + propRow('Angle unit', 'Degrees') + propRow('Storage', 'Local workspace')) + propertySection('Mass properties', propRow('Total volume', `${fmt(stats.volume / 1000, 1)} cm³`) + propRow('Total mass', `${fmt(stats.mass / 1000, 3)} kg`) + propRow('Surface area', `${fmt(stats.area / 100, 1)} cm²`) + `<p class="property-note">Approximate, tessellated geometry. Component volumes are summed; overlapping parts are not fused.</p>`) + `<div class="tip-card"><h4>${icon('info')} Designed to be explored</h4><p>Select a part to inspect its features. Double-click a feature in the tree to change its dimensions and rebuild the model.</p></div>`;
        return;
    }
    const mesh = meshFor(b), s = mesh?.stats, mat = MATERIALS[b.material], ext = mesh ? V.sub(mesh.bounds.max, mesh.bounds.min) : [0, 0, 0];
    let html = `<div class="inspector-hero"><div class="product-symbol">${icon(f ? meta[f.type]?.[1] || 'cube' : 'cube')}</div><h3>${escape(f?.name || b.name)}</h3><p>${f ? escape(b.name) + ' / ' + escape(f.type.toUpperCase()) : `${b.features.length} parametric features · ${b.visible ? 'Visible' : 'Hidden'}`}</p><div class="inspector-status"><span class="green-dot"></span> ${f?.suppressed ? 'Feature suppressed' : 'Up-to-date geometry'}</div></div>`;
    if (f) {
        html += propertySection('Feature definition', `<div class="property-input"><label>Name</label><input data-feature-name value="${escape(f.name)}"></div>` + featurePropertyInputs(f) + `<div class="property-input"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" data-suppression ${f.suppressed ? 'checked' : ''}> Suppressed</label></div><div class="inspector-buttons"><button data-command="edit-feature">${icon('settings')} Edit definition</button>${['pad', 'pocket'].includes(f.type) ? `<button data-command="edit-sketch">${icon('sketch')} Edit sketch</button>` : ''}<button data-command="delete">${icon('trash')} Delete feature</button></div>`);
    }
    html += propertySection('Part identity', `<div class="property-input"><label>Part name</label><input data-body-name value="${escape(b.name)}"></div><div class="property-input"><label>Material</label><select data-material>${Object.entries(MATERIALS).map(([k, v]) => `<option value="${k}"${k === b.material ? ' selected' : ''}>${v.name}</option>`).join('')}</select></div><div class="material-sample"><span class="material-sphere" style="background:radial-gradient(circle at 28% 24%,white,${mat.color} 48%,#293b50)"></span><div><strong>${mat.name}</strong><small>Density ${fmt(mat.density * 1000, 2)} g/cm³</small></div></div>`);
    html += propertySection('Placement · mm', `<div class="transform-grid">${['X', 'Y', 'Z'].map((a, i) => `<label class="axis-${a.toLowerCase()}">${a}<input type="number" data-position="${i}" step="1" min="-10000" max="10000" value="${b.position[i]}"></label>`).join('')}</div><div class="inspector-buttons"><button data-command="transform">${icon('move')} Transform</button><button data-command="duplicate">${icon('copy')} Duplicate</button><button data-command="hide">${icon('hide')} Hide</button></div>`);
    if (s)
        html += propertySection('Geometric properties', propRow('Bounding X', `${fmt(ext[0])} mm`) + propRow('Bounding Y', `${fmt(ext[1])} mm`) + propRow('Bounding Z', `${fmt(ext[2])} mm`) + propRow('Volume', `${fmt(s.volume / 1000, 2)} cm³`) + propRow('Mass', `${fmt(s.volume * mat.density, 2)} g`) + propRow('Triangles', fmt(s.triangles, 0)) + `<p class="property-note">Local-space bounds and approximate mesh-derived mass properties.</p>`);
    $('#inspector').innerHTML = html;
}
function featurePropertyInputs(f) { const p = f.params; let html = ''; if (['pad', 'pocket', 'box'].includes(f.type)) {
    if (p.shape !== 'polygon' && p.shape !== 'circle') {
        html += numberProp('width', 'Width · mm', p.width, { min: .1 }) + numberProp('depth', 'Depth · mm', p.depth, { min: .1 }) + numberProp(p.corner !== undefined ? 'corner' : 'radius', 'Corner radius · mm', p.corner ?? p.radius ?? 0, { min: 0 });
    }
    else if (p.shape === 'circle')
        html += numberProp('radius', 'Radius · mm', p.radius, { min: .1 });
    html += numberProp('height', 'Length · mm', p.height, { min: .1 });
}
else if (['hole', 'cylinder', 'sphere'].includes(f.type)) {
    html += numberProp('radius', 'Radius · mm', p.radius, { min: .1 });
    if (f.type !== 'sphere')
        html += numberProp('height', 'Length · mm', p.height, { min: .1 });
}
else if (['shaft', 'groove'].includes(f.type)) {
    html += numberProp('radius', 'Outer radius · mm', p.radius, { min: .1 }) + numberProp('height', 'Length · mm', p.height, { min: .1 });
    if (!p.profile)
        html += numberProp('innerRadius', 'Inner radius · mm', p.innerRadius || 0, { min: 0 });
    html += numberProp('angle', 'Angle · °', p.angle || 360, { min: 1, max: 360, step: 1 });
}
else if (f.type === 'pattern') {
    html += numberProp('count', 'Instance count', p.count, { min: 2, max: 64, step: 1 });
    if (!p.circular)
        for (const k of ['dx', 'dy', 'dz'])
            html += numberProp(k, k.toUpperCase() + ' · mm', p[k] || 0);
} return html; }
function renderSketchInspector() { const p = sketcher.profile; let html = `<div class="inspector-hero"><div class="product-symbol">${icon('sketch')}</div><h3>${editingSketch ? 'Edit profile' : 'New sketch'}</h3><p>XY profile editor · millimeters</p><div class="inspector-status"><span class="green-dot"></span> ${p ? 'Closed profile' : sketcher.points.length ? `${sketcher.points.length} polygon vertices` : 'Draw a closed profile'}</div></div>`; if (p) {
    let fields = '';
    const values = p.shape === 'rectangle' ? [['width', 'Width'], ['depth', 'Height'], ['corner', 'Corner radius'], ['x', 'Center X'], ['y', 'Center Y']] : p.shape === 'circle' ? [['radius', 'Radius'], ['x', 'Center X'], ['y', 'Center Y']] : [];
    for (const [k, label] of values)
        fields += `<div class="property-input inline"><label>${label} · mm</label><input type="number" step="any" data-sketch-param="${k}" value="${p[k] || 0}" ${['width', 'depth', 'radius'].includes(k) ? 'min="0.1"' : ''}></div>`;
    html += propertySection('Profile dimensions', fields || `<p class="property-note">${p.points.length} polygon vertices. Clear and redraw to change the topology.</p>`);
    html += `<div class="property-section"><button class="primary" data-command="finish-sketch">${editingSketch ? 'Apply profile' : 'Pad this sketch'} ${icon('pad', 16)}</button></div>`;
} html += `<div class="tip-card"><h4>${icon('info')} Sketch interactions</h4><p>Rectangle / circle: drag two points.<br>Polygon: click vertices; click the first point or press Enter to close.<br>Shift: square or orthogonal segment.<br>Grid snapping: 1 mm.<br>This editor does not solve general dimensional constraints.</p></div><div class="property-section"><button data-command="cancel-sketch">Cancel sketch</button></div>`; $('#inspector-title').textContent = 'Sketch properties'; $('#inspector').innerHTML = html; }
let editChain = Promise.resolve();
function applyChecked(label, mutate) { editChain = editChain.then(async () => { const draft = structuredClone(history.doc); mutate(draft); validateDocument(draft); if (JSON.stringify(draft) === JSON.stringify(history.doc)) {
    if ($('#tree-state').textContent === 'Feature preview')
        await rebuild(history.doc, { quiet: true });
    return true;
} await rebuild(draft, { preview: true, quiet: true }); history.commit(label, d => Object.assign(d, draft)); return true; }).catch(e => { report(e); rebuild(history.doc, { quiet: true }).catch(() => { }); return false; }); return editChain; }
function changedParams(old, updates) { const p = { ...structuredClone(old), ...updates }; if (old.profile) {
    const sx = (p.radius || old.radius) / (old.radius || p.radius), sy = (p.height || old.height) / (old.height || p.height);
    p.profile = old.profile.map(([r, z]) => [r * sx, z * sy]);
} validateParams(p); return p; }
function validateParams(p) { for (const key of ['width', 'depth', 'height', 'radius'])
    if (p[key] !== undefined && (!Number.isFinite(p[key]) || p[key] <= 0))
        throw Error(`${key} must be a positive number`); if (p.corner !== undefined && (p.corner < 0 || p.corner > Math.min(p.width || Infinity, p.depth || Infinity) / 2))
    throw Error('Corner radius must be between zero and half the smaller profile dimension'); if (p.innerRadius !== undefined && (p.innerRadius < 0 || p.innerRadius >= p.radius))
    throw Error('Inner radius must be smaller than the outer radius'); if (p.points && p.points.length < 3)
    throw Error('A closed polygon needs at least three vertices'); }
function formField(name, label, value, { type = 'number', min = -10000, max = 10000, step = 'any', wide = false, options = null, checked = false } = {}) { return `<div class="form-field${wide ? ' wide' : ''}${type === 'checkbox' ? ' check-field' : ''}">${type === 'checkbox' ? `<input id="op-${name}" name="${name}" type="checkbox" ${checked ? 'checked' : ''}><label for="op-${name}">${label}</label>` : `<label for="op-${name}">${label}</label>${options ? `<select name="${name}" id="op-${name}">${options.map(([v, l]) => `<option value="${escape(v)}"${String(v) === String(value) ? ' selected' : ''}>${escape(l)}</option>`).join('')}</select>` : `<input name="${name}" id="op-${name}" type="${type}" value="${escape(value ?? '')}" ${type === 'number' ? `min="${min}" max="${max}" step="${step}"` : ''} required>`}`}</div>`; }
function openFeature(type, { edit = false, params = null, name = null } = {}) {
    if (sketcher.active) {
        toast('Finish or cancel the sketch first.');
        return;
    }
    const b = activeBody(), f = edit ? activeFeature() : null;
    if (edit && !f)
        return;
    if (['pocket', 'hole', 'groove', 'pattern', 'boolean'].includes(type) && !b) {
        toast('Select a solid body first.', true);
        return;
    }
    if (type === 'boolean' && history.doc.bodies.length < 2) {
        toast('A body Boolean requires at least two bodies.', true);
        return;
    }
    if (f?.type === 'mesh') {
        toast('Imported STL is a mesh feature. Transform the body or apply Boolean features to edit it.');
        return;
    }
    const mesh = meshFor(b), box = mesh?.bounds || { min: [-20, -15, 0], max: [20, 15, 20] }, center = V.mul(V.add(box.min, box.max), .5);
    let p;
    if (f) {
        type = f.type;
        p = structuredClone(f.params);
    }
    else if (['pad', 'pocket'].includes(type)) {
        p = { shape: 'rectangle', width: 40, depth: 30, corner: type === 'pocket' ? 3 : 2, height: type === 'pocket' ? Math.max(1, box.max[2] - box.min[2] + 2) : 20, x: 0, y: 0, z: type === 'pocket' ? box.min[2] - 1 : b ? box.max[2] : 0 };
    }
    else if (['hole', 'cylinder'].includes(type)) {
        let axis = 'Z', pos = [0, 0, type === 'hole' ? box.min[2] - 1 : 0], height = type === 'hole' ? box.max[2] - box.min[2] + 2 : 30;
        if (type === 'hole' && lastHit?.body.id === b.id) {
            const normal = lastHit.normal.map(Math.abs), index = normal.indexOf(Math.max(...normal));
            axis = ['X', 'Y', 'Z'][index];
            pos = [...lastHit.point];
            pos[index] = box.min[index] - 1;
            height = box.max[index] - box.min[index] + 2;
        }
        p = { radius: type === 'hole' ? 5 : 15, height, x: pos[0], y: pos[1], z: pos[2], axis, segments: 48 };
    }
    else if (type === 'sphere')
        p = { radius: 20, x: 0, y: 0, z: 20, segments: 40, rings: 20 };
    else if (['shaft', 'groove'].includes(type))
        p = { radius: 25, innerRadius: 12, height: 30, angle: 360, x: 0, y: 0, z: type === 'groove' ? box.min[2] - 1 : 0, segments: 64 };
    else if (type === 'pattern') {
        const source = activeFeature() && !['pattern', 'boolean'].includes(activeFeature().type) ? activeFeature() : b.features.findLast(f => !['pattern', 'boolean'].includes(f.type));
        if (!source) {
            toast('The body has no repeatable feature.', true);
            return;
        }
        p = { source: source.id, count: 3, dx: 25, dy: 0, dz: 0, circular: false, angle: 360 };
    }
    else if (type === 'boolean')
        p = { tool: [...selected].find(id => id !== b.id) || history.doc.bodies.find(other => other.id !== b.id).id, operation: 'union', hideTool: true };
    else
        return;
    if (params)
        p = { ...p, ...params };
    operation = { mode: 'feature', type, bodyId: b?.id || null, featureId: f?.id || uid(), newBodyId: uid(), edit: !!f, params: p, originalParams: structuredClone(p), name: f?.name || name || `${type[0].toUpperCase() + type.slice(1)}.${(b?.features.length || 0) + 1}`, newBody: !b || ['sphere', 'cylinder'].includes(type), id: uid() };
    renderOperation();
    $('#operation-dialog').showModal();
    if (['boolean'].includes(type))
        $('#live-preview').checked = false;
    else
        $('#live-preview').checked = true;
    requestPreview();
}
function renderOperation() {
    const op = operation;
    if (!op)
        return;
    $('#operation-title').textContent = op.mode === 'transform' ? 'Transform component' : op.mode === 'rename' ? 'Rename product' : `${op.type[0].toUpperCase() + op.type.slice(1)} definition`;
    $('#operation-icon').innerHTML = icon(op.mode === 'transform' ? 'move' : op.mode === 'rename' ? 'document' : meta[op.type]?.[1] || 'cube', 24);
    $('#operation-error').textContent = '';
    $('#operation-submit').textContent = op.edit || op.mode !== 'feature' ? 'Apply changes' : 'Create feature';
    let html = '', p = op.params || {};
    if (op.mode === 'rename') {
        html = formField('name', 'Product name', op.name, { type: 'text', wide: true });
    }
    else if (op.mode === 'transform') {
        html = '<div class="form-group-title">Translation · world coordinates</div>';
        for (let i = 0; i < 3; i++)
            html += formField('p' + i, ['X', 'Y', 'Z'][i] + ' · mm', p.position[i]);
        html += '<div class="form-group-title">Rotation · intrinsic XYZ</div>';
        for (let i = 0; i < 3; i++)
            html += formField('r' + i, ['X', 'Y', 'Z'][i] + ' · °', p.rotation[i], { min: -360, max: 360 });
    }
    else {
        html = formField('name', 'Feature name', op.name, { type: 'text', wide: true });
        if (['pad', 'pocket'].includes(op.type)) {
            html += formField('shape', 'Profile', p.shape, { wide: true, options: [['rectangle', 'Rectangle / rounded rectangle'], ['circle', 'Circle'], ...(p.points ? [['polygon', `Closed polygon · ${p.points.length} vertices`]] : [])] });
            if (p.shape === 'rectangle') {
                html += formField('width', 'Width · mm', p.width, { min: .1 }) + formField('depth', 'Depth · mm', p.depth, { min: .1 }) + formField('corner', 'Corner radius · mm', p.corner || 0, { min: 0 });
            }
            if (p.shape === 'circle')
                html += formField('radius', 'Radius · mm', p.radius || 15, { min: .1 });
            html += formField('height', op.type === 'pad' ? 'Pad length · mm' : 'Pocket depth · mm', p.height, { min: .1 });
        }
        if (['hole', 'cylinder', 'sphere', 'shaft', 'groove'].includes(op.type)) {
            html += formField('radius', op.type === 'shaft' || op.type === 'groove' ? 'Outer radius · mm' : 'Radius · mm', p.radius, { min: .1 });
            if (op.type !== 'sphere')
                html += formField('height', 'Length · mm', p.height, { min: .1 });
            if (['hole', 'cylinder'].includes(op.type))
                html += formField('axis', 'Axis', p.axis, { options: [['Z', 'Z axis'], ['Y', 'Y axis'], ['X', 'X axis']] });
            if (['shaft', 'groove'].includes(op.type)) {
                if (!p.profile)
                    html += formField('innerRadius', 'Inner radius · mm', p.innerRadius || 0, { min: 0 });
                html += formField('angle', 'Revolution angle · °', p.angle || 360, { min: 1, max: 360 });
            }
        }
        if (op.type === 'pattern') {
            const b = history.doc.bodies.find(b => b.id === op.bodyId);
            html += formField('source', 'Source feature', p.source, { wide: true, options: b.features.filter(f => !['pattern', 'boolean'].includes(f.type)).map(f => [f.id, f.name]) }) + formField('count', 'Instances (including original)', p.count, { min: 2, max: 64, step: 1 }) + formField('circular', 'Circular around local Z', null, { type: 'checkbox', checked: p.circular }) + formField('dx', 'Linear spacing X · mm', p.dx) + formField('dy', 'Linear spacing Y · mm', p.dy) + formField('dz', 'Linear spacing Z · mm', p.dz) + formField('angle', 'Circular sweep · °', p.angle, { min: 1, max: 360 });
        }
        if (op.type === 'boolean') {
            html += formField('operation', 'Boolean operation', p.operation, { wide: true, options: [['union', 'Union — add tool volume'], ['subtract', 'Subtract — remove tool volume'], ['intersect', 'Intersect — keep common volume']] }) + formField('tool', 'Tool body', p.tool, { wide: true, options: history.doc.bodies.filter(b => b.id !== op.bodyId).map(b => [b.id, b.name]) }) + formField('hideTool', 'Hide tool body after operation', null, { type: 'checkbox', wide: true, checked: p.hideTool ?? true });
        }
        if (!['pattern', 'boolean', 'mesh'].includes(op.type)) {
            html += '<div class="form-group-title">Feature placement · body coordinates</div>';
            for (const key of ['x', 'y', 'z'])
                html += formField(key, key.toUpperCase() + ' · mm', p[key] || 0);
        }
        if (!op.edit && !['pocket', 'hole', 'groove', 'pattern', 'boolean'].includes(op.type) && op.bodyId)
            html += formField('newBody', 'Create as a new body', null, { type: 'checkbox', wide: true, checked: op.newBody });
    }
    let description = op.mode === 'transform' ? 'Rigid-body placement. Rotation order is local X, Y, then Z. No assembly constraint solver is applied.' : op.mode === 'rename' ? 'This name is stored in the editable project.' : op.type === 'pattern' ? 'Repeat the source feature in the body coordinate system. Cuts remain subtractive.' : op.type === 'boolean' ? 'The selected part is the target. The tool is referenced parametrically; cyclic references are rejected.' : op.type === 'hole' ? 'A true cylindrical material removal. The default length passes through the selected body.' : op.params?.profile ? 'Edit the radius and length to scale the stored revolved profile.' : 'Changes rebuild the polygonal solid. Live preview is temporary until you apply the feature.';
    $('#operation-fields').innerHTML = `<p class="form-description">${description}</p><div class="form-grid">${html}</div>`;
    $('.preview-label').hidden = op.mode === 'rename';
}
function formValues() { const values = {}; for (const el of $('#operation-form').elements) {
    if (!el.name)
        continue;
    values[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
} return values; }
function operationDraft() { const op = operation, v = formValues(), draft = structuredClone(history.doc); if (!op)
    throw Error('No active operation'); if (op.mode === 'rename') {
    draft.name = String(v.name).trim() || 'Untitled product';
    return draft;
} if (op.mode === 'transform') {
    const b = draft.bodies.find(b => b.id === op.bodyId);
    b.position = [v.p0, v.p1, v.p2];
    b.rotation = [v.r0, v.r1, v.r2];
    return draft;
} const { name, newBody, ...updates } = v; let p = changedParams(op.originalParams, updates); const f = { id: op.featureId, type: op.type, name: String(name).trim() || op.name, params: p, suppressed: false }; if (op.edit) {
    const b = draft.bodies.find(b => b.id === op.bodyId), index = b.features.findIndex(f => f.id === op.featureId);
    f.suppressed = b.features[index].suppressed;
    b.features[index] = f;
}
else if (newBody || !op.bodyId) {
    const b = body(name?.trim() || 'Part', [f]);
    b.id = op.newBodyId;
    draft.bodies.push(b);
}
else {
    draft.bodies.find(b => b.id === op.bodyId).features.push(f);
} if (op.type === 'boolean' && p.hideTool)
    draft.bodies.find(b => b.id === p.tool).visible = false; validateDocument(draft); return draft; }
function requestPreview() { clearTimeout(previewTimer); if (!operation || !$('#live-preview').checked || operation.mode === 'rename')
    return; previewTimer = setTimeout(() => { if (!operation || !$('#operation-form').checkValidity())
    return; try {
    const draft = operationDraft();
    $('#operation-error').textContent = '';
    rebuild(draft, { preview: true, quiet: true }).catch(e => { if (operation)
        $('#operation-error').textContent = e.message; });
}
catch (e) {
    $('#operation-error').textContent = e.message;
} }, 260); }
function closeOperation() { clearTimeout(previewTimer); const had = !!operation; operation = null; $('#operation-dialog').close(); if (had)
    rebuild(history.doc, { quiet: true }).catch(() => { }); }
function openTransform() { const b = activeBody(); if (!b) {
    toast('Select a component to transform.', true);
    return;
} operation = { mode: 'transform', bodyId: b.id, params: { position: [...b.position], rotation: [...b.rotation] }, edit: true, id: uid() }; renderOperation(); $('#operation-dialog').showModal(); $('#live-preview').checked = true; }
function startSketch(edit = false) { if (operation)
    closeOperation(); const f = edit ? activeFeature() : null; if (edit && (!f || !['pad', 'pocket'].includes(f.type))) {
    toast('Select a Pad or Pocket feature to edit its profile.', true);
    return;
} editingSketch = f ? { bodyId: activeBody().id, featureId: f.id } : null; workbench = 'sketch'; measuring = false; measurements = []; sketcher.begin(f?.params || null); $('#sketch-hint').hidden = false; renderRibbon(); renderInspector(); renderer.invalidate(); }
function cancelSketch() { sketcher.end(); editingSketch = null; workbench = 'part'; $('#sketch-hint').hidden = true; renderRibbon(); renderInspector(); renderer.invalidate(); }
function finishSketch() { if (!sketcher.profile) {
    if (sketcher.points.length >= 3)
        sketcher.closePolygon();
    else {
        toast('Draw a closed rectangle, circle, or polygon first.', true);
        return;
    }
} const p = structuredClone(sketcher.profile), edit = editingSketch; sketcher.end(); editingSketch = null; workbench = 'part'; $('#sketch-hint').hidden = true; renderRibbon(); renderInspector(); if (edit)
    applyChecked('Edit profile', d => { const f = d.bodies.find(b => b.id === edit.bodyId)?.features.find(f => f.id === edit.featureId); if (f)
        f.params = { ...f.params, ...p }; });
else
    openFeature('pad', { params: p, name: 'Pad · Sketch.1' }); }
function removeSelection() { const b = activeBody(), f = activeFeature(); if (!b)
    return; if (f) {
    const id = f.id;
    applyChecked('Delete feature', doc => { const body = doc.bodies.find(x => x.id === b.id); body.features = body.features.filter(x => x.id !== id && !(x.type === 'pattern' && x.params.source === id)); });
    selectedFeature = null;
}
else {
    const ids = new Set(selected);
    applyChecked('Delete bodies', doc => { doc.bodies = doc.bodies.filter(b => !ids.has(b.id)); for (const body of doc.bodies)
        body.features = body.features.filter(f => !(f.type === 'boolean' && ids.has(f.params.tool))); });
    selected.clear();
} }
function duplicateSelection() { if (!selected.size) {
    toast('Select one or more components to duplicate.', true);
    return;
} const originals = history.doc.bodies.filter(b => selected.has(b.id)), map = new Map(); for (const b of originals) {
    map.set(b.id, uid());
    for (const f of b.features)
        map.set(f.id, uid());
} const copies = originals.map(b => { const copy = structuredClone(b); copy.id = map.get(b.id); copy.name = b.name + ' · copy'; copy.position[0] += 25; copy.position[1] += 20; copy.visible = true; for (const f of copy.features) {
    f.id = map.get(f.id);
    if (f.params.source)
        f.params.source = map.get(f.params.source) || f.params.source;
    if (f.params.tool)
        f.params.tool = map.get(f.params.tool) || f.params.tool;
} return copy; }); applyChecked('Duplicate bodies', doc => doc.bodies.push(...copies)).then(success => { if (!success)
    return; selected = new Set(copies.map(b => b.id)); selectedFeature = null; renderer.selected = selected; renderDocument(); renderer.invalidate(); }); }
function setView(view) { renderer.camera.preset(view); renderer.invalidate(); $('#view-title').textContent = ({ iso: 'Isometric', front: 'Front', top: 'Top', right: 'Right', back: 'Back', left: 'Left', bottom: 'Bottom' }[view] || view) + ' view'; }
function setWorkbench(next) { if (next === 'sketch') {
    startSketch(false);
    return;
} if (sketcher.active)
    cancelSketch(); workbench = next; renderRibbon(); if (next === 'inspect') {
    selectedFeature = null;
    renderInspector();
} }
const menuItems = {
    file: [['new', 'New product'], ['open', 'Open / import…'], ['save', 'Save project'], null, ['stl', 'Export STL'], ['obj', 'Export OBJ'], ['drawing', 'Export SVG projections'], ['screenshot', 'Export viewport PNG'], ['bom', 'Export bill of materials'], null, ['demo', 'Load example assembly']],
    edit: [['undo', 'Undo'], ['redo', 'Redo'], null, ['edit-feature', 'Edit feature…'], ['edit-sketch', 'Edit profile sketch'], ['transform', 'Transform body…'], ['duplicate', 'Duplicate selection'], ['delete', 'Delete selection']],
    view: [['fit', 'Fit all'], ['iso', 'Isometric'], ['front', 'Front'], ['top', 'Top'], ['right', 'Right'], null, ['projection', 'Perspective / orthographic'], ['render-mode', 'Cycle rendering style'], ['grid', 'Show / hide grid'], ['dimensions', 'Show / hide dimensions'], ['show-all', 'Show all bodies'], ['hide', 'Hide selection']],
    insert: [['sketch', 'Sketch'], ['pad', 'Pad'], ['pocket', 'Pocket'], ['hole', 'Hole'], ['shaft', 'Shaft'], ['groove', 'Groove'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['pattern', 'Feature pattern'], ['boolean', 'Boolean bodies']],
    tools: [['measure', 'Measure distance'], ['section', 'Section view'], ['explode', 'Exploded view'], ['material', 'Assign material'], ['rebuild', 'Rebuild geometry'], null, ['help', 'Workbench guide']]
};
function showMenu(items, x, y) { const popup = $('#menu-popup'); popup.innerHTML = items.map(item => item ? `<button data-command="${item[0]}">${icon(meta[item[0]]?.[1] || 'cube', 15)}<span>${item[1]}</span><small>${meta[item[0]]?.[2] || ''}</small></button>` : '<hr>').join(''); popup.hidden = false; popup.style.left = Math.min(x, innerWidth - 250) + 'px'; popup.style.top = Math.min(y, innerHeight - popup.offsetHeight - 8) + 'px'; }
let paletteIndex = 0;
function renderPalette() { const query = $('#command-search').value.toLowerCase(); const items = Object.entries(meta).filter(([cmd, [name]]) => (cmd + ' ' + name).toLowerCase().includes(query)); paletteIndex = Math.max(0, Math.min(paletteIndex, items.length - 1)); $('#palette-results').innerHTML = items.map(([cmd, [name, ico, key]], i) => `<button class="command-item${i === paletteIndex ? ' selected' : ''}" data-command="${cmd}">${icon(ico, 17)}<span>${name}</span><small>${key}</small></button>`).join(''); $('.command-item.selected')?.scrollIntoView({ block: 'nearest' }); }
async function screenshot() { renderer.render(); const canvas = document.createElement('canvas'), src = renderer.canvas; canvas.width = src.width; canvas.height = src.height; const c = canvas.getContext('2d'), gradient = c.createRadialGradient(canvas.width * .48, canvas.height * .4, 0, canvas.width * .48, canvas.height * .4, Math.max(canvas.width, canvas.height) * .7); gradient.addColorStop(0, '#5e7795'); gradient.addColorStop(.49, '#445b77'); gradient.addColorStop(1, '#2f435d'); c.fillStyle = gradient; c.fillRect(0, 0, canvas.width, canvas.height); c.drawImage(src, 0, 0); c.drawImage($('#overlay'), 0, 0, canvas.width, canvas.height); c.font = `${13 * (window.devicePixelRatio || 1)}px system-ui`; c.fillStyle = '#dbe8fa'; c.fillText('AUREON CAD  /  ' + history.doc.name, 25, 35); canvas.toBlob(blob => { if (blob) {
    download(blob, safeName(history.doc.name) + '.png');
    toast('Viewport exported as PNG.');
}
else
    toast('Image export failed.', true); }, 'image/png'); }
async function execute(cmd) {
    try {
        $('#menu-popup').hidden = true;
        if ($('#palette').open)
            $('#palette').close();
        if (cmd.startsWith('sketch-')) {
            if (!sketcher.active)
                startSketch();
            if (cmd === 'sketch-clear') {
                sketcher.profile = null;
                sketcher.points = [];
                sketcher.draw();
                renderSketchInspector();
            }
            else
                sketcher.setTool(cmd.slice(7));
            return;
        }
        switch (cmd) {
            case 'palette':
                $('#palette').showModal();
                $('#command-search').value = '';
                paletteIndex = 0;
                renderPalette();
                $('#command-search').focus();
                break;
            case 'new':
                if (sketcher.active)
                    cancelSketch();
                history.commit('New product', d => Object.assign(d, emptyDocument()));
                selectBody(null);
                renderer.fit();
                break;
            case 'demo':
                if (sketcher.active)
                    cancelSketch();
                history.commit('Load example assembly', d => Object.assign(d, demoDocument()));
                collapsed = new Set(history.doc.bodies.filter((_, i) => i !== 1).map(b => b.id));
                selectBody(null);
                cameraNeedsFit = true;
                setView('iso');
                renderTree();
                toast('Example assembly loaded. Every body has editable features.');
                break;
            case 'open':
                $('#file-input').click();
                break;
            case 'save':
                await editChain;
                download(projectJSON(history.doc), safeName(history.doc.name) + '.aureon.json', 'application/json');
                toast('Editable project downloaded.');
                break;
            case 'undo':
                await editChain;
                history.undo();
                break;
            case 'redo':
                await editChain;
                history.redo();
                break;
            case 'pad':
            case 'pocket':
            case 'hole':
            case 'shaft':
            case 'groove':
            case 'cylinder':
            case 'sphere':
            case 'pattern':
            case 'boolean':
                openFeature(cmd);
                break;
            case 'union':
            case 'subtract':
            case 'intersect':
                openFeature('boolean', { params: { operation: cmd } });
                break;
            case 'edit-feature':
                if (activeFeature())
                    openFeature(activeFeature().type, { edit: true });
                else
                    toast('Select a feature in the specification tree.');
                break;
            case 'edit-sketch':
                startSketch(true);
                break;
            case 'sketch':
                startSketch();
                break;
            case 'finish-sketch':
                finishSketch();
                break;
            case 'cancel-sketch':
                cancelSketch();
                break;
            case 'transform':
                openTransform();
                break;
            case 'duplicate':
                duplicateSelection();
                break;
            case 'delete':
                removeSelection();
                break;
            case 'material':
                if (!activeBody()) {
                    toast('Select a body to assign its material.', true);
                    break;
                }
                selectedFeature = null;
                renderInspector();
                $('[data-material]')?.focus();
                $('[data-material]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                break;
            case 'suppress': {
                const b = activeBody(), f = activeFeature();
                if (f)
                    applyChecked('Toggle feature suppression', d => { const target = d.bodies.find(x => x.id === b.id).features.find(x => x.id === f.id); target.suppressed = !target.suppressed; });
                break;
            }
            case 'hide':
                if (selected.size)
                    history.commit('Hide bodies', d => d.bodies.forEach(b => { if (selected.has(b.id))
                        b.visible = false; }));
                break;
            case 'show-all':
                history.commit('Show all bodies', d => d.bodies.forEach(b => b.visible = true));
                break;
            case 'fit':
                renderer.fit();
                break;
            case 'iso':
            case 'front':
            case 'top':
            case 'right':
                setView(cmd);
                break;
            case 'zoom-in':
                renderer.camera.zoom(-180);
                renderer.invalidate();
                break;
            case 'zoom-out':
                renderer.camera.zoom(180);
                renderer.invalidate();
                break;
            case 'grid':
                renderer.grid = !renderer.grid;
                $$('[data-command="grid"]').forEach(b => b.classList.toggle('active', renderer.grid));
                renderer.invalidate();
                break;
            case 'projection':
                renderer.camera.perspective = !renderer.camera.perspective;
                $('#projection-label').textContent = renderer.camera.perspective ? 'Perspective' : 'Orthographic';
                $$('[data-command="projection"]').forEach(b => b.classList.toggle('active', renderer.camera.perspective));
                renderer.invalidate();
                break;
            case 'render-mode': {
                const modes = ['edges', 'shaded', 'wireframe', 'xray'];
                renderer.mode = modes[(modes.indexOf(renderer.mode) + 1) % modes.length];
                toast('Display: ' + ({ edges: 'Shaded with edges', shaded: 'Studio shaded', wireframe: 'Wireframe', xray: 'X-ray' }[renderer.mode]));
                renderer.invalidate();
                break;
            }
            case 'dimensions':
                showDimensions = !showDimensions;
                renderer.invalidate();
                break;
            case 'section':
                renderer.section.enabled = !renderer.section.enabled;
                $('#section-control').hidden = !renderer.section.enabled;
                renderer.invalidate();
                if (renderer.section.enabled)
                    toast('Section view clips geometry without creating a cap surface.');
                break;
            case 'explode':
                renderer.exploded = renderer.exploded ? 0 : Number($('#explode-range').value) || 1;
                $('#explode-control').hidden = !renderer.exploded;
                renderer.invalidate();
                break;
            case 'measure':
                measuring = !measuring;
                measurements = [];
                $('#interaction-hint').textContent = measuring ? 'Pick two surface points to measure their distance' : 'Drag to orbit · Right-drag to pan · Scroll to zoom';
                renderInspector();
                renderer.invalidate();
                break;
            case 'select':
            case 'selection-body':
                navMode = 'select';
                if (measuring) {
                    measuring = false;
                    measurements = [];
                    renderInspector();
                }
                $$('.navigation-toolbar button').filter(e => ['select', 'pan', 'orbit'].includes(e.dataset.command)).forEach(e => e.classList.toggle('active', e.dataset.command === 'select'));
                break;
            case 'orbit':
            case 'pan':
                navMode = cmd;
                $$('.navigation-toolbar button').filter(e => ['select', 'pan', 'orbit'].includes(e.dataset.command)).forEach(e => e.classList.toggle('active', e.dataset.command === cmd));
                break;
            case 'stl':
            case 'obj':
                await editChain;
                await lastBuild;
                {
                    const tris = worldTriangles(history.doc, renderer.objects, selected);
                    if (!tris.length) {
                        toast('There are no visible triangles to export.', true);
                        break;
                    }
                    download(cmd === 'stl' ? binarySTL(tris) : objText(tris), safeName(history.doc.name) + '.' + cmd, cmd === 'obj' ? 'text/plain' : 'application/octet-stream');
                    toast(`${fmt(tris.length, 0)} triangles exported in millimeters.`);
                }
                break;
            case 'drawing':
                await editChain;
                download(drawingSVG(history.doc, renderer.objects), safeName(history.doc.name) + '_projections.svg', 'image/svg+xml');
                toast('Three wireframe projections exported as SVG.');
                break;
            case 'bom':
                await editChain;
                download('\ufeff' + bomCSV(history.doc, renderer.objects), safeName(history.doc.name) + '_BOM.csv', 'text/csv;charset=utf-8');
                toast('Bill of materials exported. Mass values are mesh approximations.');
                break;
            case 'screenshot':
                screenshot();
                break;
            case 'rebuild':
                rebuild(history.doc).catch(() => { });
                break;
            case 'collapse-tree':
                collapsed = new Set(history.doc.bodies.map(b => b.id));
                renderTree();
                break;
            case 'rename-document':
                operation = { mode: 'rename', name: history.doc.name, edit: true, id: uid() };
                renderOperation();
                $('#operation-dialog').showModal();
                break;
            case 'close-dialog':
                closeOperation();
                break;
            case 'help':
                $('#help-dialog').showModal();
                break;
            case 'close-help':
                $('#help-dialog').close();
                break;
        }
    }
    catch (e) {
        report(e);
    }
}
function drawOverlay() {
    if (!renderer || sketcher?.active)
        return;
    const canvas = $('#overlay'), rect = $('#viewport').getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), w = rect.width, h = rect.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const project = p => renderer.camera.project(p, w, h);
    const text = (s, x, y, color = '#d1e0f4') => { c.font = '10px system-ui'; const tw = c.measureText(s).width; c.fillStyle = '#2d425ecc'; c.beginPath(); c.roundRect(x - tw / 2 - 5, y - 10, tw + 10, 17, 3); c.fill(); c.fillStyle = color; c.textAlign = 'center'; c.fillText(s, x, y + 2); c.textAlign = 'start'; };
    const dimension = (a, b, label) => { const p = project(a), q = project(b); if (p[2] < 0 || q[2] < 0)
        return; const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy); if (len < 35)
        return; const nx = -dy / len, ny = dx / len; c.lineWidth = .85; c.strokeStyle = '#a0bbd699'; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); for (const r of [p, q]) {
        c.moveTo(r[0] - nx * 4, r[1] - ny * 4);
        c.lineTo(r[0] + nx * 4, r[1] + ny * 4);
    } c.stroke(); for (const [r, sign] of [[p, 1], [q, -1]]) {
        c.fillStyle = '#adcae5b0';
        c.beginPath();
        c.moveTo(r[0], r[1]);
        c.lineTo(r[0] + sign * dx / len * 6 + nx * 2, r[1] + sign * dy / len * 6 + ny * 2);
        c.lineTo(r[0] + sign * dx / len * 6 - nx * 2, r[1] + sign * dy / len * 6 - ny * 2);
        c.fill();
    } text(label, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - 7); };
    if (showDimensions && !measuring && !renderer.section.enabled && !renderer.exploded) {
        const b = activeBody() || history.doc.bodies[0], mesh = meshFor(b);
        if (b?.visible && mesh) {
            const { min, max } = mesh.bounds, m = renderer.matrix(b, mesh);
            dimension(M.point(m, [min[0], min[1] - 12, min[2]]), M.point(m, [max[0], min[1] - 12, min[2]]), `${fmt(max[0] - min[0])} mm`);
            if (activeBody())
                dimension(M.point(m, [max[0] + 10, max[1], min[2]]), M.point(m, [max[0] + 10, max[1], max[2]]), `${fmt(max[2] - min[2])} mm`);
        }
    }
    if (measurements.length) {
        const pts = measurements.map(project);
        c.strokeStyle = '#ffe0a0';
        c.fillStyle = '#ffe0a0';
        c.lineWidth = 1.2;
        for (const p of pts) {
            c.beginPath();
            c.arc(p[0], p[1], 3, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(p[0], p[1], 7, 0, Math.PI * 2);
            c.stroke();
        }
        if (pts.length === 2) {
            c.setLineDash([4, 4]);
            c.beginPath();
            c.moveTo(pts[0][0], pts[0][1]);
            c.lineTo(pts[1][0], pts[1][1]);
            c.stroke();
            c.setLineDash([]);
            text(`${fmt(V.len(V.sub(measurements[1], measurements[0])), 3)} mm`, (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 - 12, '#ffe2ad');
        }
    }
    const origin = [47, h - 88], view = renderer.camera.view;
    const axes = [{ n: 'X', v: [1, 0, 0], color: '#dda5a3' }, { n: 'Y', v: [0, 1, 0], color: '#97c7b3' }, { n: 'Z', v: [0, 0, 1], color: '#98bceb' }].map(a => ({ ...a, d: M.vector(view, a.v) })).sort((a, b) => a.d[2] - b.d[2]);
    c.lineWidth = 1.5;
    for (const a of axes) {
        const x = origin[0] + a.d[0] * 31, y = origin[1] - a.d[1] * 31;
        c.strokeStyle = a.color;
        c.beginPath();
        c.moveTo(...origin);
        c.lineTo(x, y);
        c.stroke();
        c.fillStyle = a.color;
        c.beginPath();
        c.arc(x, y, 2, 0, Math.PI * 2);
        c.fill();
        c.font = '9px system-ui';
        c.fillText(a.n, x + (x < origin[0] ? -11 : 5), y + 3);
    }
    c.fillStyle = '#ccdded';
    c.beginPath();
    c.arc(...origin, 2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#92aac7';
    c.font = '8px system-ui';
    c.fillText('ABS', origin[0] - 9, origin[1] + 33);
    if (renderer.hover && hoverPointer && !modelBusy) {
        const b = history.doc.bodies.find(b => b.id === renderer.hover);
        if (b) {
            c.font = '10px system-ui';
            const width = c.measureText(b.name).width + 17, x = Math.min(w - width - 10, hoverPointer[0] + 17), y = Math.min(h - 95, hoverPointer[1] + 20);
            c.fillStyle = '#f4f8fff0';
            c.beginPath();
            c.roundRect(x, y, width, 24, 4);
            c.fill();
            c.fillStyle = '#405b7b';
            c.fillText(b.name, x + 8, y + 16);
        }
    }
    $('#scale-label').textContent = `${fmt(renderer.camera.scale * 36 / h, 1)} mm`;
}
function wireViewport() {
    const view = $('#viewport');
    let drag = null, suppressContext = 0, hoverFrame = false;
    const pos = e => { const r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    view.addEventListener('pointerdown', e => { if (sketcher.active || e.target.closest('button,input,select,[data-view]') || e.target.closest('.section-control,.explode-control'))
        return; view.focus(); const p = pos(e); drag = { x: p[0], y: p[1], sx: p[0], sy: p[1], button: e.button, shift: e.shiftKey, moved: false }; view.setPointerCapture(e.pointerId); });
    view.addEventListener('pointermove', e => { if (sketcher.active)
        return; const p = pos(e); if (drag) {
        const dx = p[0] - drag.x, dy = p[1] - drag.y;
        if (Math.hypot(p[0] - drag.sx, p[1] - drag.sy) > 3)
            drag.moved = true;
        if (drag.moved) {
            if (drag.button !== 0 || drag.shift || e.shiftKey || navMode === 'pan')
                renderer.camera.pan(dx, dy, view.clientWidth, view.clientHeight);
            else
                renderer.camera.orbit(dx, dy);
            renderer.hover = null;
            renderer.invalidate();
            $('#view-title').textContent = 'Custom view';
        }
        drag.x = p[0];
        drag.y = p[1];
        return;
    } hoverPointer = p; if (!hoverFrame) {
        hoverFrame = true;
        requestAnimationFrame(() => { hoverFrame = false; if (operation || sketcher.active)
            return; const hit = renderer.pick(...hoverPointer), old = renderer.hover; renderer.hover = hit?.body.id || null; if (hit) {
            $('.status-origin').textContent = `X ${fmt(hit.world[0])}  Y ${fmt(hit.world[1])}  Z ${fmt(hit.world[2])}`;
        } if (old !== renderer.hover || renderer.hover)
            renderer.invalidate(); });
    } });
    view.addEventListener('pointerup', e => { if (!drag)
        return; const d = drag; drag = null; if (d.moved) {
        suppressContext = performance.now() + 200;
        return;
    } if (d.button !== 0)
        return; const p = pos(e), hit = renderer.pick(...p); if (measuring) {
        if (!hit) {
            toast('Pick a point on a visible surface.');
            return;
        }
        if (measurements.length === 2)
            measurements = [];
        measurements.push(hit.world);
        renderInspector();
        renderer.invalidate();
        return;
    } selectBody(hit?.body.id || null, { append: e.ctrlKey || e.metaKey, hit }); });
    view.addEventListener('pointercancel', () => drag = null);
    view.addEventListener('pointerleave', () => { if (!drag) {
        renderer.hover = null;
        hoverPointer = null;
        renderer.invalidate();
    } });
    view.addEventListener('wheel', e => { if (sketcher.active || e.target.closest('input,select'))
        return; e.preventDefault(); renderer.camera.zoom(e.deltaY); renderer.invalidate(); }, { passive: false });
    view.addEventListener('contextmenu', e => { e.preventDefault(); if (sketcher.active || performance.now() < suppressContext)
        return; const hit = renderer.pick(...pos(e)); if (hit && !selected.has(hit.body.id))
        selectBody(hit.body.id, { hit }); showMenu([['fit', 'Fit all'], ['edit-feature', 'Edit feature…'], ['transform', 'Transform…'], ['duplicate', 'Duplicate'], ['hide', 'Hide selection'], null, ['section', 'Section view'], ['measure', 'Measure distance'], ['delete', 'Delete selection']], e.clientX, e.clientY); });
    view.addEventListener('dblclick', e => { if (sketcher.active || e.target.closest('button,input,select,[data-view]'))
        return; const hit = renderer.pick(...pos(e)); if (hit) {
        selectBody(hit.body.id, { hit });
        renderer.fit(true);
    }
    else
        renderer.fit(); });
}
function wireUI() {
    document.addEventListener('click', e => { const cmd = e.target.closest('[data-command]'); if (cmd) {
        execute(cmd.dataset.command);
        return;
    } const wb = e.target.closest('[data-workbench]'); if (wb) {
        setWorkbench(wb.dataset.workbench);
        return;
    } const view = e.target.closest('[data-view]'); if (view) {
        setView(view.dataset.view);
        return;
    } const menu = e.target.closest('[data-menu]'); if (menu) {
        const rect = menu.getBoundingClientRect();
        showMenu(menuItems[menu.dataset.menu], rect.left, rect.bottom + 3);
        return;
    } if (!e.target.closest('#menu-popup'))
        $('#menu-popup').hidden = true; });
    $('#tree').addEventListener('click', e => { const expand = e.target.closest('[data-expand]'), rootExpand = e.target.closest('[data-root-expand]'), visibility = e.target.closest('[data-visible]'); if (expand) {
        const id = expand.dataset.expand;
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        renderTree();
        return;
    } if (rootExpand) {
        rootCollapsed = !rootCollapsed;
        renderTree();
        return;
    } if (visibility) {
        history.commit('Toggle visibility', d => { const b = d.bodies.find(b => b.id === visibility.dataset.visible); b.visible = !b.visible; });
        return;
    } const row = e.target.closest('[data-body]'); if (row)
        selectBody(row.dataset.body, { featureId: row.dataset.feature || null, append: e.ctrlKey || e.metaKey });
    else if (e.target.closest('[data-root]'))
        selectBody(null); });
    $('#tree').addEventListener('dblclick', e => { const row = e.target.closest('[data-feature]'); if (row) {
        selectBody(row.dataset.body, { featureId: row.dataset.feature });
        execute('edit-feature');
    } const plane = e.target.closest('[data-plane]'); if (plane)
        setView(plane.dataset.plane === 'XY plane' ? 'top' : plane.dataset.plane === 'YZ plane' ? 'right' : 'front'); });
    $('#tree-filter').addEventListener('input', renderTree);
    $('#history-track').addEventListener('click', e => { const item = e.target.closest('[data-history-body]'); if (item) {
        collapsed.delete(item.dataset.historyBody);
        selectBody(item.dataset.historyBody, { featureId: item.dataset.historyFeature });
    } });
    $('#history-track').addEventListener('dblclick', e => { if (e.target.closest('[data-history-feature]'))
        execute('edit-feature'); });
    $('#inspector').addEventListener('change', e => { const el = e.target, b = activeBody(), f = activeFeature(); if (el.dataset.sketchParam !== undefined)
        return; if (!b)
        return; if (el.type === 'number' && (!el.checkValidity() || !Number.isFinite(Number(el.value)))) {
        el.reportValidity();
        return;
    } if (el.hasAttribute('data-body-name'))
        history.commit('Rename body', d => d.bodies.find(x => x.id === b.id).name = el.value.trim() || b.name); if (el.hasAttribute('data-feature-name') && f)
        history.commit('Rename feature', d => d.bodies.find(x => x.id === b.id).features.find(x => x.id === f.id).name = el.value.trim() || f.name); if (el.hasAttribute('data-material'))
        history.commit('Assign material', d => d.bodies.find(x => x.id === b.id).material = el.value); if (el.dataset.position !== undefined) {
        const index = Number(el.dataset.position), value = Number(el.value);
        applyChecked('Move body', d => d.bodies.find(x => x.id === b.id).position[index] = value);
    } if (el.dataset.param && f) {
        const key = el.dataset.param, value = Number(el.value);
        applyChecked('Edit ' + f.name, d => { const target = d.bodies.find(x => x.id === b.id).features.find(x => x.id === f.id); target.params = changedParams(target.params, { [key]: value }); });
    } if (el.hasAttribute('data-suppression') && f) {
        const suppressed = el.checked;
        applyChecked('Suppress feature', d => d.bodies.find(x => x.id === b.id).features.find(x => x.id === f.id).suppressed = suppressed);
    } });
    $('#inspector').addEventListener('input', e => { if (e.target.dataset.sketchParam) {
        const value = Number(e.target.value);
        if (Number.isFinite(value) && e.target.checkValidity())
            sketcher.update(e.target.dataset.sketchParam, value);
    } });
    $('#operation-form').addEventListener('input', requestPreview);
    $('#operation-form').addEventListener('change', e => { if (e.target.name === 'shape' && operation) {
        const v = formValues();
        operation.params = { ...operation.params, ...v, radius: v.radius || 15, width: v.width || 40, depth: v.depth || 30 };
        operation.name = v.name;
        operation.newBody = v.newBody ?? operation.newBody;
        renderOperation();
        requestPreview();
    } if (e.target.id === 'live-preview') {
        if (e.target.checked)
            requestPreview();
        else {
            clearTimeout(previewTimer);
            rebuild(history.doc, { quiet: true }).catch(() => { });
        }
    } });
    $('#operation-form').addEventListener('submit', async (e) => { e.preventDefault(); if (!operation || !$('#operation-form').reportValidity())
        return; clearTimeout(previewTimer); const op = operation, button = $('#operation-submit'); button.disabled = true; $('#operation-error').textContent = ''; try {
        const draft = operationDraft();
        validateDocument(draft);
        if (op.mode !== 'rename')
            await rebuild(draft, { preview: true, quiet: true });
        if (operation?.id !== op.id)
            return;
        if (op.mode === 'feature') {
            const target = draft.bodies.find(b => b.features.some(f => f.id === op.featureId));
            selected = new Set(target ? [target.id] : []);
            selectedFeature = op.featureId;
            if (target)
                collapsed.delete(target.id);
        }
        operation = null;
        $('#operation-dialog').close();
        history.commit(op.mode === 'rename' ? 'Rename product' : op.mode === 'transform' ? 'Transform component' : `${op.edit ? 'Edit' : 'Create'} ${op.type}`, d => Object.assign(d, draft));
        renderer.selected = selected;
        toast(op.mode === 'feature' ? `${op.edit ? 'Updated' : 'Created'} ${op.type} feature.` : 'Changes applied.');
    }
    catch (error) {
        if (operation?.id === op.id)
            $('#operation-error').textContent = error.message;
    }
    finally {
        button.disabled = false;
    } });
    $('#operation-dialog').addEventListener('cancel', e => { e.preventDefault(); closeOperation(); });
    $('#section-axis').addEventListener('change', e => { renderer.section.axis = Number(e.target.value); renderer.invalidate(); });
    $('#section-range').addEventListener('input', e => { renderer.section.value = Number(e.target.value); $('#section-value').textContent = `${e.target.value} mm`; renderer.invalidate(); });
    $('#explode-range').addEventListener('input', e => { renderer.exploded = Number(e.target.value); renderer.invalidate(); });
    $('#command-search').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
    $('#file-input').addEventListener('change', async (e) => { const file = e.target.files[0]; if (file)
        await importFile(file); e.target.value = ''; });
    document.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    document.addEventListener('drop', e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file)
        importFile(file); });
    document.addEventListener('keydown', e => { const cmd = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(); if ($('#palette').open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            paletteIndex += e.key === 'ArrowDown' ? 1 : -1;
            renderPalette();
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            $('.command-item.selected')?.click();
        }
        return;
    } if ($('dialog[open]'))
        return; const editable = e.target.closest('input,textarea,select,[contenteditable]'); if (editable)
        return; if (sketcher.active && sketcher.key(e)) {
        e.preventDefault();
        return;
    } if (cmd) {
        const command = ({ s: 'save', o: 'open', n: 'new', k: 'palette', d: 'duplicate', z: e.shiftKey ? 'redo' : 'undo', y: 'redo' })[key];
        if (command) {
            e.preventDefault();
            execute(command);
        }
        return;
    } const command = ({ f: 'fit', g: 'grid', p: 'projection', h: 'hole', s: 'sketch', t: 'transform', m: 'measure', c: 'section', e: 'explode', '0': 'iso', '1': 'front', '2': 'top', '3': 'right', '?': 'help', 'delete': 'delete', 'backspace': 'delete', ' ': 'hide' })[key]; if (command) {
        e.preventDefault();
        execute(command);
    }
    else if (e.key === 'Escape') {
        e.preventDefault();
        $('#menu-popup').hidden = true;
        measuring = false;
        measurements = [];
        selectBody(null);
        execute('select');
        renderInspector();
    }
    else if (e.key === '/') {
        e.preventDefault();
        $('#tree-filter').focus();
    } });
}
async function importFile(file) { try {
    status('Reading ' + file.name + '…');
    const result = await readFile(file);
    if (result.document) {
        await rebuild(result.document, { preview: true, quiet: true, fit: true });
        history.replace(result.document);
        selectBody(null);
        collapsed = new Set(history.doc.bodies.map(b => b.id));
        renderTree();
        toast('Editable project opened.');
    }
    else {
        if (!await applyChecked('Import STL', d => d.bodies.push(result.body)))
            return;
        selectBody(result.body.id);
        renderer.fit();
        toast('STL imported as a tessellated mesh body. Units are assumed to be millimeters.');
    }
}
catch (e) {
    report(e);
    rebuild(history.doc, { quiet: true }).catch(() => { });
} }
async function main() { renderer = await Renderer.create($('#scene'), { forceGL: new URLSearchParams(location.search).get('renderer') === 'webgl', onError: message => toast(message, true) }); sketcher = new Sketcher($('#sketch-canvas'), { onChange: () => renderSketchInspector(), onFinish: finishSketch, onCancel: cancelSketch }); renderer.onFrame = () => { $('#frame-time').textContent = `${fmt(renderer.lastFrameMs, 1)} ms CPU · ${renderer.drawCount} draws`; drawOverlay(); }; $('#engine-badge').innerHTML = `<i></i> ${renderer.backend === 'WebGPU' ? 'WebGPU · 4× MSAA' : 'WebGL2 fallback'}`; $('#renderer-status').textContent = renderer.backend; renderRibbon(); renderDocument(); wireUI(); wireViewport(); await rebuild(history.doc, { fit: true }); if (restored)
    status('Restored local project'); window.__aureon = { history, renderer, kernel, sketcher, execute, selectBody, rebuild, get selected() { return [...selected]; }, get selectedFeature() { return selectedFeature; }, get workbench() { return workbench; }, get ready() { return !modelBusy; }, get lastBuildMs() { return lastBuildMs; }, get meshes() { return renderer.objects; }, get measurements() { return measurements; }, get document() { return history.doc; } }; window.dispatchEvent(new Event('aureon-ready')); }
main().catch(error => { report(error); $('#loading').innerHTML = `<strong>The workbench could not initialize</strong><span>${escape(error.message)}</span><p style="max-width:350px;text-align:center;font-size:11px;line-height:1.8">Serve the source over localhost or HTTPS. A browser with WebGPU or WebGL2 and hardware acceleration is required.</p>`; });
