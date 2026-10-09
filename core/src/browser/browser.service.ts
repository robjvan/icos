import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { Browser, Page } from 'playwright';

const NAV_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 16 * 1024;

/** Code-only browser failure; the executor maps it to a tool-failure code. */
export class BrowserError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'BrowserError';
  }
}

export type BrowserAction =
  | { action: 'navigate'; url: string }
  | { action: 'snapshot' }
  | { action: 'click'; selector: string }
  | { action: 'type'; selector: string; text: string }
  | { action: 'scroll'; dy: number }
  | { action: 'screenshot' };

/**
 * M17d.3 minimal browser (Playwright + headless Chromium). One page per
 * session, lazily launched, closed on shutdown. Read/interaction actions are
 * bounded (timeouts, text cap) and approval-free — like `web_extract`. Only
 * http(s) navigation is allowed. The heavy `playwright` dependency is
 * lazy-imported so a disabled/unused browser never loads it.
 */
@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private browser: Browser | null = null;
  private readonly pages = new Map<string, Page>();

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  async onModuleDestroy(): Promise<void> {
    this.pages.clear();
    const browser = this.browser;
    this.browser = null;
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  async run(sessionId: string, action: BrowserAction): Promise<unknown> {
    const page = await this.pageFor(sessionId);
    switch (action.action) {
      case 'navigate': {
        const url = safeHttpUrl(action.url);
        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: NAV_TIMEOUT_MS,
          });
        } catch {
          throw new BrowserError('browser_navigation_failed');
        }
        return this.snapshot(page);
      }
      case 'snapshot':
        return this.snapshot(page);
      case 'click': {
        try {
          await page.click(action.selector, { timeout: ACTION_TIMEOUT_MS });
        } catch {
          throw new BrowserError('browser_selector_failed');
        }
        return this.snapshot(page);
      }
      case 'type': {
        try {
          await page.fill(action.selector, action.text, {
            timeout: ACTION_TIMEOUT_MS,
          });
        } catch {
          throw new BrowserError('browser_selector_failed');
        }
        return { ok: true };
      }
      case 'scroll': {
        await page.mouse.wheel(0, action.dy);
        return { ok: true };
      }
      case 'screenshot': {
        const dir = join(
          this.config.toolsWorkspaceRoot ?? process.cwd(),
          'browser',
        );
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${randomUUID()}.png`);
        await page.screenshot({ path: file, fullPage: false });
        return { path: file };
      }
    }
  }

  private async snapshot(page: Page): Promise<Record<string, unknown>> {
    let text = '';
    try {
      text = await page
        .locator('body')
        .innerText({ timeout: ACTION_TIMEOUT_MS });
    } catch {
      text = '';
    }
    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated: text.length > MAX_TEXT_CHARS,
    };
  }

  private async pageFor(sessionId: string): Promise<Page> {
    const existing = this.pages.get(sessionId);
    if (existing) return existing;
    const browser = await this.ensureBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    this.pages.set(sessionId, page);
    return page;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    try {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({
        headless: true,
        // Chromium's sandbox needs privileges the container does not grant.
        args: ['--no-sandbox'],
      });
    } catch (err) {
      this.logger.warn(
        `Browser launch failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      throw new BrowserError('browser_unavailable');
    }
    return this.browser;
  }
}

function safeHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new BrowserError('invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrowserError('invalid_url');
  }
  return parsed.toString();
}
