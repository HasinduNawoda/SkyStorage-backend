import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Oracle Cloud Object Storage speaks the S3 API ("S3-compatible"), so we
 * can use the standard AWS SDK — just pointed at Oracle's endpoint with
 * Oracle's Customer Secret Key credentials instead of real AWS ones.
 */
const s3 = new S3Client({
  region: process.env.OCI_REGION, // e.g. "us-ashburn-1" — required by the SDK but not meaningful to Oracle
  endpoint: `https://${process.env.OCI_NAMESPACE}.compat.objectstorage.${process.env.OCI_REGION}.oraclecloud.com`,
  credentials: {
    accessKeyId: process.env.OCI_ACCESS_KEY!,
    secretAccessKey: process.env.OCI_SECRET_KEY!,
  },
  forcePathStyle: true, // Oracle's S3-compatible endpoint requires path-style URLs, not virtual-hosted-style
});

const BUCKET = process.env.OCI_BUCKET!;

/** Builds the object's path inside the bucket — namespaced per user so
 *  there's no risk of one user's files colliding with another's. */
export function buildStorageKey(userId: string, fileId: string): string {
  return `users/${userId}/${fileId}`;
}

/** Short-lived URL the browser can PUT the file's bytes to directly —
 *  bytes never pass through our server. */
export async function getUploadUrl(storageKey: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes
}

/** Short-lived URL the browser can GET the file's bytes from directly. */
export async function getDownloadUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}

export async function deleteObject(storageKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}