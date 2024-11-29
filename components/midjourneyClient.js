const { Midjourney } = require('midjourney')

  const MdjClient = new Midjourney({
    ServerId: process.env.DISCORD_SERVER_ID,
    ChannelId: process.env.DISCORD_CHANNEL_ID,
    SalaiToken: process.env.DISCORD_SALAI_TOKEN,
    Debug: false,
    Ws:true,
  });

module.exports = {
  MdjClient
}