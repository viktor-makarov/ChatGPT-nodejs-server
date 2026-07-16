/**
 * Юнит-тесты для common_functions.grocery_table_vector_search.
 *
 * Это НЕ сетевой тест — вызов googleApi.ai_search замокан.
 * grocery_table_vector_search — тонкая обёртка: она подставляет захардкоженные
 * параметры (project/dataset/table/field/return_fields/limit) и возвращает
 * результат googleApi.ai_search как есть. Поэтому подменяем ai_search на
 * модуле google_API и проверяем переданные аргументы и проброс результата.
 *
 * Запуск (Windows PowerShell):
 *   powershell -Command "$env:NODE_ENV='test'; node tests/intergarion_tests/functionsTest.js"
 */

const path = require('path');
const fs = require('fs');
const YAML = require('yaml');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Готовим окружение до подключения модулей (как в других интеграционных тестах).
if (!global.appsettings) {
  const yamlFileContent = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'main_config.yml'), 'utf8');
  global.appsettings = YAML.parse(yamlFileContent);
}

// Заглушка mongo, чтобы не падали зависимости при require common_functions.js.
if (!global.mongoConnection) {
  global.mongoConnection = { model: () => ({}) };
}

// Тот же singleton-инстанс модуля, что использует common_functions.js внутри.
const googleApi = require('../../components/apis/google_API.js');
const func = require('../../components/common_functions.js');

// Ожидаемые захардкоженные параметры вызова ai_search.
const EXPECTED = {
  project_id: process.env.BIGQUERY_PROJECT_ID,
  dataset_name: process.env.BIGQUERY_DATASET,
  table_name: process.env.BIGQUERY_TABLE,
  search_field: 'item_desc',
  return_fields: ['item_desc,product_name,product_category'],
  limit: 5,
};

// --- Простая тестовая обвязка ---------------------------------------------
const results = [];

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    const dur = Date.now() - started;
    results.push({ name, status: 'OK', dur });
    console.log(`✓ ${name} (${dur} ms)`);
  } catch (err) {
    const dur = Date.now() - started;
    results.push({ name, status: 'FAIL', dur, error: err });
    console.error(`✗ ${name} (${dur} ms) -> ${err.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  }
}

// Подменяет googleApi.ai_search. Возвращает функцию восстановления оригинала.
function stubAiSearch(impl) {
  const prev = googleApi.ai_search;
  googleApi.ai_search = impl;
  return () => { googleApi.ai_search = prev; };
}

function summarize() {
  console.log('\nИТОГ:');
  let ok = 0; let fail = 0;
  for (const r of results) {
    if (r.status === 'OK') { ok++; console.log(`  OK   - ${r.name}`); }
    else { fail++; console.log(`  FAIL - ${r.name} => ${r.error.message}`); }
  }
  console.log(`\nВсего: ${results.length}; Успешно: ${ok}; Провалено: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Тесты -----------------------------------------------------------------
async function run() {
  console.log('Запуск юнит-тестов grocery_table_vector_search...');

  await test('возвращает результат ai_search как есть (pass-through)', async () => {
    const expected = [{ item_desc: 'Milk 1L', product_name: 'Молоко', product_category: 'Dairy' }];
    const restore = stubAiSearch(async () => expected);
    try {
      const res = await func.grocery_table_vector_search('Milk 1L');
      assertDeepEqual(res, expected, 'результат должен быть тем, что вернул ai_search');
    } finally { restore(); }
  });

  await test('вызывает ai_search ровно один раз', async () => {
    const calls = [];
    const restore = stubAiSearch(async (...args) => { calls.push(args); return []; });
    try {
      await func.grocery_table_vector_search('Bread');
      assertEqual(calls.length, 1, 'количество вызовов ai_search');
    } finally { restore(); }
  });

  await test('передаёт query_text первым аргументом', async () => {
    let received;
    const restore = stubAiSearch(async (query_text) => { received = query_text; return []; });
    try {
      const input = 'Cheese Russian';
      await func.grocery_table_vector_search(input);
      assertEqual(received, input, 'первый аргумент ai_search (query_text)');
    } finally { restore(); }
  });

  await test('передаёт корректные захардкоженные параметры BigQuery', async () => {
    let args;
    const restore = stubAiSearch(async (...received) => { args = received; return []; });
    try {
      await func.grocery_table_vector_search('Granny Smith Apples');
      const [, project_id, dataset_name, table_name, search_field, return_fields, limit] = args;
      assertEqual(project_id, EXPECTED.project_id, 'project_id');
      assertEqual(dataset_name, EXPECTED.dataset_name, 'dataset_name');
      assertEqual(table_name, EXPECTED.table_name, 'table_name');
      assertEqual(search_field, EXPECTED.search_field, 'search_field');
      assertDeepEqual(return_fields, EXPECTED.return_fields, 'return_fields');
      assertEqual(limit, EXPECTED.limit, 'limit');
    } finally { restore(); }
  });

  await test('пробрасывает ошибку, если ai_search отклоняется', async () => {
    const restore = stubAiSearch(async () => { throw new Error('сбой ai_search'); });
    try {
      let thrown = null;
      try { await func.grocery_table_vector_search('Coffee'); } catch (e) { thrown = e; }
      assert(thrown, 'ожидалось, что функция пробросит ошибку');
      assertEqual(thrown.message, 'сбой ai_search', 'сообщение проброшенной ошибки');
    } finally { restore(); }
  });

  summarize();
}

if (require.main === module) {
  run();
}

module.exports = { run };
