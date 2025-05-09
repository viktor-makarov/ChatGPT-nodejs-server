
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const axios = require("axios");


async function ocr_document(fileBuffer, mimeType,index=0){

    const location = process.env.GOOGLE_DOCUMENTAI_LOCATION
    const projectId = process.env.GOOGLE_DOCUMENTAI_PROJECT_ID
    const processorId = process.env.GOOGLE_DOCUMENTAI_PROCESSOR_ID

    const serviceAccountKeys = {
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


module.exports = {
ocr_document
}