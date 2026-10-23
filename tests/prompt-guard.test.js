// Guards the AI prompt files against unrequested changes.
// Every approved change is listed in tests/prompt-ledger.json. This test undoes those
// edits and checks that what is left is byte-for-byte the original prompt, so any other
// edit, deletion or reformatting anywhere in a prompt fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const ledger = JSON.parse(readFileSync(new URL('tests/prompt-ledger.json', root), 'utf8'));
const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
const count = (s, part) => s.split(part).length - 1;

for (const [file, { baselineSha256, edits }] of Object.entries(ledger.files)) {
  test(`${file}: only the approved edits differ from the original`, () => {
    let text = readFileSync(new URL(file, root), 'utf8');
    for (const [i, edit] of edits.map((e, n) => [n, e]).reverse()) {
      assert.equal(count(text, edit.after), 1, `approved edit ${i + 1} ("${edit.why}") is missing or was changed`);
      text = text.replace(edit.after, () => edit.before);
    }
    assert.equal(sha256(text), baselineSha256,
      `${file} has a change that is not in tests/prompt-ledger.json. Undo it, or add it to the ledger only if the owner asked for it.`);
  });
}
