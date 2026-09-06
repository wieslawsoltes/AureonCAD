"""End-to-end tests. Install Python Playwright separately; see README.

Normal: python3 tests/browser_smoke.py --url http://localhost:8080
Restricted test host: DISPLAY=:99 python3 tests/browser_smoke.py --standalone --headed --software --browser /usr/bin/chromium
"""
from __future__ import annotations
import argparse
import json
import math
import pathlib
import time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://localhost:8080')
parser.add_argument('--standalone', action='store_true')
parser.add_argument('--headed', action='store_true')
parser.add_argument('--software', action='store_true')
parser.add_argument('--browser')
args = parser.parse_args()
checks: list[dict] = []
errors: list[str] = []
console_errors: list[str] = []
warnings: list[str] = []

def record(name: str, **details):
    checks.append({'name': name, 'passed': True, **details})
    print('PASS', name, flush=True)

with sync_playwright() as p:
    launch = {'headless': not args.headed}
    flags = []
    if args.software:
        flags += ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader']
    if args.browser:
        launch['executable_path'] = args.browser
    if flags:
        launch['args'] = flags
    browser = p.chromium.launch(**launch)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1, accept_downloads=True)
    page.set_default_timeout(10000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda msg: (console_errors if msg.type == 'error' else warnings).append(msg.text) if msg.type in ['warning', 'error'] else None)
    try:
        if args.standalone:
            page.set_content((ROOT / 'dist/AureonCAD.html').read_text(), wait_until='load')
        else:
            page.goto(args.url, wait_until='load')
        page.wait_for_function('window.__aureon && __aureon.ready', timeout=45000)
        backend = page.evaluate('__aureon.renderer.backend')
        def idle():
            page.wait_for_function('__aureon.ready', timeout=30000)
            page.wait_for_timeout(80)
        def command(cmd: str):
            page.evaluate('(cmd)=>__aureon.execute(cmd)', cmd)
            idle()
        def select(index: int, feature: int | None = None):
            page.evaluate('([i,f])=>{const b=__aureon.document.bodies[i];__aureon.selectBody(b.id,{featureId:f===null?null:b.features[f].id})}', [index,feature])
        def value(expr: str):
            return page.evaluate(expr)
        def volume(index: int = 0):
            return value(f'__aureon.meshes.get(__aureon.document.bodies[{index}].id).stats.volume')
        def close_form():
            page.locator('#operation-dialog [data-command="close-dialog"]').last.click()
            idle()
        def submit():
            page.locator('#operation-submit').click()
            page.wait_for_function('!document.querySelector("#operation-dialog").open', timeout=15000)
            idle()
        def fill(fields: dict):
            for name, val in fields.items():
                page.locator('#op-' + name).fill(str(val))
        record('Application initializes without uncaught exceptions', backend=backend)
        assert value('__aureon.document.bodies.length') == 10
        assert value('[...__aureon.meshes.values()].reduce((s,m)=>s+m.stats.triangles,0)') == 18606
        page.screenshot(path=str(ROOT / 'docs/workbench.png'))
        record('Ten-body, 28-feature reference assembly renders', triangles=18606)
        page.locator('#tree-filter').fill('Bearing carrier')
        assert page.locator('#tree .body').count() == 1
        page.locator('#tree .body').click()
        assert len(value('__aureon.selected')) == 1
        page.locator('#tree-filter').fill('')
        record('Specification-tree search and selection')
        page.locator('[data-workbench="assembly"]').click()
        assert value('__aureon.workbench') == 'assembly'
        command('explode')
        page.locator('#explode-range').fill('1')
        assert value('__aureon.renderer.exploded') == 1
        page.screenshot(path=str(ROOT / 'docs/exploded.png'))
        command('explode')
        page.locator('[data-workbench="part"]').click()
        record('Assembly workbench and exploded placement')
        command('new')
        assert value('__aureon.document.bodies.length') == 0
        page.locator('#ribbon [data-command="pad"]').click()
        fill({'name':'Test pad','width':60,'depth':40,'height':15,'corner':0})
        page.wait_for_timeout(450)
        idle()
        assert value('__aureon.document.bodies.length') == 0
        assert value('__aureon.renderer.doc.bodies.length') == 1
        close_form()
        assert value('__aureon.document.bodies.length') == 0
        record('Live preview does not mutate history; cancel restores geometry')
        command('pad')
        fill({'name':'Test pad','width':60,'depth':40,'height':15,'corner':0})
        submit()
        assert value('__aureon.document.bodies.length') == 1
        assert abs(volume() - 36000) < 0.01
        record('Numeric Pad definition creates a real 60×40×15 mm solid')
        command('fit')
        command('top')
        point = value('(()=>{const r=__aureon.renderer,rect=r.canvas.getBoundingClientRect(),q=r.camera.project([15,0,15],rect.width,rect.height);return[q[0]+rect.left,q[1]+rect.top]})()')
        command('select')
        page.mouse.click(*point)
        assert len(value('__aureon.selected')) == 1
        record('Viewport ray picking selects actual geometry')
        command('hole')
        fill({'radius':5,'height':17,'x':0,'y':0,'z':-1})
        submit()
        expected = 36000 - 48/2*25*math.sin(2*math.pi/48)*15
        assert abs(volume() - expected) < .01
        record('Through-hole command subtracts the expected volume')
        command('undo')
        assert abs(volume() - 36000) < .01
        command('redo')
        assert abs(volume() - expected) < .01
        record('Undo and redo reconstruct geometry')
        select(0,0)
        field = page.locator('#inspector [data-param="height"]')
        field.fill('25')
        field.press('Tab')
        page.wait_for_function('__aureon.document.bodies[0].features[0].params.height===25')
        idle()
        assert volume() > expected + 20000
        record('Inspector dimension edit invalidates and rebuilds downstream features')
        select(0,1)
        page.locator('[data-suppression]').check()
        page.wait_for_function('__aureon.document.bodies[0].features[1].suppressed')
        idle()
        assert abs(volume() - 60000) < .01
        page.locator('[data-suppression]').uncheck()
        page.wait_for_function('!__aureon.document.bodies[0].features[1].suppressed')
        idle()
        record('Feature suppression and restoration')
        page.locator('[data-material]').select_option('brass')
        page.wait_for_function('__aureon.document.bodies[0].material==="brass"')
        idle()
        select(0)
        command('transform')
        fill({'p0':12,'p1':7,'p2':4,'r0':0,'r1':0,'r2':30})
        submit()
        assert value('__aureon.document.bodies[0].position') == [12,7,4]
        record('Material assignment and rigid-body transform')
        command('duplicate')
        page.wait_for_function('__aureon.document.bodies.length===2')
        idle()
        a,b = value('__aureon.document.bodies')
        assert a['id'] != b['id'] and a['features'][0]['id'] != b['features'][0]['id']
        select(1)
        command('delete')
        page.wait_for_function('__aureon.document.bodies.length===1')
        idle()
        command('undo')
        assert value('__aureon.document.bodies.length') == 2
        record('Duplicate remaps IDs; delete is reversible')
        select(0)
        command('section')
        page.locator('#section-axis').select_option('0')
        page.locator('#section-range').fill('5')
        assert value('__aureon.renderer.section.enabled')
        assert value('__aureon.renderer.section.axis') == 0
        command('section')
        mode = value('__aureon.renderer.mode')
        for _ in range(4): command('render-mode')
        assert value('__aureon.renderer.mode') == mode
        projection = value('__aureon.renderer.camera.perspective')
        command('projection')
        assert value('__aureon.renderer.camera.perspective') != projection
        command('projection')
        record('Section clipping, four render modes, and camera projection')
        command('new')
        page.locator('[data-workbench="sketch"]').click()
        assert value('__aureon.sketcher.active')
        points = value('(()=>{const s=__aureon.sketcher,r=s.canvas.getBoundingClientRect();return[[-25,-15],[25,15]].map(p=>{const q=s.screen(p);return[q[0]+r.left,q[1]+r.top]})})()')
        page.mouse.move(*points[0]); page.mouse.down(); page.mouse.move(*points[1],steps=8);page.mouse.up()
        profile = value('__aureon.sketcher.profile')
        assert profile['width'] == 50 and profile['depth'] == 30
        page.screenshot(path=str(ROOT / 'docs/sketcher.png'))
        command('finish-sketch')
        fill({'height':12,'corner':0})
        submit()
        assert abs(volume() - 18000) < .01
        record('Pointer-drawn closed sketch extrudes into a solid')
        select(0,0)
        command('edit-sketch')
        page.locator('[data-sketch-param="width"]').fill('80')
        command('finish-sketch')
        page.wait_for_function('__aureon.document.bodies[0].features[0].params.width===80')
        idle()
        assert abs(volume() - 28800) < .01
        record('Existing sketch profile remains editable')
        command('hole');fill({'radius':3,'height':14,'x':10,'y':0,'z':-1});submit()
        select(0,1)
        command('pattern')
        fill({'count':3,'dx':10,'dy':0,'dz':0})
        submit()
        assert value('__aureon.document.bodies[0].features.at(-1).type') == 'pattern'
        expected = 28800 - 3 * 48/2*9*math.sin(2*math.pi/48)*12
        assert abs(volume() - expected) < .01
        record('Linear pattern repeats a subtractive feature')
        command('new')
        command('pad');fill({'width':40,'depth':40,'height':20,'corner':0});submit()
        select(0)
        command('cylinder');fill({'radius':8,'height':30,'x':0,'y':0,'z':-5});submit()
        assert value('__aureon.document.bodies.length') == 2
        select(0)
        command('boolean')
        page.locator('#op-operation').select_option('subtract')
        submit()
        assert not value('__aureon.document.bodies[1].visible')
        expected = 32000 - 48/2*64*math.sin(2*math.pi/48)*20
        assert abs(volume() - expected) < .01
        record('Linked two-body Boolean subtraction with hidden tool')
        page.locator('#viewport').focus()
        page.keyboard.press('Control+k')
        page.locator('#command-search').fill('Fit all')
        page.keyboard.press('Enter')
        assert not page.locator('#palette').evaluate('(e)=>e.open')
        record('Keyboard command palette filters and executes commands')
        # Exercise actual download events and then re-import the exported editable document.
        exported = ROOT / 'docs' / 'test-exports'
        exported.mkdir(exist_ok=True)
        for cmd in ['save','stl','obj','drawing','bom','screenshot']:
            with page.expect_download(timeout=15000) as event:
                command(cmd)
            download = event.value
            assert not download.failure()
            target = exported / download.suggested_filename
            download.save_as(str(target))
            assert target.stat().st_size > 80
        record('Project, STL, OBJ, SVG, BOM, and PNG download events')
        project = next(exported.glob('*.aureon.json'))
        saved_doc = json.loads(project.read_text())
        assert len(saved_doc['bodies']) == 2
        command('new')
        page.locator('#file-input').set_input_files(str(project))
        page.wait_for_function('__aureon.document.bodies.length===2')
        idle()
        assert abs(volume() - expected) < .01
        record('Saved editable document reopens and rebuilds identical geometry')
        stl = next(exported.glob('*.stl'))
        page.locator('#file-input').set_input_files(str(stl))
        page.wait_for_function('__aureon.document.bodies.length===3')
        idle()
        assert value('__aureon.document.bodies[2].features[0].type') == 'mesh'
        record('Exported binary STL reimports as an editable mesh body')
        command('demo')
        select(0)
        page.locator('[data-workbench="inspect"]').click()
        command('measure')
        command('top')
        coordinates = value('(()=>{const r=__aureon.renderer,rect=r.canvas.getBoundingClientRect();return[[-60,0,12],[60,0,12]].map(p=>{const q=r.camera.project(p,rect.width,rect.height);return[q[0]+rect.left,q[1]+rect.top]})})()')
        for xy in coordinates: page.mouse.click(*xy)
        measured = value('__aureon.measurements')
        assert len(measured) == 2
        assert abs(math.dist(*measured) - 120) < .05
        record('Two surface picks measure an actual 120 mm distance')
        command('measure');command('iso')
        page.locator('[data-workbench="part"]').click()
        page.evaluate('__aureon.selectBody(null)')
        page.mouse.move(20,10)
        page.wait_for_timeout(7200)
        page.screenshot(path=str(ROOT / 'docs/workbench.png'))
        assert not errors, errors
        assert not console_errors, console_errors
        if backend == 'WebGL2':
            assert value('__aureon.renderer.gl.getError()') == 0
        record('No page errors, console errors, or final GL errors')
        result = {'passed': len(checks), 'failed': 0, 'backend':backend,
                  'nativeWebGPUTested': backend=='WebGPU', 'standaloneInjection':args.standalone,
                  'localStorageTested':False,
                  'checks': checks, 'pageErrors':errors, 'consoleErrors':console_errors,
                  'warnings':warnings, 'browser':browser.version}
        (ROOT / 'docs/browser-test-results.json').write_text(json.dumps(result,indent=2))
        print(json.dumps({k:v for k,v in result.items() if k not in ['checks','warnings']},indent=2))
    except Exception as exc:
        print('FAIL:',str(exc),flush=True)
        page.screenshot(path=str(ROOT / 'docs/browser-failure.png'),timeout=5000)
        print('STATE:',page.evaluate('({text:document.querySelector("#operation-error")?.textContent,bodies:window.__aureon?.document.bodies,tree:document.querySelector("#tree-state")?.textContent})'))
        (ROOT / 'docs/browser-test-results.json').write_text(json.dumps({'passed':len(checks),'failed':1,'checks':checks,'error':str(exc),'pageErrors':errors,'consoleErrors':console_errors,'warnings':warnings},indent=2))
        raise
    finally:
        browser.close()
