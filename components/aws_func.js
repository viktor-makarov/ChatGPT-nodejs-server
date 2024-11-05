const { InvokeCommand, LambdaClient } = require("@aws-sdk/client-lambda");


async function lambda_invoke(funcName, payload){

    const client = new LambdaClient({});
    const command = new InvokeCommand({
      FunctionName: funcName,
      Payload: JSON.stringify(payload),
      LogType: "Tail",
    });
  
    const { Payload, LogResult } = await client.send(command);
    const result = Buffer.from(Payload).toString();
    const logs = Buffer.from(LogResult, "base64").toString();
    return result;
  };
  /** snippet-end:[javascript.v3.lambda.actions.Invoke] */
  
  module.exports = {
    lambda_invoke
};