/**
 * Реальные интеграционные тесты для Google BigQuery AI.SEARCH.
 * ВНИМАНИЕ: выполняет настоящие запросы к BigQuery (тарифицируются).
 * Требуются переменные окружения сервисного аккаунта Google (см. .env):
 *   GOOGLE_AUTH_PROJECT_ID, GOOGLE_AUTH_PRIVATE_KEY_ID, GOOGLE_AUTH_PRIVATE_KEY,
 *   GOOGLE_AUTH_CLIENT_EMAIL, GOOGLE_AUTH_CLIENT_ID, GOOGLE_AUTH_CERT_URL
 *
 * Параметры теста задаются через переменные окружения (со значениями по умолчанию):
 *   BQ_PROJECT_ID   (по умолчанию: outline-1igg3i2i0bh)
 *   BQ_DATASET      (по умолчанию: Shoping)
 *   BQ_TABLE        (по умолчанию: purchases_from_csv_vector)
 *   BQ_SEARCH_FIELD (по умолчанию: item_desc)
 *   BQ_RETURN_FIELDS(по умолчанию: item_desc,product_name — через запятую)
 *   BQ_QUERY_TEXT   (по умолчанию: cottage cheese)
 *   BQ_LIMIT        (по умолчанию: 5)
 *
 * Запуск (Windows PowerShell):
 *   powershell -Command "$env:NODE_ENV='test'; node tests/intergarion_tests/googleAPIIntegration.tests.js"
 */

const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Загружаем .env (ключи сервисного аккаунта Google лежат там)
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch (e) {
  console.warn('Не удалось загрузить dotenv:', e.message);
}

const { ai_search } = require('../../components/apis/google_API.js');

// Параметры теста
const PROJECT_ID    = process.env.BIGQUERY_PROJECT_ID;
const DATASET       = process.env.BIGQUERY_DATASET;
const TABLE         = process.env.BIGQUERY_TABLE;
const SEARCH_FIELD  = process.env.BIGQUERY_SEARCH_FIELD;
const RETURN_FIELDS = (process.env.BIGQUERY_RETURN_FIELDS || 'item_desc,product_name')
  .split(',').map(s => s.trim()).filter(Boolean);
const QUERY_TEXT    = process.env.BQ_QUERY_TEXT    || 'cottage cheese';
const LIMIT         = parseInt(process.env.BQ_LIMIT || '5', 10);

// Простая тестовая обвязка + таймаут
const results = [];
const TEST_TIMEOUT_MS = parseInt(process.env.BQ_TEST_TIMEOUT_MS || '60000', 10);

async function runWithTimeout(fn) {
  return Promise.race([
    fn(),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Тест превысил таймаут ${TEST_TIMEOUT_MS} ms`)), TEST_TIMEOUT_MS))
  ]);
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await runWithTimeout(fn);
    const dur = Date.now() - started;
    results.push({ name, status: 'OK', dur });
    console.log(`✓ ${name} (${dur} ms)`);
  } catch (err) {
    const dur = Date.now() - started;
    results.push({ name, status: 'FAIL', dur, error: err });
    console.error(`✗ ${name} (${dur} ms) -> ${err.message}`);
  }
}

function summarize() {
  console.log('\nИТОГ:');
  let ok = 0, fail = 0;
  for (const r of results) {
    if (r.status === 'OK') { ok++; console.log(`  OK   - ${r.name}`); }
    else { fail++; console.log(`  FAIL - ${r.name} => ${r.error.message}`); }
  }
  console.log(`\nВсего: ${results.length}; Успешно: ${ok}; Провалено: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function run() {
  console.log('Запуск интеграционных тестов Google BigQuery AI.SEARCH...');
  console.log(`Таблица: ${PROJECT_ID}.${DATASET}.${TABLE}; поле поиска: ${SEARCH_FIELD}`);
  console.log(`Возвращаемые поля: ${RETURN_FIELDS.join(', ')}; запрос: "${QUERY_TEXT}"; limit: ${LIMIT}`);

  await test('ai_search: возвращает массив результатов с полем distance', async () => {
    const rows = await ai_search(QUERY_TEXT, PROJECT_ID, DATASET, TABLE, SEARCH_FIELD, RETURN_FIELDS, LIMIT);
    console.log('   Получено строк:', Array.isArray(rows) ? rows.length : '(не массив)');
    console.log('   Пример:', JSON.stringify(rows && rows[0], null, 2));

    assert(Array.isArray(rows), 'Результат не является массивом');
    assert(rows.length <= LIMIT, `Строк больше, чем limit (${rows.length} > ${LIMIT})`);

    if (rows.length > 0) {
      const first = rows[0];
      assert('distance' in first, 'В результате отсутствует поле distance');
      for (const f of RETURN_FIELDS) {
        assert(f in first, `В результате отсутствует запрошенное поле '${f}'`);
      }
    } else {
      console.warn('   Предупреждение: результат пуст — проверьте наполнение таблицы/запрос.');
    }
  });

  summarize();
}

if (require.main === module) {
  run();
}

module.exports = { run };
