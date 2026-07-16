
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { BigQuery } = require('@google-cloud/bigquery');
const { GoogleAuth } = require('google-auth-library');


// Собирает ключи сервисного аккаунта Google из переменных окружения
function getServiceAccountKeys(){
    return {
        type: "service_account",
        project_id: process.env.GOOGLE_AUTH_PROJECT_ID,
        private_key_id: process.env.GOOGLE_AUTH_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_AUTH_PRIVATE_KEY.split(String.raw`\n`).join('\n'),
        client_email: process.env.GOOGLE_AUTH_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_AUTH_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://accounts.google.com/o/oauth2/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.GOOGLE_AUTH_CERT_URL,
        universe_domain: "googleapis.com"
      };
}

async function ocr_document(fileBuffer, mimeType,index=0){

    const location = process.env.GOOGLE_DOCUMENTAI_LOCATION
    const projectId = process.env.GOOGLE_DOCUMENTAI_PROJECT_ID
    const processorId = process.env.GOOGLE_DOCUMENTAI_PROCESSOR_ID

    const serviceAccountKeys = getServiceAccountKeys();
    
    const client = new DocumentProcessorServiceClient({
        credentials: serviceAccountKeys,
        apiEndpoint: `${location}-documentai.googleapis.com`
    });

    const request = {
        name: `projects/${projectId}/locations/${location}/processors/${processorId}`,
        imagelessMode:false,
        processOptions: {
          ocrConfig: {
            enableNativePdfParsing:true,
            enableImageQualityScores:true
          }
        },
        rawDocument: {
          content: fileBuffer.toString('base64'),
          mimeType: mimeType
      }
    };
  const [result] = await client.processDocument(request);
  const {document} = result;
  const {text} = document;
  const endTime = performance.now();
    
  return {text,index};
}


// AI-поиск (векторный семантический поиск) по таблице BigQuery через AI.SEARCH.
// return_fields — список полей таблицы, которые нужно вернуть (помимо distance).
async function ai_search(query_text, project_id, dataset_name, table_name, search_field, return_fields = [], limit = 5){

    const bigquery = new BigQuery({
        projectId: process.env.GOOGLE_DOCUMENTAI_PROJECT_ID,
        credentials: getServiceAccountKeys()
    });

    // Имена проекта/датасета/таблицы/поля нельзя передать параметрами запроса,
    // поэтому подставляем их в текст запроса. Идентификаторы GCP не содержат
    // обратных кавычек — убираем их на всякий случай, чтобы избежать инъекции.
    const strip = (v) => String(v).replace(/`/g, '');
    const tableRef = `\`${strip(project_id)}.${strip(dataset_name)}.${strip(table_name)}\``;
    const fieldLiteral = `'${strip(search_field).replace(/'/g, "\\'")}'`;

    // Формируем список выбираемых полей: base.<field>, ..., distance
    const selectedFields = (Array.isArray(return_fields) ? return_fields : return_fields)
        .filter(Boolean)
        .map((f) => strip(f).split(',').map(s => `base.${s.trim()}`).join(', '));
    const selectClause = [...selectedFields, 'distance'].join(', ');
    
    const query = `
        SELECT ${selectClause}
        FROM AI.SEARCH(
          TABLE ${tableRef},
          ${fieldLiteral},
          @query_text
        )
        ORDER BY distance
        LIMIT @limit`;
    const options = {
        query,
        params: { query_text, limit },
    };

    const [rows] = await bigquery.query(options);
    return rows;
}


async function big_query(query_text){

    const bigquery = new BigQuery({
        projectId: process.env.GOOGLE_DOCUMENTAI_PROJECT_ID,
        credentials: getServiceAccountKeys()
    });

    const options = {
        query:query_text
    };

    const [rows] = await bigquery.query(options);
    return rows;
}

// --- BigQuery MCP: OAuth access-токен сервисного аккаунта ---
// Токен живёт ~1 час. Держим его в памяти и обновляем заранее по расписанию,
// чтобы сборка списка инструментов не ходила в сеть.
let bqAuthClient;
let bqTokenCache = { token: null, expiresAt: 0 };

async function refreshBigQueryAccessToken() {
    try {
        if (!bqAuthClient) {
            const auth = new GoogleAuth({
                credentials: getServiceAccountKeys(),
                scopes: 'https://www.googleapis.com/auth/bigquery',
            });
            bqAuthClient = await auth.getClient();
        }
        const { token } = await bqAuthClient.getAccessToken();
        const expiryDate = bqAuthClient.credentials?.expiry_date;
        bqTokenCache = {
            token: token || null,
            expiresAt: expiryDate || (Date.now() + 55 * 60 * 1000),
        };
        console.log(new Date(), 'BigQuery MCP: токен обновлён');
        return bqTokenCache.token;
    } catch (e) {
        console.error('BigQuery MCP: не удалось обновить токен', e?.message);
        return null;
    }
}

// Синхронно отдаёт закешированный токен (без обращения к сети).
function getCachedBigQueryToken() {
    return bqTokenCache.token;
}

module.exports = {
ocr_document,
ai_search,
big_query,
refreshBigQueryAccessToken,
getCachedBigQueryToken
}