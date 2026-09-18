/**
 * Compile-and-load bridge for the legal routes in the content harness
 * (same pattern as `render-drilldown-screen.ts`).
 *
 * The routes default-export their screen functions; loading the compiled
 * route module directly through `import()` would hand the harness the CJS
 * exports OBJECT as `namespace.default` (node's CommonJS interop). This
 * bridge re-exports the route functions under NAMED exports so the harness
 * reads real functions off the module namespace and renders them with
 * react-test-renderer.
 */
import PrivacyRoute from '../src/app/legal/privacy';
import TermsRoute from '../src/app/legal/terms';

export { PrivacyRoute, TermsRoute };