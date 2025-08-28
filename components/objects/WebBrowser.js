
const EventEmitter = require('events');

class WebBrowser extends EventEmitter {

#pages = new Map(); // Store { page, url } objects with IDs
#currentPageId = null;
#timeout;
#delayMs;
#browserInstance;
#viewportWidth = 1024;
#viewportHeight = 768;
#screenShotType = 'png';
#screenShotFullPage = false;

    constructor({browserInstance, delayMs, timeout} = {}) {
       super({ readableObjectMode: true });
        if (!browserInstance) {  
            throw new Error(`Browser instance is required.`);
       }
       this.#delayMs = delayMs || 5_000;
       this.#timeout = timeout || 30_000;
       this.#browserInstance = browserInstance;
    }

    get currentPage() {
        const page = this.#pages.get(this.#currentPageId);
        return page ? page : null;
    }

    get currentURL(){
        const page = this.#pages.get(this.#currentPageId);
        return page ? page.url() : null;
    }

    get currentPageId() {
        return this.#currentPageId;
    }

    getURLByID(pageId) {
        const page = this.#pages.get(pageId);
        return page ? page.url() : null;
    }

    getPageByID(pageId) {
        const page = this.#pages.get(pageId);
        return page ? page : null;
    }

    async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
    }

    async createPage(pageId = 'main') {
        if (this.#pages.has(pageId)) {  
            throw new Error(`Page with ID '${pageId}' already exists.`);
        }

        const page = await this.#browserInstance.newPage();

        this.#pages.set(pageId, page);
        this.#currentPageId = pageId;
        

        // Handle new tabs/popups automatically
        page.on('popup', async (newPage) => {
            const newPageId = `tab_${Date.now()}`;
            this.#pages.set(newPageId, newPage);
            
            newPage.on('load', () => {
                this.emit('newTab', newPageId);
            });
        });

        return pageId;
    }

    async navigateToUrl(url) {
        if (!this.currentPage) {
            throw new Error('Page is not created. Please create a page before navigating.');
        }
        if (url === undefined || url === null) {
          throw new Error('URL parameter is required');
        }

        await this.currentPage.goto(url, { waitUntil: 'networkidle2', timeout: this.#timeout });
    }

    switchToPage(pageId) {
        if (!this.#pages.has(pageId)) {
            throw new Error(`Page with ID '${pageId}' does not exist.`);
        }
        this.#currentPageId = pageId;
        return pageId;
    }

    async goBack(){
        if (!this.currentPage) {
            throw new Error('Page is not created. Please create a page before going back.');
        }
        await this.currentPage.goBack({ waitUntil: 'networkidle2', timeout: this.#timeout });
    }

    getAllPageIds() {
        return Array.from(this.#pages.keys());
    }

    getAllPagesInfo() {
        const pagesInfo = {};
        for (const [pageId, page] of this.#pages) {
            pagesInfo[pageId] = {
                url: page.url(),
                isActive: pageId === this.#currentPageId
            };
        }
        return pagesInfo;
    }

    async setViewport({ width, height }= {}) {
        if (!this.currentPage) {
            throw new Error('Page is not created. Please create a page before navigating.');
        }
        this.#viewportWidth = width || this.#viewportWidth;
        this.#viewportHeight = height || this.#viewportHeight;
        await this.currentPage.setViewport({ width: this.#viewportWidth, height: this.#viewportHeight });
    };

    async takeCurrentPageScreenshot({ type, fullPage } = {}) {
        if (!this.currentPage) {
            throw new Error('Page is not created. Please create a page before taking a screenshot.');
        }
        this.#screenShotType = type || this.#screenShotType;
        this.#screenShotFullPage = fullPage || this.#screenShotFullPage;

        const screenshotOptions = {
            type: this.#screenShotType,
            fullPage: this.#screenShotFullPage
        };
        return await this.currentPage.screenshot(screenshotOptions);
    }

    async currentPageMetrics(){
        if (!this.currentPage) {
            throw new Error('Page is not created. Please create a page before getting metrics.');
        }
        const metrics = await this.currentPage.metrics();
        return metrics
    }

    async performAction(action) {
        if (!action || typeof action !== 'object') {
            console.warn('performAction called with an empty or invalid action:', action);
            return;
        }
        const { type: actionType } = action;

    switch (actionType) {
      case 'click': {
        const { x, y, button = 'left' } = action;
        await this.currentPage.mouse.click(x, y, { button });
        return {
            action_desc:`Action: click at (${x}, ${y}) with button '${button}'`
        };
      }

      case 'double_click': { //test
        const { x, y, button = 'left' } = action;
        // Puppeteer double-click = clickCount: 2
        await this.currentPage.mouse.click(x, y, { button, clickCount: 2 });
        return {
            action_desc:`Action: double-click at (${x}, ${y}) with button '${button}'`
        };
      }

      case 'drag': {
        const { path = [] } = action;
        
        if (path.length < 2) {
          console.warn('Drag action requires at least 2 points in path');
          return {
            action_desc: 'Action: drag failed - insufficient path points'
          };
        }

        const startPoint = path[0];
        const endPoint = path[path.length - 1];
        
        // Move to start position and press mouse down
        await this.currentPage.mouse.move(startPoint.x, startPoint.y);
        await this.currentPage.mouse.down();
        
        // Move through all intermediate points if any
        for (let i = 1; i < path.length; i++) {
          await this.currentPage.mouse.move(path[i].x, path[i].y);
        }
        
        // Release mouse at end position
        await this.currentPage.mouse.up();
        return {
          action_desc: `Action: drag from (${startPoint.x}, ${startPoint.y}) to (${endPoint.x}, ${endPoint.y}) through ${path.length} points`
        };
      }

      case 'scroll': { //test
        const { x, y, scroll_x = 0, scroll_y = 0 } = action;
        
        // Move the mouse so the wheel event is sent to the correct element.
        await this.currentPage.mouse.move(x, y);
        await this.currentPage.mouse.wheel({ deltaX: scroll_x, deltaY: scroll_y });
        return {
            action_desc:`Action: scroll at (${x}, ${y}) with offsets (scrollX=${scroll_x}, scrollY=${scroll_y})`
        };
      }

      case 'keypress': {
        const { keys = [] } = action;
        let actions = "";
        if(keys.length === 1){
            const mappedKey = this.mapKeyName(keys[0]);
            await this.currentPage.keyboard.press(mappedKey);
            actions += `Action: keypress '${mappedKey}'`;
        } else if (keys.length === 2){
            const [key1, key2] = keys.map(this.mapKeyName);
            await this.currentPage.keyboard.down(key1);
            await this.currentPage.keyboard.press(key2);
            await this.currentPage.keyboard.up(key1);
            actions += `Action: keypress '${key1}+${key2}'`;
        } else {
            actions += `Action not processed: keypress '${keys.map(this.mapKeyName).join(' + ')}'`;
        }

        return {
            action_desc: actions
        };
      }

      case 'type': {
        const { text = '' } = action;

        await this.currentPage.keyboard.type(text);
        return {
            action_desc: `Action: type text '${text}'`
        };
      }

      case 'wait': {
        const { ms = 2000 } = action;
        await this.delay(ms);
        return {
            action_desc: `Action: wait for ${ms} ms`
        };
      }

      case 'screenshot': {
        return {
            action_desc: `Action: screenshot (handled elsewhere)`
        };
      }

      default:
        console.warn(new Date(),'Unrecognized action:', action);
        return {
            action_desc: `!!!!!!!!!!!!!!!Action: unrecognized action '${actionType}'`
        };
        }
    }

    mapKeyName(key) {
        const keyMap = {
            'CTRL': 'Control',
            'ALT': 'Alt',
            'SHIFT': 'Shift',
            'ESC': 'Escape',
            'ENTER': 'Enter',
            'TAB': 'Tab',
            'SPACE': ' ',
            'DELETE': 'Delete',
            'BACKSPACE': 'Backspace'
        };
        return keyMap[key.toUpperCase()] || key;
    }


    async closeCurrentPage() {
        if (this.currentPage) {
            await this.currentPage.close();
            this.#pages.delete(this.#currentPageId);
        }

        const remainingPages = this.getAllPageIds();
        this.#currentPageId = remainingPages.length > 0 ? remainingPages[0] : null;
    }

    async closePageById(pageId) {
        if (this.#pages.has(pageId)) {
            const page = this.#pages.get(pageId);
            await page.close();
            this.#pages.delete(pageId);
            
            // If we closed the current page, switch to another one
            if (this.#currentPageId === pageId) {
                const remainingPages = this.getAllPageIds();
                this.#currentPageId = remainingPages.length > 0 ? remainingPages[0] : null;
            }
        }
    }



    async closeAllPages() {
        for (const [pageId, page] of this.#pages) {
            await page.close();
        }
        this.#pages.clear();
        this.#currentPageId = null;
    }
}

module.exports = WebBrowser;