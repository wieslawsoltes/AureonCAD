/** Lightweight closed-profile sketch editor. Grid snap and Shift orthogonality,
 * not a general nonlinear geometric constraint solver. */
export class Sketcher {
    constructor(canvas, { onChange = () => { }, onFinish = () => { }, onCancel = () => { } } = {}) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.onChange = onChange; this.onFinish = onFinish; this.onCancel = onCancel; this.active = false; this.tool = 'rectangle'; this.snap = 1; this.zoom = 5; this.pan = [0, 0]; this.profile = null; this.points = []; this.pointer = null; this.start = null; this.dragging = false; this.canvas.addEventListener('pointerdown', e => this.down(e)); this.canvas.addEventListener('pointermove', e => this.move(e)); this.canvas.addEventListener('pointerup', e => this.up(e)); this.canvas.addEventListener('dblclick', e => { if (this.tool === 'polygon') {
        e.preventDefault();
        this.closePolygon();
    } }); this.canvas.addEventListener('wheel', e => { if (!this.active)
        return; e.preventDefault(); this.zoom = Math.max(.3, Math.min(35, this.zoom * Math.exp(-e.deltaY * .001))); this.draw(); }, { passive: false }); this.canvas.addEventListener('contextmenu', e => e.preventDefault()); this.resizeObserver = new ResizeObserver(() => this.draw()); this.resizeObserver.observe(canvas.parentElement); }
    begin(params = null) { this.active = true; this.canvas.hidden = false; this.canvas.parentElement.classList.add('sketching'); this.profile = params ? structuredClone(params) : null; this.points = []; this.start = null; this.tool = params?.shape || 'rectangle'; this.zoom = 5; this.pan = [0, 0]; this.draw(); this.notify(); }
    end() { this.active = false; this.canvas.hidden = true; this.canvas.parentElement.classList.remove('sketching'); }
    setTool(tool) { this.tool = tool; this.start = null; this.points = []; this.profile = null; this.draw(); this.notify(); }
    notify() { this.onChange(this.profile, this.points); }
    coords(e) { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left - r.width / 2 - this.pan[0]) / this.zoom, -(e.clientY - r.top - r.height / 2 - this.pan[1]) / this.zoom].map(x => Math.round(x / this.snap) * this.snap); }
    screen(p) { return [this.width / 2 + this.pan[0] + p[0] * this.zoom, this.height / 2 + this.pan[1] - p[1] * this.zoom]; }
    down(e) { if (!this.active || e.button !== 0)
        return; this.canvas.setPointerCapture(e.pointerId); let p = this.coords(e); if (e.shiftKey && this.tool === 'polygon' && this.points.length) {
        const a = this.points.at(-1);
        if (Math.abs(p[0] - a[0]) > Math.abs(p[1] - a[1]))
            p[1] = a[1];
        else
            p[0] = a[0];
    } if (this.tool === 'polygon') {
        if (this.points.length > 2 && Math.hypot(p[0] - this.points[0][0], p[1] - this.points[0][1]) * this.zoom < 12) {
            this.closePolygon();
            return;
        }
        if (!this.points.length || Math.hypot(p[0] - this.points.at(-1)[0], p[1] - this.points.at(-1)[1]) > .001)
            this.points.push(p);
        this.profile = null;
        this.notify();
        this.draw();
        return;
    } this.start = p; this.dragging = true; this.profile = null; this.draw(); }
    move(e) { if (!this.active)
        return; let p = this.coords(e); if (e.shiftKey) {
        const origin = this.start || this.points.at(-1);
        if (origin) {
            if (this.tool === 'rectangle') {
                const d = Math.max(Math.abs(p[0] - origin[0]), Math.abs(p[1] - origin[1]));
                p = [origin[0] + Math.sign(p[0] - origin[0] || 1) * d, origin[1] + Math.sign(p[1] - origin[1] || 1) * d];
            }
            else if (this.tool === 'polygon') {
                if (Math.abs(p[0] - origin[0]) > Math.abs(p[1] - origin[1]))
                    p[1] = origin[1];
                else
                    p[0] = origin[0];
            }
        }
    } this.pointer = p; if (this.dragging && this.start) {
        const a = this.start;
        if (this.tool === 'circle')
            this.profile = { shape: 'circle', x: a[0], y: a[1], radius: Math.max(.01, Math.hypot(p[0] - a[0], p[1] - a[1])) };
        else
            this.profile = { shape: 'rectangle', x: (a[0] + p[0]) / 2, y: (a[1] + p[1]) / 2, width: Math.max(.01, Math.abs(p[0] - a[0])), depth: Math.max(.01, Math.abs(p[1] - a[1])), corner: 0 };
        this.notify();
    } this.draw(); }
    up() { if (this.dragging) {
        this.dragging = false;
        this.start = null;
        this.notify();
        this.draw();
    } }
    closePolygon() { if (this.points.length < 3)
        return; this.profile = { shape: 'polygon', points: this.points.map(p => [...p]), x: 0, y: 0 }; this.points = []; this.notify(); this.draw(); }
    key(e) { if (!this.active)
        return false; if (e.key === 'Escape') {
        this.onCancel();
        return true;
    } if (e.key === 'Enter') {
        if (this.points.length >= 3)
            this.closePolygon();
        else if (this.profile)
            this.onFinish();
        return true;
    } if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.points.length)
            this.points.pop();
        else
            this.profile = null;
        this.notify();
        this.draw();
        return true;
    } return false; }
    update(key, value) { if (this.profile) {
        this.profile[key] = value;
        this.draw();
    } }
    draw() {
        if (!this.active)
            return;
        const rect = this.canvas.parentElement.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.width = rect.width;
        this.height = rect.height;
        const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr);
        if (this.canvas.width !== cw || this.canvas.height !== ch) {
            this.canvas.width = cw;
            this.canvas.height = ch;
        }
        const c = this.ctx;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, this.width, this.height);
        c.fillStyle = '#f4f7fc';
        c.fillRect(0, 0, this.width, this.height);
        const step = 10 * this.zoom, [ox, oy] = this.screen([0, 0]);
        c.lineWidth = 1;
        c.strokeStyle = '#e1e8f3';
        c.beginPath();
        for (let x = ox % step; x < this.width; x += step) {
            c.moveTo(x, 0);
            c.lineTo(x, this.height);
        }
        for (let y = oy % step; y < this.height; y += step) {
            c.moveTo(0, y);
            c.lineTo(this.width, y);
        }
        c.stroke();
        c.strokeStyle = '#c09191';
        c.beginPath();
        c.moveTo(0, oy);
        c.lineTo(this.width, oy);
        c.stroke();
        c.strokeStyle = '#8bb6a6';
        c.beginPath();
        c.moveTo(ox, 0);
        c.lineTo(ox, this.height);
        c.stroke();
        c.font = '10px system-ui';
        c.fillStyle = '#a78080';
        c.fillText('H', this.width - 20, oy - 9);
        c.fillStyle = '#7d9f94';
        c.fillText('V', ox + 10, 88);
        c.fillStyle = '#7087a6';
        c.fillText('XY plane · millimeters · 1 mm grid snap', 20, this.height - 24);
        const p = this.profile;
        const line = pts => { c.beginPath(); pts.forEach((p, i) => { const a = this.screen(p); i ? c.lineTo(...a) : c.moveTo(...a); }); };
        let nodes = [];
        c.lineWidth = 1.7;
        c.strokeStyle = '#2b79d7';
        c.fillStyle = '#3786e914';
        if (p) {
            if (p.shape === 'circle') {
                const center = this.screen([p.x || 0, p.y || 0]);
                c.beginPath();
                c.arc(...center, p.radius * this.zoom, 0, Math.PI * 2);
                c.fill();
                c.stroke();
                nodes = [[p.x || 0, p.y || 0]];
                const end = this.screen([(p.x || 0) + p.radius, p.y || 0]);
                c.setLineDash([4, 4]);
                c.beginPath();
                c.moveTo(...center);
                c.lineTo(...end);
                c.stroke();
                c.setLineDash([]);
                this.label(c, `Ø ${(p.radius * 2).toFixed(2)}`, (center[0] + end[0]) / 2, center[1] - 12);
            }
            else {
                nodes = p.shape === 'polygon' ? p.points.map(q => [q[0] + (p.x || 0), q[1] + (p.y || 0)]) : [[p.x - p.width / 2, p.y - p.depth / 2], [p.x + p.width / 2, p.y - p.depth / 2], [p.x + p.width / 2, p.y + p.depth / 2], [p.x - p.width / 2, p.y + p.depth / 2]];
                line(nodes);
                c.closePath();
                c.fill();
                c.stroke();
                if (p.shape === 'rectangle') {
                    const a = this.screen(nodes[3]), b = this.screen(nodes[2]), d = this.screen(nodes[1]);
                    c.strokeStyle = '#779cce';
                    c.lineWidth = 1;
                    c.beginPath();
                    c.moveTo(a[0], a[1] - 19);
                    c.lineTo(b[0], b[1] - 19);
                    c.moveTo(a[0], a[1] - 24);
                    c.lineTo(a[0], a[1] - 8);
                    c.moveTo(b[0], b[1] - 24);
                    c.lineTo(b[0], b[1] - 8);
                    c.moveTo(b[0] + 22, b[1]);
                    c.lineTo(d[0] + 22, d[1]);
                    c.stroke();
                    this.label(c, `${p.width.toFixed(2)}`, (a[0] + b[0]) / 2, a[1] - 26);
                    this.label(c, `${p.depth.toFixed(2)}`, b[0] + 44, (b[1] + d[1]) / 2);
                }
            }
        }
        if (this.points.length) {
            nodes = this.points;
            line(this.points.concat(this.pointer ? [this.pointer] : []));
            c.stroke();
            if (this.points.length > 2) {
                c.setLineDash([4, 4]);
                c.beginPath();
                c.moveTo(...this.screen(this.points[0]));
                c.lineTo(...this.screen(this.pointer || this.points.at(-1)));
                c.stroke();
                c.setLineDash([]);
            }
        }
        for (const n of nodes) {
            const a = this.screen(n);
            c.fillStyle = '#fff';
            c.strokeStyle = '#2879d9';
            c.lineWidth = 1.5;
            c.fillRect(a[0] - 3, a[1] - 3, 6, 6);
            c.strokeRect(a[0] - 3, a[1] - 3, 6, 6);
        }
        if (this.pointer) {
            const a = this.screen(this.pointer);
            c.strokeStyle = '#99afcb';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(a[0] - 9, a[1]);
            c.lineTo(a[0] + 9, a[1]);
            c.moveTo(a[0], a[1] - 9);
            c.lineTo(a[0], a[1] + 9);
            c.stroke();
            c.fillStyle = '#8ba2bf';
            c.font = '9px system-ui';
            c.fillText(`${this.pointer[0].toFixed(1)}, ${this.pointer[1].toFixed(1)}`, a[0] + 12, a[1] + 18);
        }
    }
    label(c, text, x, y) { c.font = '11px system-ui'; const w = c.measureText(text).width; c.fillStyle = '#f4f7fc'; c.fillRect(x - w / 2 - 5, y - 11, w + 10, 17); c.fillStyle = '#4276ba'; c.fillText(text, x - w / 2, y); }
}
