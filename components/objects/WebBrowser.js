
const otherFunctions = require("../common_functions.js");

class WebBrowser {

#page = null;
#timeout;
#delayMs;
#url;
#browserInstance;
#viewportWidth = 1024;
#viewportHeight = 768;
#screenShotType = 'png';
#screenShotFullPage = false;

    constructor({ delayMs, timeout} = {}) {
       this.#delayMs = delayMs || 5_000;
       this.#timeout = timeout || 30_000;
       this.#browserInstance = global.chromeBrowserHeadless;
    }

    async createPage(url, {width, height} = {}) {
        if (this.#page) {
            throw new Error('Page already exists. Please close it before creating a new one.');
        }
        if (url === undefined || url === null) {
          throw new Error('URL parameter is required');
       }
        this.#url = url;
        this.#viewportWidth = width || this.#viewportWidth;
        this.#viewportHeight = height || this.#viewportHeight;

        this.#page = await this.#browserInstance.newPage();
        await this.#page.setViewport({ width: this.#viewportWidth, height: this.#viewportHeight });
    }

    async navigateToUrl() {

        if (!this.#page) {
            throw new Error('Page is not created. Please create a page before navigating.');
        }
        await this.#page.goto(this.#url, { waitUntil: 'networkidle2', timeout: this.#timeout });
        await otherFunctions.delay(this.#delayMs);
    }

    async takeScreenshot({ type, fullPage } = {}) {

        if (!this.#page) {
            throw new Error('Page is not created. Please create a page before taking a screenshot.');
        }
        this.#screenShotType = type || this.#screenShotType;
        this.#screenShotFullPage = fullPage || this.#screenShotFullPage;

        const screenshotOptions = {
            type: this.#screenShotType,
            fullPage: this.#screenShotFullPage
        };
        return await this.#page.screenshot(screenshotOptions);
    }

    async closePage() {
        if (this.#page) {
            await this.#page.close();
            this.#page = null;
        }
    }

}

module.exports = WebBrowser;