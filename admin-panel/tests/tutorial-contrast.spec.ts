/** Driver primary actions stay readable during pointer and keyboard use. */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
const css = readFileSync('src/app/globals.css', 'utf8');
const driver = readFileSync('node_modules/driver.js/dist/driver.css', 'utf8');
for (const theme of ['light', 'dark']) {
  test(`tutorial next and done contrast on hover and focus (${theme}) @J303`, async ({ page }) => {
    await page.setContent(`<html class="${theme}"><body><div class="driver-popover sellf-tour"><button class="driver-popover-next-btn driver-popover-footer-btn">Dalej</button></div></body></html>`);
    await page.addStyleTag({ content: `${css}\n${driver}` });
    const button = page.getByRole('button');
    const contrast = () => button.evaluate(el => {
      const style = getComputedStyle(el);
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    for (const label of ['Dalej', 'Zakończ']) {
      await button.evaluate((el, text) => { el.textContent = text; }, label);
      await button.hover();
      expect(await contrast()).toBeGreaterThanOrEqual(4.5);
      await page.mouse.move(0, 0);
      await page.keyboard.press('Tab');
      await button.focus();
      await expect(button).toBeFocused();
      expect(await contrast()).toBeGreaterThanOrEqual(4.5);
      await button.evaluate(el => (el as HTMLButtonElement).blur());
    }
  });
}
