/**
 * Отдельный запуск common_functions.grocery_table_insert для отладки.
 *
 * grocery_table_insert(query_text) — тонкая обёртка: логирует SQL и выполняет
 * его через googleApi.big_query в BigQuery под сервисным аккаунтом из .env.
 * В Mongo/бот не ходит, поэтому достаточно лёгкого бутстрапа.
 *
 * Что нужно окружению:
 *   - .env в корне репозитория (Google-креды GOOGLE_AUTH_*, BIGQUERY_PROJECT_ID,
 *     GROCERY_DATASET, GROCERY_TABLE)
 *   - config/main_config.yml (парсится в global.appsettings — иначе mongo_Schemas упадёт)
 *
 * Запуск (PowerShell):
 *   node tests/debug/grocery_table_insert.debug.js
 *   node tests/debug/grocery_table_insert.debug.js "SELECT 1 AS test"   # свой SQL
 *
 * ВНИМАНИЕ: по умолчанию скрипт ВСТАВЛЯЕТ тестовую строку в таблицу. Удаляйте
 * её после проверки. Ссылки на таблицу в бэктиках собираются здесь, в JS, —
 * НЕ передавайте их аргументом (бэктик в PowerShell это escape-символ).
 */

const path = require('path');
const fs = require('fs');
const YAML = require('yaml');

// 1) .env — как в bin/www_prod.js.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// 2) appsettings — как в остальных тестах/раннерах.
if (!global.appsettings) {
  const yamlFileContent = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'main_config.yml'), 'utf8');
  global.appsettings = YAML.parse(yamlFileContent);
}

// 3) Заглушка mongo, чтобы require common_functions не падал на зависимостях.
if (!global.mongoConnection) {
  global.mongoConnection = { model: () => ({}) };
}

const func = require('../../components/common_functions.js');

// Собираем ссылку на таблицу из env (project.dataset.table).
const tableRef = `\`${process.env.BIGQUERY_PROJECT_ID}.${process.env.GROCERY_DATASET}.${process.env.GROCERY_TABLE}\``;

// Готовый тестовый INSERT. Отредактируйте колонки/значения под реальную схему таблицы.
const DEFAULT_SQL = `
INSERT INTO ${tableRef} 
(item_desc, product_name, product_category)
VALUES ('DEBUG TEST ITEM 1L', 'Отладочный товар', 'Тест')
`;

async function main() {
  const sql = process.argv[2] || DEFAULT_SQL;
  console.log('=== grocery_table_insert ===');
  console.log('Таблица:', tableRef);
  console.log('SQL:', sql.trim());
  console.log('----------------------------');

  const rows = await func.grocery_table_insert(sql);

  console.log('----------------------------');
  console.log('РЕЗУЛЬТАТ:');
  console.dir(rows, { depth: null });
  return rows;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ОШИБКА:', err);
    process.exit(1);
  });
