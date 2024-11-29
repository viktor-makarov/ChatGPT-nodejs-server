const { InvokeCommand, LambdaClient } = require("@aws-sdk/client-lambda");
const { S3Client, S3,ListObjectsV2Command,DeleteObjectsCommand} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

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
  
  async function deleteS3FilesByPefix(prefix){

    const bucketName = process.env.S3_BUCKET_NAME;
    const prefixKey = process.env.S3_STORAGE_INCOMINGFILES_FOLDER+"/"+prefix;
    const client = new S3Client({});

    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefixKey
  });
    const listedObjects = await client.send(listCommand);

    if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
      return 0;
    };

    const deleteParams = {
      Bucket: bucketName,
      Delete: { Objects: [] }
  };

    listedObjects.Contents.forEach(({ Key }) => {
      deleteParams.Delete.Objects.push({ Key });
  });

  const deleteCommand = new DeleteObjectsCommand(deleteParams);
  const deleteResponse = await client.send(deleteCommand);
  
  return deleteResponse
  }

  async function uploadFileToS3(downloadStream,filename){

    const key = process.env.S3_STORAGE_INCOMINGFILES_FOLDER+"/"+filename
    const bucketName = process.env.S3_BUCKET_NAME
    
    const parallelUploads3 = new Upload({
      client: new S3({}) || new S3Client({}),
      params: {
        Bucket: bucketName, // Use access point ARN as Bucket
        Key: key,
        Body: downloadStream.data,
        ACL: 'public-read' // Optional: To make file publicly readable
      },
  
      // optional tags
      tags: [
        /*...*/
      ],
  
      // additional optional fields show default values below:
  
      // (optional) concurrency configuration
      queueSize: 4,
  
      // (optional) size of each part, in bytes, at least 5MB
      partSize: 1024 * 1024 * 5,
  
      // (optional) when true, do not automatically call AbortMultipartUpload when
      // a multipart upload fails to complete. You should then manually handle
      // the leftover parts.
      leavePartsOnError: false,
    });
    const result = await parallelUploads3.done();
    return result
  }


  module.exports = {
    lambda_invoke,
    uploadFileToS3,
    deleteS3FilesByPefix
};

