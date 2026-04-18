import {
  createS3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@/utils/s3";
import {
  encryptConnectionCredentials,
  listUserStorageConnections,
  normalizeFolderPath,
  toPublicStorageConnection,
} from "@/utils/storage";
import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const providerSchema = z.enum(["s3", "r2", "wasabi"]);

const createConnectionSchema = z.object({
  name: z.string().trim().min(1, "Connection name is required").max(80),
  provider: providerSchema,
  bucketName: z.string().trim().min(1, "Bucket name is required").max(255),
  region: z.string().trim().optional(),
  endpoint: z.string().trim().optional(),
  rootPrefix: z.string().optional(),
  accessKeyId: z.string().trim().min(1, "Access key is required"),
  secretAccessKey: z.string().trim().min(1, "Secret key is required"),
});

function resolveProviderSettings(input: {
  provider: "s3" | "r2" | "wasabi";
  region?: string;
  endpoint?: string;
}) {
  if (input.provider === "r2") {
    return {
      region: input.region?.trim() || "auto",
      endpoint: input.endpoint?.trim() || null,
    };
  }

  if (input.provider === "wasabi") {
    const region = input.region?.trim();

    if (!region) {
      throw new Error("Wasabi requires a region");
    }

    return {
      region,
      endpoint: input.endpoint?.trim() || `https://s3.${region}.wasabisys.com`,
    };
  }

  const region = input.region?.trim();

  if (!region) {
    throw new Error("S3 requires a region");
  }

  return {
    region,
    endpoint: input.endpoint?.trim() || null,
  };
}

function getErrorString(error: unknown, key: string) {
  if (!error || typeof error !== "object" || !(key in error)) {
    return "";
  }

  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function getErrorNumber(error: unknown, key: string) {
  if (!error || typeof error !== "object" || !(key in error)) {
    return null;
  }

  const value = (error as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function getErrorMetadata(error: unknown) {
  if (!error || typeof error !== "object" || !("$metadata" in error)) {
    return null;
  }

  const value = (error as Record<string, unknown>).$metadata;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getConnectionErrorDetails(error: unknown) {
  const metadata = getErrorMetadata(error);

  return {
    name: getErrorString(error, "name") || (error instanceof Error ? error.name : ""),
    message: getErrorString(error, "message") || (error instanceof Error ? error.message : ""),
    code: getErrorString(error, "code"),
    errno: getErrorNumber(error, "errno"),
    syscall: getErrorString(error, "syscall"),
    hostname: getErrorString(error, "hostname"),
    fault: getErrorString(error, "$fault"),
    httpStatusCode:
      metadata && typeof metadata.httpStatusCode === "number"
        ? metadata.httpStatusCode
        : null,
    requestId:
      metadata && typeof metadata.requestId === "string"
        ? metadata.requestId
        : null,
    extendedRequestId:
      metadata && typeof metadata.extendedRequestId === "string"
        ? metadata.extendedRequestId
        : null,
    attempts:
      metadata && typeof metadata.attempts === "number"
        ? metadata.attempts
        : null,
    totalRetryDelay:
      metadata && typeof metadata.totalRetryDelay === "number"
        ? metadata.totalRetryDelay
        : null,
  };
}

function formatConnectionErrorMessage(input: {
  provider: "s3" | "r2" | "wasabi";
  region: string | null;
  endpoint: string | null;
  error: unknown;
}) {
  const details = getConnectionErrorDetails(input.error);
  const normalizedMessage = `${details.name} ${details.code} ${details.message}`.toLowerCase();

  if (
    normalizedMessage.includes("getaddrinfo enotfound") ||
    normalizedMessage.includes("enotfound") ||
    details.name === "UnknownEndpoint"
  ) {
    if (input.provider === "wasabi") {
      return input.endpoint
        ? "We could not reach that Wasabi endpoint. Double-check the region or enter the exact endpoint from Wasabi."
        : "We could not reach the Wasabi endpoint for that region. Double-check the region or enter the exact Wasabi endpoint manually.";
    }

    if (input.provider === "r2") {
      return "We could not reach that Cloudflare R2 endpoint. Check the endpoint URL and try again.";
    }

    return "We could not reach that bucket endpoint. Check the region or endpoint and try again.";
  }

  if (
    details.httpStatusCode === 401 ||
    details.httpStatusCode === 403 ||
    details.name === "InvalidAccessKeyId" ||
    details.name === "SignatureDoesNotMatch" ||
    details.name === "AccessDenied" ||
    normalizedMessage.includes("access denied") ||
    normalizedMessage.includes("signature") ||
    normalizedMessage.includes("invalidaccesskeyid")
  ) {
    return "Those bucket credentials were rejected. Check the access key, secret key, bucket permissions, and region.";
  }

  if (
    details.name === "NoSuchBucket" ||
    (normalizedMessage.includes("bucket") && normalizedMessage.includes("not exist"))
  ) {
    return "That bucket could not be found. Check the bucket name, region, and endpoint.";
  }

  if (details.name === "PermanentRedirect" || normalizedMessage.includes("redirect")) {
    return "That bucket appears to be in a different region or endpoint. Double-check the region and endpoint settings.";
  }

  return details.message || "Failed to create connection";
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const connections = await listUserStorageConnections(session.user.id);

    return Response.json({
      ok: true,
      connections: connections.map(toPublicStorageConnection),
    });
  } catch (error) {
    console.error("connections GET route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load connections" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let provider: "s3" | "r2" | "wasabi" | null = null;
  let region: string | null = null;
  let endpoint: string | null = null;
  let bucketName: string | null = null;

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = createConnectionSchema.parse(await request.json());
    provider = body.provider;
    bucketName = body.bucketName.trim();

    const providerSettings = resolveProviderSettings(body);
    region = providerSettings.region;
    endpoint = providerSettings.endpoint;
    const rootPrefix = normalizeFolderPath(body.rootPrefix);

    if (body.provider === "r2" && !providerSettings.endpoint) {
      return Response.json(
        { error: "Cloudflare R2 requires an endpoint" },
        { status: 400 },
      );
    }

    const existingConnection = await prisma.storageConnection.findFirst({
      where: {
        ownerId: session.user.id,
        type: "external",
        provider: body.provider,
        bucketName,
        endpoint: providerSettings.endpoint,
        rootPrefix,
      },
    });

    if (existingConnection && !existingConnection.credentialsClientEncrypted) {
      return Response.json(
        { error: "That bucket connection already exists" },
        { status: 409 },
      );
    }

    const client = createS3Client({
      provider: body.provider,
      region: providerSettings.region,
      endpoint: providerSettings.endpoint,
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
    });

    await client.send(
      new HeadBucketCommand({
        Bucket: bucketName,
      }),
    );

    await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: rootPrefix ? `${rootPrefix}/` : undefined,
        MaxKeys: 1,
      }),
    );

    const encryptedCredentials = encryptConnectionCredentials({
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
    });

    const connection = existingConnection
      ? await prisma.storageConnection.update({
          where: { id: existingConnection.id },
          data: {
            name: body.name.trim(),
            provider: body.provider,
            bucketName,
            region: providerSettings.region,
            endpoint: providerSettings.endpoint,
            rootPrefix,
            accessKeyEnc: encryptedCredentials.accessKeyEnc,
            secretKeyEnc: encryptedCredentials.secretKeyEnc,
            credentialsClientEncrypted: false,
          },
        })
      : await prisma.storageConnection.create({
          data: {
            ownerId: session.user.id,
            name: body.name.trim(),
            type: "external",
            provider: body.provider,
            bucketName,
            region: providerSettings.region,
            endpoint: providerSettings.endpoint,
            rootPrefix,
            accessKeyEnc: encryptedCredentials.accessKeyEnc,
            secretKeyEnc: encryptedCredentials.secretKeyEnc,
            credentialsClientEncrypted: false,
            isDefault: false,
          },
        });

    return Response.json({
      ok: true,
      connection: toPublicStorageConnection(connection),
    });
  } catch (error) {
    console.error("connections POST route error", {
      provider,
      region,
      endpoint,
      bucketName,
      error: getConnectionErrorDetails(error),
    });

    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message || "Invalid bucket connection input" },
        { status: 400 },
      );
    }

    return Response.json(
      {
        error:
          provider && (provider === "s3" || provider === "r2" || provider === "wasabi")
            ? formatConnectionErrorMessage({ provider, region, endpoint, error })
            : error instanceof Error
              ? error.message
              : "Failed to create connection",
        debug: getConnectionErrorDetails(error),
      },
      { status: 500 },
    );
  }
}
