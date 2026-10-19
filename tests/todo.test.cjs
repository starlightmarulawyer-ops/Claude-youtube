// 자동 테스트: 실제 크롬 브라우저로 index.html을 열어 기능을 하나씩 확인합니다.
// 실행: npm install && npm test
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PAGE_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

const results = [];
const pageErrors = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ✓ ' + name);
  } catch (err) {
    results.push({ name, ok: false });
    console.log('  ✗ ' + name);
    console.log('    ' + String(err && err.stack || err).split('\n').join('\n    '));
  }
}

// Each call gets its own browser profile folder, like a separate computer.
function newProfileDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chungnyeong-todo-'));
}

async function openBrowser(profileDir, options = {}) {
  const context = await chromium.launchPersistentContext(profileDir, options);
  // Fonts come from the internet; the tests should not depend on it.
  await context.route(/^https?:/, (route) => route.abort());
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto(PAGE_URL);
  return { context, page };
}

const items = (page) => page.locator('#list .item');
const itemTexts = (page) => page.locator('#list .item .text').allTextContents();
const summary = (page) => page.locator('#summary').textContent();

async function addTodo(page, text, via = 'button') {
  await page.fill('#new-task', text);
  if (via === 'enter') await page.press('#new-task', 'Enter');
  else await page.click('.btn-add');
}

(async () => {
  console.log('충녕 할 일 관리 — 자동 테스트\n');

  await test('처음 열면 예시 할 일 3개가 보인다', async () => {
    const { context, page } = await openBrowser(newProfileDir());
    assert.equal(await items(page).count(), 3);
    assert.equal(await summary(page), '남은 일 2건 · 완료 1건');
    assert.ok(await page.locator('#storage-warning').isHidden());
    await context.close();
  });

  await test('할 일 추가: 버튼과 Enter 키 모두 동작한다', async () => {
    const { context, page } = await openBrowser(newProfileDir());
    await addTodo(page, '소송위임장 서명 받기');
    await addTodo(page, '  사건 기록   복사 신청  ', 'enter');
    const texts = await itemTexts(page);
    assert.equal(texts.length, 5);
    assert.equal(texts[0], '사건 기록 복사 신청', '앞뒤 공백이 정리되고 맨 위에 추가되어야 함');
    assert.equal(texts[1], '소송위임장 서명 받기');
    assert.equal(await page.inputValue('#new-task'), '', '추가 후 입력란이 비워져야 함');
    assert.equal(await summary(page), '남은 일 4건 · 완료 1건');
    await context.close();
  });

  await test('빈 내용은 추가되지 않고 안내 문구가 나온다', async () => {
    const { context, page } = await openBrowser(newProfileDir());
    await addTodo(page, '   ');
    assert.equal(await items(page).count(), 3);
    assert.ok(await page.locator('#form-msg').isVisible());
    await page.type('#new-task', '가');
    assert.ok(await page.locator('#form-msg').isHidden(), '다시 입력하면 안내 문구가 사라져야 함');
    await context.close();
  });

  await test('완료 체크와 체크 해제가 된다', async () => {
    const { context, page } = await openBrowser(newProfileDir());
    const first = items(page).first();
    await first.locator('.row').click();
    assert.ok(await first.locator('.check-input').isChecked());
    assert.match(await first.getAttribute('class'), /is-done/);
    assert.match(await first.locator('.when').textContent(), /완료$/);
    assert.equal(await summary(page), '남은 일 1건 · 완료 2건');
    await first.locator('.row').click();
    assert.ok(!(await first.locator('.check-input').isChecked()));
    assert.equal(await summary(page), '남은 일 2건 · 완료 1건');
    await context.close();
  });

  await test('삭제하면 사라지고, 되돌리기를 누르면 같은 자리로 돌아온다', async () => {
    const { context, page } = await openBrowser(newProfileDir());
    const before = await itemTexts(page);
    await items(page).nth(1).locator('.del').click();
    assert.deepEqual(await itemTexts(page), [before[0], before[2]]);
    assert.ok(await page.locator('#toast').isVisible());
    await page.click('#undo');
    assert.deepEqual(await itemTexts(page), before);
    assert.ok(await page.locator('#toast').isHidden());
    await context.close();
  });

  await test('모두 삭제하면 안내 문구가 나오고, 다시 열어도 예시가 되살아나지 않는다', async () => {
    const dir = newProfileDir();
    let { context, page } = await openBrowser(dir);
    while (await items(page).count()) await items(page).first().locator('.del').click();
    assert.ok(await page.locator('#empty').isVisible());
    assert.equal(await summary(page), '등록된 할 일 없음');
    await context.close();

    ({ context, page } = await openBrowser(dir));
    assert.equal(await items(page).count(), 0);
    assert.ok(await page.locator('#empty').isVisible());
    await context.close();
  });

  await test('브라우저를 완전히 닫았다가 다시 열어도 할 일과 완료 표시가 남아 있다', async () => {
    const dir = newProfileDir();
    let { context, page } = await openBrowser(dir);
    await addTodo(page, '항소이유서 제출 기한 확인');
    await items(page).first().locator('.row').click();
    await items(page).last().locator('.del').click();
    const expectedTexts = await itemTexts(page);
    const expectedDone = await page.locator('#list .check-input').evaluateAll((els) => els.map((el) => el.checked));
    await context.close(); // 브라우저 종료

    ({ context, page } = await openBrowser(dir)); // 같은 브라우저 프로필로 다시 실행
    assert.deepEqual(await itemTexts(page), expectedTexts);
    assert.deepEqual(
      await page.locator('#list .check-input').evaluateAll((els) => els.map((el) => el.checked)),
      expectedDone,
    );
    assert.deepEqual(expectedDone, [true, false, false]);
    await context.close();
  });

  await test('입력한 글자에 HTML 코드가 있어도 실행되지 않고 글자 그대로 보인다', async () => {
    const { context, page } = await openBrowser(newProfileDir());
    const nasty = '<img src=x onerror="window.__hacked=1">';
    await addTodo(page, nasty);
    assert.equal((await itemTexts(page))[0], nasty);
    assert.equal(await page.evaluate(() => window.__hacked), undefined);
    assert.equal(await page.locator('#list img').count(), 0);
    await context.close();
  });

  await test('저장이 막힌 브라우저에서도 화면은 동작하고 안내 문구가 나온다', async () => {
    const dir = newProfileDir();
    const context = await chromium.launchPersistentContext(dir);
    await context.route(/^https?:/, (route) => route.abort());
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('blocked', 'SecurityError'); },
      });
    });
    const page = context.pages()[0] || await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.goto(PAGE_URL);
    assert.ok(await page.locator('#storage-warning').isVisible());
    await addTodo(page, '저장 안 되는 환경 테스트');
    assert.equal((await itemTexts(page))[0], '저장 안 되는 환경 테스트');
    await context.close();
  });

  for (const [label, viewport] of [['아이폰 13 (390px)', devices['iPhone 13'].viewport], ['작은 휴대폰 (320px)', { width: 320, height: 640 }]]) {
    await test(`스마트폰 화면 ${label}에서 가로로 넘치지 않고 버튼이 누르기 충분히 크다`, async () => {
      const { context, page } = await openBrowser(newProfileDir(), {
        viewport,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 13'].userAgent,
      });
      await addTodo(page, '띄어쓰기없이아주길게적은할일'.repeat(8));
      // 글자 폭이 넓은 글꼴이 적용돼 입력란의 기본 폭이 커진 경우도 흉내 냅니다.
      await page.$eval('#new-task', (el) => { el.size = 60; });
      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      assert.ok(widths.scroll <= widths.client, `가로 넘침: ${widths.scroll} > ${widths.client}`);
      for (const sel of ['.btn-add', '#list .del', '#list .row']) {
        const box = await page.locator(sel).first().boundingBox();
        assert.ok(box.height >= 44 && box.width >= 44, `${sel} 크기가 작음: ${box.width}x${box.height}`);
        assert.ok(box.x + box.width <= widths.client, `${sel}이(가) 화면 밖으로 나감`);
      }
      const fontSize = await page.$eval('#new-task', (el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(fontSize >= 16, '아이폰에서 입력 시 화면이 확대되지 않으려면 16px 이상이어야 함');
      await page.locator('#list .row').first().tap();
      assert.ok(await items(page).first().locator('.check-input').isChecked(), '손가락 탭으로 완료 체크');
      await context.close();
    });
  }

  await test('페이지에서 스크립트 오류가 발생하지 않는다', async () => {
    assert.deepEqual(pageErrors, []);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
})();
