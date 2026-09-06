import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/renderer.js';

function fixture(t, failure = null) {
    const events = [];
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: {} } });
    const previousObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() { events.push('observe'); } };
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
        else delete globalThis.navigator;
        if (previousObserver) globalThis.ResizeObserver = previousObserver;
        else delete globalThis.ResizeObserver;
    });
    t.mock.method(Renderer.prototype, 'initGPU', async function () {
        events.push('gpu'); this.device = {}; this.backend = 'WebGPU';
    });
    t.mock.method(Renderer.prototype, 'verifyGPU', async function () {
        events.push('verify'); if (failure) throw failure;
    });
    t.mock.method(Renderer.prototype, 'initGL', function () { events.push('gl'); this.backend = 'WebGL2'; });
    t.mock.method(Renderer.prototype, 'resize', () => events.push('resize'));
    t.mock.method(Renderer.prototype, 'dispose', function () { events.push('dispose'); this.disposed = true; });
    const replacement = { parentElement: {} };
    const canvas = { parentElement: {}, cloneNode: () => replacement, replaceWith: c => { assert.equal(c, replacement); events.push('replace'); } };
    return { events, canvas, replacement };
}
test('renderer selects WebGPU only after a completed startup frame', async t => {
    const { canvas, events } = fixture(t);
    const renderer = await Renderer.create(canvas);
    assert.equal(renderer.backend, 'WebGPU');
    assert.deepEqual(events, ['gpu', 'verify', 'observe', 'resize']);
});
test('renderer recovers from startup submission failure before UI attaches', async t => {
    const { canvas, replacement, events } = fixture(t, new Error('Driver submission failed'));
    const renderer = await Renderer.create(canvas);
    assert.equal(renderer.backend, 'WebGL2');
    assert.equal(renderer.canvas, replacement);
    assert.equal(renderer.fallbackReason, 'Driver submission failed');
    assert.deepEqual(events, ['gpu', 'verify', 'dispose', 'replace', 'gl', 'observe', 'resize']);
});
test('explicit WebGL2 selection does not initialize a GPU device', async t => {
    const { canvas, events } = fixture(t);
    const renderer = await Renderer.create(canvas, { forceGL: true });
    assert.equal(renderer.backend, 'WebGL2');
    assert.deepEqual(events, ['gl', 'observe', 'resize']);
});
test('startup verification waits for queue completion', async () => {
    const events = [];
    const r = { resize: () => events.push('resize'), render: () => events.push('render'), device: { queue: { onSubmittedWorkDone: async () => events.push('complete') } } };
    await Renderer.prototype.verifyGPU.call(r, 50);
    assert.deepEqual(events, ['resize', 'render', 'complete']);
});
test('startup verification has a bounded failure timeout', async () => {
    const r = { resize() {}, render() {}, device: { queue: { onSubmittedWorkDone: () => new Promise(() => {}) } } };
    await assert.rejects(Renderer.prototype.verifyGPU.call(r, 5), /startup frame timed out/);
});
