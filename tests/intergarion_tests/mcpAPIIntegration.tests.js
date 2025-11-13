/**
 * Реальные интеграционные тесты для Deepwiki MCP.
 * ВНИМАНИЕ: выполняет настоящие HTTP-запросы к сервису https://mcp.deepwiki.com/mcp.
 * Запуск (Windows PowerShell):
 *   powershell -Command "$env:NODE_ENV='test'; node tests/intergarion_tests/mcpAPIRealIntegration.tests.js"
 * Или через npm:
 *   npm run test:mcp:real
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Загружаем appsettings если не загружены
if (!global.appsettings) {
  const yamlFileContent = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'main_config.yml'), 'utf8');
  global.appsettings = yaml.load(yamlFileContent);
}

// Заглушка для mongo, чтобы не падали зависимости ErrorHandler -> mongo.js
if (!global.mongoConnection) {
  global.mongoConnection = { model: () => ({}) };
}

// Подключаем модуль после подготовки окружения
const mcpModule = require('../../components/apis/mcp_tools_API.js');
const internal = mcpModule._test;
if(!internal){
  console.error('Не удалось получить внутренние функции initDeepwiki/getToolsDeepwiki.');
  process.exit(1);
}
const { initDeepwiki, getToolsDeepwiki } = internal;

// Простая тестовая обвязка + механизм повторов
const results = [];
const TEST_TIMEOUT_MS = parseInt(process.env.DEEPWIKI_TEST_TIMEOUT_MS || '45000',10); // увеличен таймаут
const TEST_RETRIES = parseInt(process.env.DEEPWIKI_TEST_RETRIES || '3',10); // больше попыток

async function runWithTimeout(fn){
  return Promise.race([
    fn(),
    new Promise((_,rej)=> setTimeout(() => rej(new Error(`Тест превысил таймаут ${TEST_TIMEOUT_MS} ms`)), TEST_TIMEOUT_MS))
  ]);
}

async function test(name, fn){
  const started = Date.now();
  let lastErr;
  for(let attempt=1; attempt<=TEST_RETRIES; attempt++){
    try {
      if(attempt>1) console.log(` -> Повторная попытка ${attempt}/${TEST_RETRIES} для '${name}'`);
      await runWithTimeout(fn);
      const dur = Date.now()-started;
      results.push({name,status:'OK',dur,attempts:attempt});
      console.log(`✓ ${name} (${dur} ms, попыток: ${attempt})`);
      return;
    } catch(err){
      lastErr = err;
      if(attempt === TEST_RETRIES){
        const dur = Date.now()-started;
        results.push({name,status:'FAIL',dur,error:lastErr,attempts:attempt});
        console.error(`✗ ${name} (${dur} ms, попыток: ${attempt}) -> ${lastErr.message}`);
      } else {
        // Небольшая пауза перед повтором
        await new Promise(r=> setTimeout(r, 500));
      }
    }
  }
}

function summarize(){
  console.log('\nИТОГ:');
  let ok = 0; let fail = 0;
  for(const r of results){
    if(r.status==='OK') { ok++; console.log(`  OK   - ${r.name} (попыток: ${r.attempts})`);} else { fail++; console.log(`  FAIL - ${r.name} (попыток: ${r.attempts}) => ${r.error.message}`);} }
  console.log(`\nВсего: ${results.length}; Успешно: ${ok}; Провалено: ${fail}`);
  if(fail>0){
    console.log('Завершено с ошибками.');
    process.exit(1);
  } else {
    console.log('Все тесты успешны.');
    process.exit(0);
  }
}

function assert(cond,msg){ if(!cond) throw new Error(msg); }

let sessionId;

async function run(){
  console.log('Запуск интеграционных тестов Deepwiki MCP...');
  console.log('Endpoint:', global.appsettings.mcp_options.deepwiki_endpoint);

  await test('initDeepwiki: запрос возвращает mcp_session_id', async () => {
    console.log(' -> Выполняем initialize');
    const startFetch = Date.now();
    const res = await initDeepwiki().catch(async (err) => {
      console.error('   Ошибка initDeepwiki:', err.message);
      // Дополнительная диагностика: простой fetch без SSE парсинга
      try {
        console.log('   Диагностика: пробуем сырой fetch...');
        const r = await fetch(global.appsettings.mcp_options.deepwiki_endpoint, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',clientInfo:{name:'diag-client',version:'1.0.0'},capabilities:{}}})});
        console.log('   Raw status:', r.status);
        console.log('   Raw headers mcp-session-id:', r.headers.get('mcp-session-id'));
        console.log('   Raw content-type:', r.headers.get('content-type'));
      } catch(diagErr){
        console.error('   Диагностический fetch тоже не удался:', diagErr.message);
      }
      throw err;
    });
    console.log('   Время initialize (ms):', Date.now()-startFetch);
    sessionId = res.mcp_session_id;
    assert(typeof sessionId === 'string' && sessionId.length>0, 'mcp_session_id пустой');
    assert(res.result, 'Отсутствует result');
    console.log('   Получен mcp_session_id:', sessionId);
  });

  await test('getToolsDeepwiki: инструменты имеют корректный формат', async () => {
    assert(sessionId, 'Нет sessionId из предыдущего теста');
    console.log(' -> Запрашиваем список tools');
    const tools = await getToolsDeepwiki(sessionId);
    assert(Array.isArray(tools), 'tools не массив');
    assert(tools.length>0, 'Список tools пуст');
    // Проверяем несколько первых инструментов
    const sample = tools.slice(0, Math.min(5, tools.length));
    console.log(`   Всего tools: ${tools.length}. Примеры: ${sample.map(t=>t.name).join(', ')}`);
    for(const t of sample){
      assert(typeof t.name === 'string' && t.name.length>0, 'tool.name отсутствует или пуст');
      if(t.description !== undefined){
        assert(typeof t.description === 'string', 'tool.description не строка');
      }
      if(t.inputSchema !== undefined){
        assert(typeof t.inputSchema === 'object', 'tool.inputSchema не объект');
      }
    }
  });

  summarize();
}

if(require.main === module){
  run();
}

module.exports = { run };
