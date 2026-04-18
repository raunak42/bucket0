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
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = createConnectionSchema.parse(await request.json());
    const providerSettings = resolveProviderSettings(body);
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
        bucketName: body.bucketName.trim(),
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
        Bucket: body.bucketName.trim(),
      }),
    );

    await client.send(
      new ListObjectsV2Command({
        Bucket: body.bucketName.trim(),
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
            bucketName: body.bucketName.trim(),
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
            bucketName: body.bucketName.trim(),
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
    console.error("connections POST route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create connection" },
      { status: 500 },
    );
  }
}
