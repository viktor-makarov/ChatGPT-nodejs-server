const mongoose = require('mongoose');
const { error } = require('pdf-lib');
mongoose.set('strictQuery', true)

let connectionString_self_mongo = process.env.MONGODB_CONNECTION;
let db_name = appsettings.mongodb_names.db_prod
if (process.env.DEPLOYMENT == "prod") {
  connectionString_self_mongo = process.env.MONGODB_CONNECTION; //via internal network of docker-compose
  db_name = appsettings.mongodb_names.db_prod
} else if (process.env.DEPLOYMENT == "dev") {
  connectionString_self_mongo = process.env.MONGODB_CONNECTION_DEV; ////test db for debuging
  db_name = appsettings.mongodb_names.db_dev
} else if (process.env.DEPLOYMENT == "test") {
  connectionString_self_mongo = process.env.MONGODB_CONNECTION_TEST; ////test db for debuging
  db_name = appsettings.mongodb_names.db_test
} else {
  throw new Error("Unknown DEPLOYMENT value. Set env variable DEPLOYMENT to 'prod', 'dev' or 'test'");
}

  const connectToMongo = async () => {

    const connectionString = connectionString_self_mongo + "/" + db_name + "?authSource=admin";
    const connection = await mongoose.connect(connectionString,
        global.appsettings.mongodb_connections.options
      );
    console.log(new Date,"Connected to mongo",connectionString)

    return mongoose.connection;
  };
  

module.exports = {
    connectToMongo
}