const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/qq-mail.js', 'utf8');

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

test('QQ mailbox polling skips mails older than filterAfterTimestamp when timestamp is visible', async () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('normalizeMinuteTimestamp'),
    extractFunction('parseMailTimestampText'),
    extractFunction('getMailItemTimestamp'),
    extractFunction('getCurrentMailIds'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
const opened = [];
function makeNode(text = '', attrs = {}) {
  return {
    textContent: text,
    getAttribute(name) { return attrs[name] || ''; },
  };
}
const oldMail = {
  mailId: 'old',
  querySelector(selector) {
    if (selector === '.cmp-account-nick') return makeNode('OpenAI');
    if (selector === '.mail-subject') return makeNode('Your verification code');
    if (selector === '.mail-digest') return makeNode('Use 111111 to continue');
    if (selector.includes('time') || selector.includes('date')) return makeNode('10:00');
    return null;
  },
  getAttribute(name) { return name === 'data-mailid' ? 'old' : ''; },
};
const newMail = {
  mailId: 'new',
  querySelector(selector) {
    if (selector === '.cmp-account-nick') return makeNode('OpenAI');
    if (selector === '.mail-subject') return makeNode('Your verification code');
    if (selector === '.mail-digest') return makeNode('Use 222222 to continue');
    if (selector.includes('time') || selector.includes('date')) return makeNode('10:02');
    return null;
  },
  getAttribute(name) { return name === 'data-mailid' ? 'new' : ''; },
};
const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') return [oldMail, newMail];
    return [];
  },
};
function log() {}
async function waitForElement() { return true; }
async function refreshInbox() {}
async function sleep() {}
function extractVerificationCode(text) {
  const match = String(text || '').match(/(\\d{6})/);
  return match ? match[1] : null;
}
${bundle}
return { handlePollEmail };
`)();

  const now = new Date();
  const filterAfterTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 1, 0, 0).getTime();
  const result = await api.handlePollEmail(8, {
    senderFilters: ['openai'],
    subjectFilters: ['verification'],
    maxAttempts: 4,
    intervalMs: 1,
    filterAfterTimestamp,
  });

  assert.equal(result.code, '222222');
  assert.equal(result.mailId, 'new');
});
