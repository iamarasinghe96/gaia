// movieId.js — identify a film from a snippet of overheard dialogue.
//
// No public subtitle API searches by dialogue content (OpenSubtitles matches on
// title, IMDb/TMDb id, or file hash), so the transcript goes to an AI model
// (Groq) through the Gaia Symbiosis server, which returns candidate titles.

import { call } from './api.js';

/**
 * @param  {string} transcript  Dialogue heard through the mic.
 * @return {Promise<Array<{title, year, confidence, why}>>}
 */
export async function identifyFilm(transcript) {
  if (!transcript || transcript.trim().length < 12) throw new Error('transcript-too-short');
  const { guesses } = await call({ action: 'identify', transcript: transcript.trim().slice(0, 4000) });
  return Array.isArray(guesses) ? guesses : [];
}
