// POST /api/import — "Import from CV": reads a CV and fills the CV Prompt Builder profile (Vercel serverless function).
// Uses the same environment variables as api/polish.js.
import { extractText, getDocumentProxy } from 'unpdf';
import { makeImportHandler } from '../lib/import-handler.js';
import { allow, isAllowedOrigin, verifyIdToken } from '../lib/admin.js';

export default makeImportHandler({
  apiKey: process.env.GROQ_API_KEY,
  isAllowedOrigin,
  verifyIdToken,
  allow,
  pdfToText: async bytes => {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text || '');
  },
});
