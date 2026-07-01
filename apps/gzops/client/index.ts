// Client entry: registers all Lit components. Bundled by esbuild to
// /public/assets/app.js (see build:client). Keep this bundle lean — the
// default stack ships HTML; Lit is only for genuinely stateful widgets.
import './confirm-modal.js'; // themed confirm modal + window.gzConfirm + htmx:confirm hook
import './cell-actions.js'; // Status-rail cell action menu (View / Promote / Un-publish)
import './deploy-confirm.js'; // Kits & Releases: client-side Confirm section → CHECK → DEPLOY
import './components/gz-sparkline.js';
import './components/gz-deploy-config-editor.js';
import './components/gz-kit-release.js';
