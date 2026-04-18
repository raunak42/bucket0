import "dotenv/config";
import { PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET_NAME;
const region = process.env.S3_REGION ?? process.env.AWS_REGION;
const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!bucket) {
  throw new Error("Missing S3_BUCKET_NAME");
}

if (!region) {
  throw new Error("Missing S3_REGION or AWS_REGION");
}

const allowedOrigins = (
  process.env.S3_CORS_ALLOWED_ORIGINS ??
  process.env.BETTER_AUTH_URL ??
  "http://localhost:3000"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const client = new S3Client({
  region,
  endpoint: endpoint || undefined,
  forcePathStyle: Boolean(endpoint),
  credentials:
    accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : undefined,
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: allowedOrigins,
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

console.log(`Applied S3 CORS to ${bucket}`);
console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
