const { Midjourney } = require('midjourney')


  const mdjClient  = new Midjourney({
    ServerId: process.env.DISCORD_SERVER_ID,
    ChannelId: process.env.DISCORD_CHANNEL_ID,
    SalaiToken: process.env.DISCORD_SALAI_TOKEN,
    HuggingFaceToken: process.env.HUGGINGFACE_TOKEN,
    BotId: '936929561302675456',
    ApiInterval: 700,
    SessionId:"b9f92e3e5c2c4169866d325fd5e1d2ad",
    Debug: false,
    Ws:false
  });

module.exports = {
  mdjClient
}