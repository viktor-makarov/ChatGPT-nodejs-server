const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')
puppeteer.use(AdblockerPlugin());

  const launchBrowserHeadless = async () => {

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Удобно для облачных/VPS-окружений
    });
    console.log(new Date,"Success! Chrome headless browser launched")
    return browser;
  };
  

module.exports = {
  launchBrowserHeadless
}