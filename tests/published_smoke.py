"""Verify modular loading and rendering at a project-relative deployment URL."""
import argparse
import json
import pathlib
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', required=True)
parser.add_argument('--commit')
parser.add_argument('--output', default='docs/published-smoke.json')
args = parser.parse_args()
base = args.url.rstrip('/') + '/'
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=[
        '--no-sandbox', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu',
        '--use-webgpu-adapter=swiftshader'
    ])
    try:
        for name, query in [('WebGL2 fallback', '?renderer=webgl'), ('Automatic renderer', '')]:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            errors, failed = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('response', lambda response: failed.append(f'{response.status} {response.url}') if response.status >= 400 else None)
            response = page.goto(base + query, wait_until='networkidle', timeout=60000)
            assert response and response.ok, f'Application HTTP status: {response.status if response else "none"}'
            page.wait_for_function('window.__aureon && __aureon.ready && __aureon.renderer.drawCount > 0', timeout=60000)
            state = page.evaluate('''async () => {
                const app = __aureon, r = app.renderer;
                if (r.device) await r.device.queue.onSubmittedWorkDone();
                return {backend:r.backend, bodies:app.document.bodies.length,
                        features:app.document.bodies.reduce((n,b)=>n+b.features.length,0),
                        drawCount:r.drawCount, meshes:r.objects.size,
                        fallbackReason:r.fallbackReason || null};
            }''')
            assert state['bodies'] == 10 and state['features'] == 28, state
            assert state['meshes'] == 10, state
            if query:
                assert state['backend'] == 'WebGL2', state
                assert page.evaluate('__aureon.renderer.gl.getError()') == 0
            version_response = context.request.get(base + 'version.json')
            assert version_response.ok, 'Missing deployment identity'
            version = version_response.json()
            if args.commit:
                assert version['commit'] == args.commit, version
            assert not errors, errors
            assert not failed, failed
            results.append({'case': name, 'passed': True, 'url': base, 'version':version, **state})
            context.close()
    finally:
        browser.close()
path = pathlib.Path(args.output)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
