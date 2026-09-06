import { V, M, BVH, Camera } from './math.js';
import { MATERIALS } from './model.js';
const WGSL = /* wgsl */ `
struct Scene { vp:mat4x4f, eye:vec4f, clip:vec4f };
struct Object { model:mat4x4f, color:vec4f, props:vec4f };
@group(0) @binding(0) var<uniform> scene:Scene;
@group(1) @binding(0) var<uniform> object:Object;
struct VertexOut { @builtin(position) position:vec4f, @location(0) world:vec3f, @location(1) normal:vec3f };
@vertex fn vs(@location(0) position:vec3f,@location(1) normal:vec3f)->VertexOut {
 var o:VertexOut; let p=object.model*vec4f(position,1.0);o.position=scene.vp*p;o.world=p.xyz;o.normal=(object.model*vec4f(normal,0.0)).xyz;return o;
}
fn aces(x:vec3f)->vec3f { return clamp((x*(2.51*x+vec3f(.03)))/(x*(2.43*x+vec3f(.59))+vec3f(.14)),vec3f(0),vec3f(1)); }
fn lamp(n:vec3f,v:vec3f,l:vec3f,base:vec3f,metal:f32,rough:f32,power:f32)->vec3f {
 let h=normalize(v+l);let nl=max(dot(n,l),0.0);let nv=max(dot(n,v),.001);let nh=max(dot(n,h),0.0);let vh=max(dot(v,h),0.0);
 let a=rough*rough;let a2=a*a;let d=a2/(3.14159265*pow(nh*nh*(a2-1.0)+1.0,2.0));let k=pow(rough+1.0,2.0)/8.0;
 let g=(nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));let f0=mix(vec3f(.04),base,metal);let f=f0+(vec3f(1)-f0)*pow(1.0-vh,5.0);
 let spec=d*g*f/max(4.0*nv*nl,.001);let diffuse=(vec3f(1)-f)*(1.0-metal)*base/3.14159265;return(diffuse+spec)*nl*power;
}
@fragment fn fs(i:VertexOut,@builtin(front_facing) front:bool)->@location(0) vec4f {
 if(object.props.w<1.5&&dot(scene.clip.xyz,i.world)>scene.clip.w){discard;}
 if(object.props.w>.5){return object.color;}
 var n=normalize(i.normal);if(!front){n=-n;}let v=normalize(scene.eye.xyz-i.world);
 let base=pow(object.color.rgb,vec3f(2.2));let metal=object.props.x;let rough=max(.16,object.props.y);
 var c=base*(.28+.20*max(n.z,0.0));
 c+=lamp(n,v,normalize(vec3f(-.45,-.65,1.0)),base,metal,rough,4.8);
 c+=lamp(n,v,normalize(vec3f(1.0,.25,.5)),base,metal,rough+.12,2.5);
 c+=lamp(n,v,normalize(vec3f(-.2,1.0,.3)),base,metal,rough+.15,2.8);
 let reflected=reflect(-v,n);let sky=smoothstep(-.45,.9,reflected.z);var env=mix(vec3f(.07,.09,.13),vec3f(.5,.64,.78),sky);env+=vec3f(.7,.85,1.0)*exp(-pow((reflected.x+.55)*3.5,2.0))*.7;c+=env*mix(vec3f(.06),base,metal)*(.85-.3*rough);let rim=pow(1.0-max(dot(n,v),0.0),3.0);c+=vec3f(.15,.21,.29)*rim*.5;
 c=mix(c,c*vec3f(1.2,1.02,.76)+vec3f(.1,.04,0),object.props.z*.28);
 return vec4f(pow(aces(c),vec3f(1.0/2.2)),object.color.a);
}`;
const GLSL_VERT = `#version 300 es
precision highp float;layout(location=0) in vec3 position;layout(location=1) in vec3 normal;
uniform mat4 vp,model;out vec3 world,norm;
void main(){vec4 p=model*vec4(position,1);gl_Position=vp*p;gl_Position.z=2.0*gl_Position.z-gl_Position.w;world=p.xyz;norm=(model*vec4(normal,0)).xyz;}`;
const GLSL_FRAG = `#version 300 es
precision highp float;in vec3 world,norm;uniform vec4 color,props,clip;uniform vec3 eye;out vec4 outColor;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
vec3 lamp(vec3 n,vec3 v,vec3 l,vec3 base,float metal,float rough,float power){vec3 h=normalize(v+l);float nl=max(dot(n,l),0.),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.),vh=max(dot(v,h),0.);float a=rough*rough,a2=a*a,d=a2/(3.14159265*pow(nh*nh*(a2-1.)+1.,2.)),k=pow(rough+1.,2.)/8.;float g=(nl/(nl*(1.-k)+k))*(nv/(nv*(1.-k)+k));vec3 f0=mix(vec3(.04),base,metal),f=f0+(1.-f0)*pow(1.-vh,5.);return((1.-f)*(1.-metal)*base/3.14159265+d*g*f/max(4.*nv*nl,.001))*nl*power;}
void main(){if(props.w<1.5&&dot(clip.xyz,world)>clip.w)discard;if(props.w>.5){outColor=color;return;}vec3 n=normalize(norm);if(!gl_FrontFacing)n=-n;vec3 v=normalize(eye-world),base=pow(color.rgb,vec3(2.2));float metal=props.x,rough=max(.16,props.y);vec3 c=base*(.28+.20*max(n.z,0.));c+=lamp(n,v,normalize(vec3(-.45,-.65,1)),base,metal,rough,4.8);c+=lamp(n,v,normalize(vec3(1,.25,.5)),base,metal,rough+.12,2.5);c+=lamp(n,v,normalize(vec3(-.2,1,.3)),base,metal,rough+.15,2.8);vec3 reflected=reflect(-v,n);float sky=smoothstep(-.45,.9,reflected.z);vec3 env=mix(vec3(.07,.09,.13),vec3(.5,.64,.78),sky);env+=vec3(.7,.85,1)*exp(-pow((reflected.x+.55)*3.5,2.))*.7;c+=env*mix(vec3(.06),base,metal)*(.85-.3*rough);c+=vec3(.15,.21,.29)*pow(1.-max(dot(n,v),0.),3.)*.5;c=mix(c,c*vec3(1.2,1.02,.76)+vec3(.1,.04,0),props.z*.28);outColor=vec4(pow(aces(c),vec3(1./2.2)),color.a);}`;
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
export class Renderer {
    constructor(canvas) { this.canvas = canvas; this.camera = new Camera(); this.objects = new Map(); this.doc = null; this.selected = new Set(); this.hover = null; this.mode = 'edges'; this.grid = true; this.section = { enabled: false, axis: 0, value: 0 }; this.exploded = 0; this.pending = false; this.drawCount = 0; this.lastFrameMs = 0; this.onFrame = () => { }; this.onError = () => { }; this.disposed = false; }
    static async create(canvas, { forceGL = false, onError = () => { } } = {}) { let r = new Renderer(canvas); r.onError = onError; let failure = null; if (navigator.gpu && !forceGL) {
        try {
            await r.initGPU();
        }
        catch (e) {
            failure = e;
            r.dispose();
            const c = canvas.cloneNode();
            canvas.replaceWith(c);
            r = new Renderer(c);
            r.onError = onError;
        }
    } if (!r.device) {
        r.initGL();
        r.fallbackReason = forceGL ? 'WebGL2 explicitly requested' : failure?.message || 'WebGPU is unavailable in this context';
    } r.resizeObserver = new ResizeObserver(() => r.resize()); r.resizeObserver.observe(r.canvas.parentElement); r.resize(); return r; }
    async initGPU() { const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!adapter)
        throw Error('No WebGPU adapter available'); this.device = await adapter.requestDevice(); const device = this.device; this.backend = 'WebGPU'; this.adapterInfo = adapter.info; device.addEventListener('uncapturederror', e => this.onError(e.error.message)); device.lost.then(info => { if (!this.disposed)
        this.onError(`GPU device lost: ${info.message}. Reload to reconnect.`); }); this.context = this.canvas.getContext('webgpu'); if (!this.context)
        throw Error('WebGPU canvas context unavailable'); this.format = navigator.gpu.getPreferredCanvasFormat(); this.context.configure({ device, format: this.format, alphaMode: 'premultiplied' }); device.pushErrorScope('validation'); const shader = device.createShaderModule({ label: 'Aureon studio GGX', code: WGSL }); const info = await shader.getCompilationInfo(); const errors = info.messages.filter(m => m.type === 'error'); if (errors.length)
        throw Error(errors.map(e => e.message).join('\n')); this.sceneLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] }); this.objectLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] }); const layout = device.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout, this.objectLayout] }); const create = (topology, write) => device.createRenderPipeline({ layout, vertex: { module: shader, entryPoint: 'vs', buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] }, primitive: { topology, cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: write, depthCompare: 'less-equal', ...(topology === 'triangle-list' ? { depthBias: 1, depthBiasSlopeScale: 1 } : {}) }, multisample: { count: 4 } }); this.solidPipeline = create('triangle-list', true); this.xrayPipeline = create('triangle-list', false); this.linePipeline = create('line-list', false); this.sceneBuffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); this.sceneBind = device.createBindGroup({ layout: this.sceneLayout, entries: [{ binding: 0, resource: { buffer: this.sceneBuffer } }] }); const error = await device.popErrorScope(); if (error)
        throw Error(error.message); this.initGrid(); }
    initGL() { const gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false }); if (!gl)
        throw Error('Neither WebGPU nor WebGL2 is available'); this.gl = gl; this.backend = 'WebGL2'; const compile = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(sh)); return sh; }; const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, GLSL_VERT)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, GLSL_FRAG)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(p)); this.program = p; this.locations = Object.fromEntries(['vp', 'model', 'color', 'props', 'clip', 'eye'].map(n => [n, gl.getUniformLocation(p, n)])); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); this.initGrid(); }
    initGrid() { const data = []; for (let i = -180; i <= 180; i += 10) {
        data.push(i, -180, -.1, 0, 0, 0, i, 180, -.1, 0, 0, 0, -180, i, -.1, 0, 0, 0, 180, i, -.1, 0, 0, 0);
    } this.gridObject = this.makeResource({ vertices: new Float32Array(), edges: new Float32Array(data), signature: 'grid', id: 'grid' }); }
    makeResource(mesh) { const resource = { ...mesh, bvh: mesh.vertices.length ? new BVH(mesh.vertices) : null }; if (this.device) {
        const create = data => { const b = this.device.createBuffer({ size: Math.max(24, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); if (data.byteLength)
            this.device.queue.writeBuffer(b, 0, data); return b; };
        resource.vertexBuffer = create(mesh.vertices);
        resource.edgeBuffer = create(mesh.edges);
        resource.uniform = this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        resource.edgeUniform = this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const bind = buffer => this.device.createBindGroup({ layout: this.objectLayout, entries: [{ binding: 0, resource: { buffer } }] });
        resource.bind = bind(resource.uniform);
        resource.edgeBind = bind(resource.edgeUniform);
    }
    else {
        const create = data => { const gl = this.gl, b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
        resource.vertexBuffer = create(mesh.vertices);
        resource.edgeBuffer = create(mesh.edges);
    } return resource; }
    destroyResource(r) { if (this.device) {
        for (const k of ['vertexBuffer', 'edgeBuffer', 'uniform', 'edgeUniform'])
            r[k]?.destroy();
    }
    else if (this.gl) {
        this.gl.deleteBuffer(r.vertexBuffer);
        this.gl.deleteBuffer(r.edgeBuffer);
    } }
    setMeshes(meshes, doc) { const next = new Map(); for (const mesh of meshes) {
        const old = this.objects.get(mesh.id);
        if (old?.signature === mesh.signature) {
            next.set(mesh.id, old);
        }
        else {
            next.set(mesh.id, this.makeResource(mesh));
            if (old)
                this.destroyResource(old);
        }
    } for (const [id, r] of this.objects)
        if (!next.has(id))
            this.destroyResource(r); this.objects = next; this.doc = doc; this.invalidate(); }
    resize() { const rect = this.canvas.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr)); if (this.canvas.width !== w || this.canvas.height !== h || !this.depth) {
        this.canvas.width = w;
        this.canvas.height = h;
        if (this.device) {
            this.depth?.destroy();
            this.msaa?.destroy();
            this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
            this.msaa = this.device.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        }
        this.camera.aspect = w / h;
        this.camera.update();
        this.invalidate();
    } }
    matrix(body, mesh) { let p = [...body.position]; if (this.exploded) {
        const center = M.point(M.compose(body.position, body.rotation), mesh.stats.centroid);
        let direction = V.sub(center, [0, 0, 40]);
        if (V.len(direction) < 10)
            direction = [0, 0, 25];
        p = V.add(p, V.mul(direction, this.exploded * .85));
        if (body.name.includes('screw'))
            p[1] -= this.exploded * 30;
    } return M.compose(p, body.rotation); }
    style(body) { const mat = MATERIALS[body.material] || MATERIALS.aluminum, col = hex(body.color || mat.color); return { color: [...col, this.mode === 'xray' ? .25 : 1], props: [mat.metal, mat.rough, this.selected.has(body.id) ? 1 : this.hover === body.id ? .5 : 0, 0] }; }
    clip() { const out = [0, 0, 0, 1e9]; if (this.section.enabled) {
        out[this.section.axis] = 1;
        out[3] = this.section.value;
    } return out; }
    invalidate() { if (this.pending || this.disposed)
        return; this.pending = true; requestAnimationFrame(() => { this.pending = false; if (!this.disposed)
        this.render(); }); }
    render() { const start = performance.now(); this.camera.update(); this.drawCount = 0; if (this.device)
        this.renderGPU();
    else
        this.renderGL(); this.lastFrameMs = performance.now() - start; this.onFrame(this); }
    uniform(matrix, color, props) { const data = new Float32Array(24); data.set(matrix); data.set(color, 16); data.set(props, 20); return data; }
    renderGPU() { if (!this.depth)
        return; const device = this.device; const scene = new Float32Array(24); scene.set(this.camera.vp); scene.set([...this.camera.eye, 1], 16); scene.set(this.clip(), 20); device.queue.writeBuffer(this.sceneBuffer, 0, scene); const encoder = device.createCommandEncoder(); const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } }); pass.setBindGroup(0, this.sceneBind); const draw = (r, lines, matrix, color, props) => { if (!(lines ? r.edges.length : r.vertices.length))
        return; device.queue.writeBuffer(lines ? r.edgeUniform : r.uniform, 0, this.uniform(matrix, color, props)); pass.setPipeline(lines ? this.linePipeline : this.mode === 'xray' ? this.xrayPipeline : this.solidPipeline); pass.setBindGroup(1, lines ? r.edgeBind : r.bind); pass.setVertexBuffer(0, lines ? r.edgeBuffer : r.vertexBuffer); pass.draw((lines ? r.edges.length : r.vertices.length) / 6); this.drawCount++; }; if (this.grid)
        draw(this.gridObject, true, M.identity(), [.43, .53, .67, .17], [0, 0, 0, 2]); for (const b of this.doc?.bodies || []) {
        if (!b.visible)
            continue;
        const r = this.objects.get(b.id);
        if (!r)
            continue;
        const m = this.matrix(b, r), s = this.style(b);
        if (this.mode !== 'wireframe')
            draw(r, false, m, s.color, s.props);
    } for (const b of this.doc?.bodies || []) {
        if (!b.visible)
            continue;
        const r = this.objects.get(b.id);
        if (!r)
            continue;
        const selected = this.selected.has(b.id), hover = this.hover === b.id;
        if (this.mode !== 'shaded' || selected || hover)
            draw(r, true, this.matrix(b, r), selected ? [1, .61, .22, 1] : hover ? [.49, .78, 1, 1] : [.12, .17, .22, this.mode === 'xray' ? .5 : .65], [0, 0, 0, 1]);
    } pass.end(); device.queue.submit([encoder.finish()]); }
    renderGL() { const gl = this.gl; if (!gl)
        return; gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0, 0, 0, 0); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(this.program); gl.uniformMatrix4fv(this.locations.vp, false, this.camera.vp); gl.uniform3fv(this.locations.eye, this.camera.eye); gl.uniform4fv(this.locations.clip, this.clip()); const draw = (r, lines, matrix, color, props) => { gl.bindBuffer(gl.ARRAY_BUFFER, lines ? r.edgeBuffer : r.vertexBuffer); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12); gl.uniformMatrix4fv(this.locations.model, false, matrix); gl.uniform4fv(this.locations.color, color); gl.uniform4fv(this.locations.props, props); gl.depthMask(!lines && this.mode !== 'xray'); if (!lines) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 1);
    }
    else
        gl.disable(gl.POLYGON_OFFSET_FILL); gl.drawArrays(lines ? gl.LINES : gl.TRIANGLES, 0, (lines ? r.edges.length : r.vertices.length) / 6); this.drawCount++; }; if (this.grid)
        draw(this.gridObject, true, M.identity(), [.43, .53, .67, .17], [0, 0, 0, 2]); for (const b of this.doc?.bodies || []) {
        if (!b.visible)
            continue;
        const r = this.objects.get(b.id);
        if (!r)
            continue;
        const m = this.matrix(b, r), s = this.style(b);
        if (this.mode !== 'wireframe')
            draw(r, false, m, s.color, s.props);
    } for (const b of this.doc?.bodies || []) {
        if (!b.visible)
            continue;
        const r = this.objects.get(b.id);
        if (!r)
            continue;
        const selected = this.selected.has(b.id), hover = this.hover === b.id;
        if (this.mode !== 'shaded' || selected || hover)
            draw(r, true, this.matrix(b, r), selected ? [1, .61, .22, 1] : hover ? [.49, .78, 1, 1] : [.12, .17, .22, this.mode === 'xray' ? .5 : .65], [0, 0, 0, 1]);
    } gl.depthMask(true); }
    pick(x, y) { const rect = this.canvas.getBoundingClientRect(), ray = this.camera.ray(x, y, rect.width, rect.height); let best = null; for (const b of this.doc?.bodies || []) {
        if (!b.visible)
            continue;
        const mesh = this.objects.get(b.id);
        if (!mesh?.bvh)
            continue;
        const matrix = this.matrix(b, mesh), inv = M.inverse(matrix), o = M.point(inv, ray.o), d = V.norm(M.vector(inv, ray.d));
        const hit = mesh.bvh.intersect(o, d, p => !this.section.enabled || M.point(matrix, p)[this.section.axis] <= this.section.value);
        if (hit) {
            const world = M.point(matrix, hit.point), distance = V.len(V.sub(world, ray.o));
            if (!best || distance < best.distance)
                best = { ...hit, body: b, world, distance, worldNormal: V.norm(M.vector(matrix, hit.normal)) };
        }
    } return best; }
    fit(selection = false) { let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (const b of this.doc?.bodies || []) {
        if (!b.visible || (selection && !this.selected.has(b.id)))
            continue;
        const mesh = this.objects.get(b.id);
        if (!mesh)
            continue;
        const m = this.matrix(b, mesh);
        for (let i = 0; i < 8; i++) {
            const p = M.point(m, [mesh.bounds[(i & 1) ? 'max' : 'min'][0], mesh.bounds[(i & 2) ? 'max' : 'min'][1], mesh.bounds[(i & 4) ? 'max' : 'min'][2]]);
            min = V.min(min, p);
            max = V.max(max, p);
        }
    } if (!Number.isFinite(min[0])) {
        this.camera.target = [0, 0, 0];
        this.camera.scale = 160;
        this.camera.distance = 240;
    }
    else {
        this.camera.target = V.mul(V.add(min, max), .5);
        const ext = V.sub(max, min);
        this.camera.scale = Math.max(ext[2], ext[1], ext[0] / this.camera.aspect) * 1.6;
        this.camera.distance = Math.max(...ext) * 2.3;
    } this.camera.update(); this.invalidate(); }
    dispose() { this.disposed = true; this.resizeObserver?.disconnect(); for (const r of this.objects.values())
        this.destroyResource(r); if (this.gridObject)
        this.destroyResource(this.gridObject); this.depth?.destroy(); this.msaa?.destroy(); this.sceneBuffer?.destroy(); this.device?.destroy(); }
}
