const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/inbucket-mail.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.map((marker) => source.indexOf(marker)).find((index) => index >= 0);
  if (start < 0) throw new Error(`missing function ${name}`);

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) signatureEnded = true;
    }
    if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) throw new Error(`missing body for ${name}`);

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

test('Inbucket polling skips visible older messages after resend timestamp', async () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('normalizeDisplayText'),
    extractFunction('normalizeMinuteTimestamp'),
    extractFunction('parseMailboxTimestampText'),
    extractFunction('extractVerificationCode'),
    extractFunction('rowMatchesFilters'),
    extractFunction('getMailboxEntryId'),
    extractFunction('parseMailboxEntry'),
    extractFunction('getCurrentMailboxIds'),
    extractFunction('handleMailboxPollEmail'),
  ].join('\n');

  const api = new Function(`
function makeNode(text = '') { return { textContent: text }; }
function makeEntry(id, code, dateText) {
  return {
    classList: {
      contains(name) { return name === 'unseen'; },
    },
    getAttribute(name) { return name === 'data-id' ? id : ''; },
    dataset: { id },
    querySelector(selector) {
      if (selector === '.subject') return makeNode('Your ChatGPT verification code ' + code);
      if (selector === '.from') return makeNode('OpenAI');
      if (selector === '.date') return makeNode(dateText);
      return null;
    },
  };
}
const oldEntry = makeEntry('old', '111111', '10:00');
const newEntry = makeEntry('new', '222222', '10:02');
function findMailboxEntries() { return [oldEntry, newEntry]; }
function log() {}
async function waitForElement() { return true; }
async function refreshMailbox() {}
async function sleep() {}
async function openMailboxEntry() {}
async function deleteCurrentMailboxMessage() {}
let seenMailIds = new Set();
async function persistSeenMailIds() {}
${bundle}
return { handleMailboxPollEmail };
`)();

  const now = new Date();
  const filterAfterTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 1, 0, 0).getTime();
  const result = await api.handleMailboxPollEmail(8, {
    senderFilters: ['openai'],
    subjectFilters: ['verification'],
    maxAttempts: 4,
    intervalMs: 1,
    filterAfterTimestamp,
  });

  assert.equal(result.code, '222222');
  assert.equal(result.mailId, 'new');
});
