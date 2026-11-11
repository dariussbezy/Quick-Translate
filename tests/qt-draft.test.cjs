const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function draftButton(job, succeeds = true) {
 const source = fs.readFileSync(path.join(__dirname, '../plugins/QT/js/original.js'), 'utf8');
 const start = source.indexOf('  const onPress = () => {', source.indexOf('  const translateSendMode ='));
 const end = source.indexOf('\n  const openPanel =', start);
 const calls = [];
 const usual = { targetOut: 'en', sourceOut: 'auto' };
 const context = {
  armed: job, props: { position: 'send' },
  settings: { draftBeforeSend: true, keepArmed: true },
  run: async (tl, sl) => { calls.push({ tl, sl }); return succeeds; },
  notifyButton() {}, toast() {}, getChatLanguages: () => usual,
 };
 const press = vm.runInNewContext(source.slice(start, end) + '\nonPress;', context);
 return { context, calls, usual, press };
}

test('a one-time draft language leaves the translated draft ready to send even when translation was already active', async () => {
 const button = draftButton({ tl: 'ro', sl: 'auto', oneShot: true, resume: { tl: 'en', sl: 'auto' } });
 button.press();
 await new Promise(setImmediate);
 assert.deepEqual(button.calls, [{ tl: 'ro', sl: 'auto' }]);
 assert.equal(button.context.armed, null, 'the send slot must return to native Send instead of translating again to English');
 assert.equal(button.usual.targetOut, 'en', 'the saved usual language must not change');
});

test('a failed one-time draft translation remains active for retry', async () => {
 const job = { tl: 'ro', sl: 'auto', oneShot: true, resume: { tl: 'en', sl: 'auto' } };
 const button = draftButton(job, false);
 button.press();
 await new Promise(setImmediate);
 assert.equal(button.context.armed, job);
});
