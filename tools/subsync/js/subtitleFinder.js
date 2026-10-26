// subtitleFinder.js — search and download subtitles from OpenSubtitles.
//
// Their REST API needs a key on every call, and downloads need an account login,
// so both happen on the Gaia Symbiosis server; the browser only sends the film
// name or the chosen file.

import { call } from './api.js';

/**
 * Search by film title. Returns the candidates sorted by download count, which
 * correlates well with "the release most people actually have".
 *
 * @param {{title: string, year?: number, language: string}} q
 */
export async function searchSubtitles({ title, year, language }) {
  const { hits } = await call({ action: 'search', title, year: year || undefined, language: language || 'en' });
  return Array.isArray(hits) ? hits : [];
}

/**
 * Resolve a search hit to actual .srt text.
 *
 * @param {{fileId: number}} opts
 * @return {Promise<{name: string, text: string, remaining: number}>}
 */
export async function downloadSubtitle({ fileId }) {
  const { name, text, remaining } = await call({ action: 'download', fileId });
  return {
    name: name || 'subtitles.srt',
    text: typeof text === 'string' ? text : '',
    remaining: typeof remaining === 'number' ? remaining : null,
  };
}
