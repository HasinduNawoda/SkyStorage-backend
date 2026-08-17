require('dotenv/config');
const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.OCI_REGION,
  endpoint: `https://${process.env.OCI_NAMESPACE}.compat.objectstorage.${process.env.OCI_REGION}.oraclecloud.com`,
  credentials: {
    accessKeyId: process.env.OCI_ACCESS_KEY,
    secretAccessKey: process.env.OCI_SECRET_KEY,
  },
  forcePathStyle: true,
});

async function main() {
  await s3.send(new PutBucketCorsCommand({
    Bucket: process.env.OCI_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ['http://localhost:5173'],
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }));
  console.log('CORS rule applied successfully.');
}

main().catch((err) => {
  console.error('Failed to set CORS:', err);
  process.exit(1);
});