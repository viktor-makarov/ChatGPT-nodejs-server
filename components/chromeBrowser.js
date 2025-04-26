const puppeteer = require('puppeteer');

  const launchBrowserHeadless = async () => {


    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Удобно для облачных/VPS-окружений
    });
    console.log(new Date,"Success! Chrome headless browser launched")
    return browser;
  };
  

module.exports = {
  launchBrowserHeadless
}