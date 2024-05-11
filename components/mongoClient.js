const mongoose = require('mongoose');
mongoose.set('strictQuery', true)

let connectionString_self_mongo = process.env.MONGODB_CONNECTION;
let db_name = appsettings.mongodb_names.db_prod
if (process.env.PROD_RUN == "true") {
  connectionString_self_mongo = process.env.MONGODB_CONNECTION; //via internal network of docker-compose
  db_name = appsettings.mongodb_names.db_prod
} else {
  connectionString_self_mongo = process.env.MONGODB_CONNECTION_DEV; ////test db for debuging
  db_name = appsettings.mongodb_names.db_dev
}

  const connectToMongo = async () => {

    const connectionString = connectionString_self_mongo + "/" + db_name + "?authSource=admin";
    const connection = await mongoose.connect(connectionString,
        global.appsettings.mongodb_connections.options
      );
    console.log("Connected to mongo",connectionString)
    return connection;
  };

module.exports = {
    connectToMongo
}