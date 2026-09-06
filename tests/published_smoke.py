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
output = pathlib.Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
results = []

# Use full Chromium's new headless mode, rather than the reduced headless shell.
# Each backend gets an isolated browser/GPU process, not just another context.
# These software-driver flags are test-only; the deployed app uses browser defaults.
with sync_playwright() as p:
    for name, query in [('WebGL2 fallback', '?renderer=webgl'), ('Automatic renderer', '')]:
        browser = p.chromium.launch(channel='chromium', headless=True, args=[
            '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
            '--use-angle=swiftshader', '--use-vulkan=swiftshader',
            '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'
        ])
        errors, failed, console_errors = [], [], []
        result = {'case': name, 'passed': False, 'url': base, 'browser': browser.version}
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('response', lambda response: failed.append(f'{response.status} {response.url}') if response.status >= 400 else None)
            page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            response = page.goto(base + query, wait_until='networkidle', timeout=60000)
            assert response and response.ok, f'Application HTTP status: {response.status if response else "none"}'
            page.wait_for_function('window.__aureon && __aureon.ready && __aureon.renderer.drawCount > 0', timeout=60000)
            state = page.evaluate('''() => {
                const app = __aureon, r = app.renderer;
                return {backend:r.backend, bodies:app.document.bodies.length,
                        features:app.document.bodies.reduce((n,b)=>n+b.features.length,0),
                        drawCount:r.drawCount, meshes:r.objects.size,
                        fallbackReason:r.fallbackReason || null};
            }''')
            result.update(state)
            assert state['bodies'] == 10 and state['features'] == 28, state
            assert state['meshes'] == 10, state
            if state['backend'] == 'WebGPU':
                page.evaluate('''async () => {
                    const r = __aureon.renderer;
                    await r.device.queue.onSubmittedWorkDone();
                    r.device.pushErrorScope('validation');
                    r.render();
                    await r.device.queue.onSubmittedWorkDone();
                    const error = await r.device.popErrorScope();
                    if (error) throw new Error(error.message);
                }''')
            else:
                assert page.evaluate('__aureon.renderer.gl.getError()') == 0
            if query:
                assert state['backend'] == 'WebGL2', state
            version_response = context.request.get(base + 'version.json')
            assert version_response.ok, 'Missing deployment identity'
            result['version'] = version_response.json()
            if args.commit:
                assert result['version']['commit'] == args.commit, result['version']
            assert not errors, errors
            assert not failed, failed
            assert not console_errors, console_errors
            page.screenshot(path=str(output.with_name(output.stem + ('-webgl.png' if query else '-auto.png'))))
            result['passed'] = True
        except Exception as error:
            result['failure'] = str(error)
            raise
        finally:
            result.update(pageErrors=errors, failedRequests=failed, consoleErrors=console_errors)
            results.append(result)
            output.write_text(json.dumps(results, indent=2) + '\n')
            print(json.dumps(result, indent=2), flush=True)
            browser.close()
