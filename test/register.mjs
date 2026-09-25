// Installs the extensionless-import resolver. Used via `node --import`.
import { register } from 'node:module';
register('./resolve-hook.mjs', import.meta.url);
