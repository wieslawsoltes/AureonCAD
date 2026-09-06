# Verification record

Delivery date: September 6, 2026.

## Geometry and data tests

`npm test` uses Node's built-in test runner, with no external packages. The committed TAP report is `unit-test-results.txt`. All 31 tests passed in Node.js 22.16.0.

Tests compare volumes with analytic boxes and the exact regular-polygon cross sections used by the tessellator; sphere/rounded-profile tests use explicitly stated approximation tolerances. Additional tests cover replay and cache invalidation, transformed body references, cyclic dependencies, schema validation, history branches, ray/BVH behavior, camera unprojection, STL round-trip, exporters, and the complete 10-body example.

These tests are not an exhaustive numerical-robustness study, topology qualification, or proof of manufacturing correctness.

## Browser testing

`browser-test-results.json` records 24 passing end-to-end checks, browser version, actual backend, warnings, and errors. `browser-test-log.txt` provides the readable execution log. Screenshots in this directory are produced by the running application, not mockups.

The available test browser was Chromium on Linux, with Xvfb and the SwiftShader WebGL2 backend. Managed navigation restrictions meant the single-file build was injected into an opaque about:blank document with Playwright `set_content`. Consequently:

- The real WebGL2 shaders, geometry worker, DOM interface, camera interaction, feature editing and supported export/import workflows were executed. All 24 browser checks passed with zero page exceptions, zero console errors, and no final WebGL error.
- **The native WebGPU renderer was not runtime-tested.** It is present in the code and selected first in a compatible secure context, with explicit shader/pipeline error checking and WebGL2 fallback. It still requires validation on a WebGPU-capable localhost/HTTPS browser.
- **Persistent localStorage recovery was not tested across page loads.** Storage access is denied in the injected test document. The app handled that restriction and displayed its explicit save/download fallback. Project download/reopen is a separate tested workflow.
- **No hardware performance claim is made.** SwiftShader is a software renderer. The viewport's CPU timing is not GPU execution time, frames per second, or latency.

## Remaining validation work

Execute the browser suite over localhost/HTTPS on actual WebGPU devices; test device loss, driver differences, and WebGL context loss; build a CAD robustness corpus for coplanar/near-degenerate booleans and non-manifold imports; profile large assemblies and high-DPI windows; run accessibility and cross-browser testing; qualify any intended manufacturing workflow independently.

The implementation intentionally exposes its engineering scope in both the README and in-app Help.
