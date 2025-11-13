
const axios = require("axios");
const FormData = require("form-data");


const DEFAULT_ELEVENLABS_API_URL = process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io";

async function getAvailableModels(){
  const options = {
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_API_TOKEN,
    }
    }

  const result = await axios.get(`${DEFAULT_ELEVENLABS_API_URL}/v1/models`, options)
  return result.data
};

async function getAvailableVoices(){

const options = {
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_API_TOKEN,
    },
    params: {
      page_size: 100
    }
    }
    const result = await axios.get(`${DEFAULT_ELEVENLABS_API_URL}/v2/voices`, options)
    return result.data.voices;
}

async function speechToText(audioReadStream){

    const formData = new FormData();
    formData.append("file", audioReadStream);
    formData.append("model_id", appsettings.voice_to_text.eleven_labs_model_id);
    formData.append("diarize", "true");
    
    const headers = {
      "xi-api-key": process.env.ELEVENLABS_API_TOKEN,
      ...formData.getHeaders(),
    };

  const result =await axios.post(
          `${DEFAULT_ELEVENLABS_API_URL}/v1/speech-to-text`,
          formData,
          {
            headers,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          }
        )

      return result.data
}

async function textToVoiceStream(text,voiceName){
    
    const voice_id = global.elevenlabs_voices[voiceName]?.voice_id || global.elevenlabs_voices[appsettings.text_to_speach.default_voice_name].voice_id
    const options = {
        url: `${DEFAULT_ELEVENLABS_API_URL}/v1/text-to-speech/${voice_id}/stream`,
        method: "POST",
        headers: {
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_TOKEN,
        },
        responseType: "stream",
        params: {
        output_format: appsettings.text_to_speach.outputFormat
        },
        data: {
            text: text,
            model_id: appsettings.text_to_speach.model_id
        }
    }
    const response = await axios(options);
    const readableStream = response.data;

    return readableStream
}

module.exports = {
getAvailableModels,
getAvailableVoices,
textToVoiceStream,
speechToText
}