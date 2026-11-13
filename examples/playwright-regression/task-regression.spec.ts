import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '任务清单' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});

test('TC01 添加正常任务并删除', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '任务名称' });
  await input.fill('核对发布清单');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('.task-title')).toHaveText('核对发布清单');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('active-count')).toHaveText('1');
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('任务已添加');
  await page.getByRole('button', { name: '删除 核对发布清单', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByTestId('active-count')).toHaveText('0');
  await expect(page.getByRole('status')).toHaveText('任务已删除');
});

test('TC02 完成、筛选与恢复', async ({ page }) => {
  for (const title of ['核对发布清单', '确认回滚方案']) {
    await page.getByRole('textbox', { name: '任务名称' }).fill(title);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
  }
  await page.getByRole('checkbox', { name: '完成 核对发布清单', exact: true }).check();
  await expect(page.getByTestId('active-count')).toHaveText('1');
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await page.getByRole('button', { name: '已完成', exact: true }).click();
  await expect(page.locator('.task-title')).toHaveText(['核对发布清单']);
  await expect(page.getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: '待完成', exact: true }).click();
  await expect(page.locator('.task-title')).toHaveText(['确认回滚方案']);
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('checkbox', { name: '完成 核对发布清单', exact: true }).uncheck();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await expect(page.getByTestId('active-count')).toHaveText('2');
  await expect(page.getByTestId('completed-count')).toHaveText('0');
});

test('TC03 拒绝空名称', async ({ page }) => {
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('请输入任务名称');
  await expect(page.getByRole('textbox', { name: '任务名称' })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByTestId('active-count')).toHaveText('0');
  await expect(page.getByTestId('completed-count')).toHaveText('0');
});

test('TC04 拒绝全部为空白的名称', async ({ page }) => {
  for (const title of ['   ', '\t', '\u3000 \u00a0']) {
    await page.getByRole('textbox', { name: '任务名称' }).fill(title);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('请输入任务名称');
    await expect(page.getByRole('listitem')).toHaveCount(0);
    await expect(page.getByTestId('active-count')).toHaveText('0');
    await expect(page.getByTestId('completed-count')).toHaveText('0');
  }
});

test('TC05 去除首尾空白并保留内部空格', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '任务名称' });
  await input.fill('  核对  发布清单\u3000');
  await input.press('Enter');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('.task-title')).toHaveJSProperty('textContent', '核对  发布清单');
  await expect(input).toHaveValue('');
});

test('TC06 按纯文本显示特殊内容', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  const title = '<img src=x onerror=alert(1)> & 核对权限';
  await page.getByRole('textbox', { name: '任务名称' }).fill(title);
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(page.locator('.task-title')).toHaveJSProperty('textContent', title);
  await expect(page.getByRole('listitem').locator('img, script')).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('checkbox')).toBeChecked();
  expect(dialogs).toEqual([]);
});

test('TC07 长名称在桌面和窄屏的浅深主题下均可操作', async ({ page }, testInfo) => {
  const title = '核对发布清单与回滚方案 / ' + 'release-checklist-'.repeat(12);
  await page.getByRole('textbox', { name: '任务名称' }).fill(title);
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await expect(page.getByRole('textbox', { name: '任务名称' })).toBeVisible();
      await expect(page.getByRole('button', { name: '添加任务', exact: true })).toBeVisible();
      await expect(page.locator('.task-title')).toHaveJSProperty('textContent', title);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const box = await page.locator('.task-title').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      await page.getByRole('checkbox').check();
      await expect(page.getByTestId('completed-count')).toHaveText('1');
      await page.getByRole('checkbox').uncheck();
      await expect(page.getByTestId('active-count')).toHaveText('1');
      const name = `${viewport.width === 390 ? 'mobile' : 'desktop'}-${colorScheme}`;
      const screenshot = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
    }
  }
});
