/**
 * Compile-and-load bridge for the category drill-down screen in the render
 * harness.
 *
 * tsc `include` globs treat `[key]` as a character class, so the screen
 * cannot be listed in `tsconfig.household-category-items-test.json`
 * directly. Module SPECIFIERS are not globbed, though — this wrapper
 * imports the screen by its literal path, which makes tsc compile and emit
 * `src/app/categories/[key].js` as a transitive dependency. The harness
 * then loads THIS module and renders `CategoryDetailScreen` with the real
 * compiled screen.
 */
import CategoryDetailScreen from '../src/app/categories/[key]';

export { CategoryDetailScreen };