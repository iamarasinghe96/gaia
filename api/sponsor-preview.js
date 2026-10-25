// GET /api/sponsor-preview — 10 company names for the landing page ticker, always drawn
// from the same fixed pool of 30, plus the size of the sponsor list. Needs SPONSOR_LIST_KEY.
import { safeHandler } from '../lib/safe-handler.js';

export default safeHandler(async () => {
  const [{ makePreviewHandler }, { sponsorNames, previewPool }] = await Promise.all([import('../lib/search-handlers.js'), import('../lib/sponsors.js')]);
  return makePreviewHandler({ names: sponsorNames, pool: previewPool });
});
