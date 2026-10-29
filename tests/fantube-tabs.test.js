const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('desktop and mobile keep Sonsilva videos in the first dedicated tab', () => {
  for (const file of ['index.html', 'mobile/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const mobile = file.startsWith('mobile');
    const start = html.indexOf(mobile ? '  function isMobileSonsilvaVideo' : '  function isSonsilvaVideo');
    const end = html.indexOf(mobile ? '  function renderFantube' : '  function sortYoutubeItems', start);
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(html.slice(start, end), sandbox);
    if (mobile) sandbox.isMobileYoutubeShort = item => !!item.isShort;
    const matches = sandbox[mobile ? 'matchesFantubeType' : 'matchesYoutubeType'];
    for (const item of [{name: '손실바', isShort: false}, {channelId: 'UCUF7NDYzBA_ezR4XyvzK3Sw', isShort: true}]) {
      assert.equal(matches(item, 'sonsilva'), true);
      assert.equal(matches(item, 'longform'), false);
      assert.equal(matches(item, 'shorts'), false);
    }
    assert.equal(matches({name: '다른 채널', isShort: false}, 'longform'), true);
    const attr = mobile ? 'data-fantube-type' : 'data-youtube-type';
    assert.equal(html.match(new RegExp(attr + '="([^"]+)"'))[1], 'sonsilva');
  }
});
