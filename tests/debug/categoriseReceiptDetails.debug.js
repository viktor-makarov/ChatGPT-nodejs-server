/**
 * Отдельный запуск FunctionCall.categoriseReceiptDetails для отладки.
 *
 * Метод не использует this, поэтому вызываем его через прототип без создания
 * тяжёлого экземпляра FunctionCall (конструктор тянет бота/mongo/браузер).
 *
 * Что нужно окружению:
 *   - .env в корне репозитория (OPENAI_API_KEY, OAI_URL, Google-креды для BigQuery)
 *   - config/main_config.yml (парсится в global.appsettings)
 *
 * Запуск (PowerShell):
 *   node tests/debug/categoriseReceiptDetails.debug.js "Milk 3.2% 1L"
 *
 * Мокирование внешних вызовов (чтобы изолировать логику):
 *   $env:MOCK_VECTOR='1'   — заглушить grocery_table_vector_search (без BigQuery)
 *   $env:MOCK_OPENAI='1'   — заглушить openAI responseSync (без вызова OpenAI)
 *
 * Отладка с брейкпоинтами:
 *   - VS Code: F5 c конфигом "Debug categoriseReceiptDetails" (см. .vscode/launch.json)
 *   - или:  node --inspect-brk tests/debug/categoriseReceiptDetails.debug.js "Milk 1L"
 */

const path = require('path');
const fs = require('fs');
const YAML = require('yaml');

// 1) .env — как в bin/www_prod.js (нужен для OpenAI/Google).
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// 2) appsettings — как в остальных тестах/раннерах.
if (!global.appsettings) {
  const yamlFileContent = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'main_config.yml'), 'utf8');
  global.appsettings = YAML.parse(yamlFileContent);
}

// 3) Заглушка mongo, чтобы require не падал на зависимостях.
if (!global.mongoConnection) {
  global.mongoConnection = { model: () => ({}) };
}

const googleApi = require('../../components/apis/google_API.js');
const openAIApi = require('../../components/apis/openAI_API.js');
const FunctionCall = require('../../components/objects/FunctionCall.js');

// Опциональные заглушки внешних вызовов для изоляции логики.
if (process.env.MOCK_VECTOR === '1') {
  googleApi.ai_search = async () => ([
    { item_desc: 'MILK 3.2% 1L', product_name: 'Молоко питьевое', product_category: 'Молочные продукты' },
    { item_desc: 'MILK OAT 1L', product_name: 'Молоко овсяное', product_category: 'Растительные напитки' },
  ]);
  console.log('[mock] googleApi.ai_search замокан');
}

if (process.env.MOCK_OPENAI === '1') {
  openAIApi.responseSync = async () => ({
    output: { product_name: 'Молоко питьевое 3.2%', product_category: 'Молочные продукты' },
    usage: { input_tokens: 0, output_tokens: 0 },
  });
  console.log('[mock] openAIApi.responseSync замокан');
}

async function main() {
  const item_desc = process.argv[2] || 'Milk 3.2% 1L 1pc';
  console.log('=== categoriseReceiptDetails ===');
  console.log('item_desc:', item_desc);
  console.log('--------------------------------');

  // Метод не обращается к this — достаточно пустого контекста.
  const result = await FunctionCall.prototype.categoriseReceiptDetails.call({}, item_desc);

  console.log('--------------------------------');
  console.log('РЕЗУЛЬТАТ:', JSON.stringify(result, null, 2));
  return result;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ОШИБКА:', err);
    process.exit(1);
  });
