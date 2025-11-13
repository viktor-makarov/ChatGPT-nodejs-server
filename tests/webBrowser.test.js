const WebBrowser = require('../components/objects/WebBrowser');
const { launchBrowserHeadless } = require('../components/apis/chromeBrowser');
const fs = require('fs');
const path = require('path');

async function runWebBrowserTest() {
    console.log('Starting WebBrowser unit test...\n');
    
    let webBrowser;
    
    try {
        // Создаем инстанс WebBrowser
        const browserInstance = await launchBrowserHeadless();
        webBrowser = new WebBrowser({
            browserInstance,
            delayMs: 3000,
            timeout: 45000
        });
        console.log('WebBrowser instance created successfully.\n');
        
        // Создаем первую страницу
        const page1Id = await webBrowser.createPage('aviasales');
        console.log(`First page created with ID: ${page1Id}\n`);
        
        // Устанавливаем viewport для первой страницы
        await webBrowser.setViewport({ width: 1024, height: 768 });
        console.log('Viewport set for first page.\n');
        
        await webBrowser.navigateToUrl('https://www.booking.com/');
        console.log('Successfully navigated to ilibrary.ru\n');
        await webBrowser.delay(5000);

        // Выводим информацию о всех страницах
        console.log('All pages info:');
        console.log(JSON.stringify(webBrowser.getAllPagesInfo(), null, 2));
        console.log('');

        // Создаем скриншот первой страницы (aviasales)
        console.log('Taking screenshot of before scroll...');
        const screenshot1 = await webBrowser.takeCurrentPageScreenshot({ 
            type: 'png'
        });

        const screenshot1Path = path.join(__dirname, '../tempfiles/before_scroll.png');
        fs.writeFileSync(screenshot1Path, screenshot1);
        console.log(`Screenshot saved to: ${screenshot1Path}\n`);

      

        const result = await webBrowser.searchInPage("offers");
        console.log(result);

        const screenshot2 = await webBrowser.takeCurrentPageScreenshot({ 
            type: 'png'
        });

        const screenshot2Path = path.join(__dirname, '../tempfiles/after_scroll.png');
        fs.writeFileSync(screenshot2Path, screenshot2);
        console.log(`Screenshot saved to: ${screenshot2Path}\n`);

         // Выводим информацию о всех страницах
        console.log('All pages info:');
        console.log(JSON.stringify(webBrowser.getAllPagesInfo(), null, 2));
        console.log('');
        
        console.log('WebBrowser unit test completed successfully!');
    
    } catch (error) {
        console.error('Error during WebBrowser test:', error);
        throw error;
    } finally {
        // Закрываем все страницы
        if (webBrowser) {
            console.log('\nCleaning up - closing all pages...');
            try {
                await webBrowser.closeAllPages();
                console.log('All pages closed successfully.');
            } catch (cleanupError) {
                console.error('Error during cleanup:', cleanupError);
            }
        }
    }
}

// Запускаем тест только если файл выполняется напрямую
if (require.main === module) {
    runWebBrowserTest()
        .then(() => {
            console.log('\nTest execution finished.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\nTest failed:', error);
            process.exit(1);
        });
}

module.exports = { runWebBrowserTest };
