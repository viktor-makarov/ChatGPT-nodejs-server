const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')
puppeteer.use(AdblockerPlugin());

const rawHeadless = process.env.PUPPETEER_HEADLESS ?? 'true';
const DEFAULT_HEADLESS =
  typeof rawHeadless === 'string'
    ? (rawHeadless.trim().toLowerCase() === 'true'
        ? true
        : rawHeadless.trim().toLowerCase() === 'false'
          ? false
          : rawHeadless)
    : rawHeadless;

  const launchBrowserHeadless = async () => {

    const browser = await puppeteer.launch({
      headless: DEFAULT_HEADLESS,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--no-default-browser-check'
      ],
      defaultViewport: {width: 1024, height: 768}
    });
    console.log(new Date,"Success! Chrome headless browser launched")
    return browser;
  };
  

module.exports = {
  launchBrowserHeadless
}