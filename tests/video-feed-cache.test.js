const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('new uploads bypass the old feed cache and refresh after one minute', async () => {
  let clock = Date.now();
  const stored = new Map([['monstarz-data-cache:videos:youtube', JSON.stringify({time: clock, data: {items: []}})]]);
  const requests = [];
  const sandbox = {
    window: {},
    Date: class extends Date {static now() {return clock;}},
    localStorage: {getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value)},
    fetch: async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => ({items: [{videoId: '-_O_ZIh7bJc', title: '캄몬카드랜덤디펜스'}]})};
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../services/data-services.js'), 'utf8'), sandbox);
  const videos = sandbox.window.MonstarzDataServices.videos;
  const first = await videos('youtube', 'https://example.com/youtube.json');
  assert.equal(first.data.items[0].videoId, '-_O_ZIh7bJc');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.ok(requests[0].url.includes('?feedVersion=2&minute='));
  await videos('youtube', 'https://example.com/youtube.json');
  assert.equal(requests.length, 1);
  clock += 61000;
  await videos('youtube', 'https://example.com/youtube.json');
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].url, requests[1].url);
  await videos('youtube', 'https://example.com/youtube.json', {refresh: true});
  assert.equal(requests.length, 3);
});
