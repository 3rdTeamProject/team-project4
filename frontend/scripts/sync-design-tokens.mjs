import { copyFileSync } from 'node:fs';

// Root file is shared with the team; the public copy also works inside the iframe.
copyFileSync(new URL('../../design-tokens.css', import.meta.url), new URL('../public/garden/design-tokens.css', import.meta.url));
