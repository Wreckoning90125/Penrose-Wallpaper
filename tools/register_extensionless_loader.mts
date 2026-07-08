// Entry point for `node --import ./tools/register_extensionless_loader.mts`.
// Registers the extensionless-TS resolve hook via module.register(), replacing
// the deprecated `--experimental-loader` flag (Node warns it may be removed).
import { register } from 'node:module';

register('./extensionless_ts_loader.mts', import.meta.url);
