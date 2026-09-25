// Installs the extensionless-import resolver. Used via `node --import`.
//
// Lives in scripts/ rather than test/ because it is not test-only: `npm run
// migrate` needs it too, and an npm script pointing at a file under test/ reads
// like a mistake.
import { register } from 'node:module';
register('./esm-resolve.mjs', import.meta.url);
