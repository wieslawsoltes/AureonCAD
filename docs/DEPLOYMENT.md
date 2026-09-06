# GitHub Pages deployment

Application: https://wieslawsoltes.github.io/AureonCAD/

Standalone edition: https://wieslawsoltes.github.io/AureonCAD/dist/AureonCAD.html

Workflow: https://github.com/wieslawsoltes/AureonCAD/actions/workflows/pages.yml

The `Test and deploy Aureon CAD` workflow tests pull requests, and tests and publishes pushes to `main`. It can also be started manually from Actions. Deployment requires the `github-pages` environment and Pages enabled for GitHub Actions.

The build runs the 31 kernel/data tests, rebuilds the standalone HTML and example exports, runs the 24 standalone browser workflow checks, and tests modular loading under a subdirectory URL. Only a passing build is uploaded to Pages. After publication, a separate job opens the public HTTPS URL with Playwright, checks the expected commit in `version.json`, waits for real rendered frames and the ten-body assembly, and checks both forced WebGL2 and automatic renderer selection.

Browser automation uses Chromium software adapters. An automatic-renderer smoke check records which backend actually initialized; it is not a hardware performance benchmark or complete WebGPU feature qualification. See the evidence artifacts in each workflow run and `VERIFICATION.md` for the original scope of verification.

## Local deployment build

```sh
npm test
npm run build
node scripts/build-examples.mjs
node scripts/build-site.mjs
python3 -m http.server 8080
```

Open `http://localhost:8080/_site/`. Runtime assets are relative to the application URL, including the module worker. No server-side application, API keys, or CDN dependencies are needed.

For optional browser verification:

```sh
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium
python3 tests/published_smoke.py --url http://localhost:8080/_site/
```

The deployment identity is available at `version.json`. CI retains test logs/screenshots and published-site evidence as workflow artifacts for 14 days. Future pushes to `main` automatically rebuild, verify, and replace the Pages deployment.
