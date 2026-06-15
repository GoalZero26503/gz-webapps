// Client entry: registers all Lit components. Bundled by esbuild to
// /public/assets/app.js (see build:client). Keep this bundle lean — the
// default stack ships HTML; Lit is only for genuinely stateful widgets.
import './components/gz-sparkline.js';
import './components/gz-deploy-config-editor.js';
