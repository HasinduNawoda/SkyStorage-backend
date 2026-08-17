import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { buildStorageKey, getUploadUrl, getDownloadUrl, deleteObject, uploadObject, downloadObject } from "../utils/storage";

export const filesRouter = Router();

filesRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().trim().min(1).max(255),
  folderId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  folderId: z.string().nullable().optional(),
  isFavorite: z.boolean().optional(),
  deletedAt: z.union([z.string(), z.null()]).optional(),
});

async function assertValidFolder(userId: string, folderId: string | null | undefined) {
  if (folderId === null || folderId === undefined) return;
  const folder = await db.folder.findFirst({ where: { id: folderId, ownerId: userId } });
  if (!folder) {
    throw Object.assign(new Error("Folder not found."), { status: 400 });
  }
}

filesRouter.get("/", async (req: Request, res: Response) => {
  try {
    if (req.query.all === "true") {
      const files = await db.file.findMany({
        where: { ownerId: req.userId! },
        orderBy: { createdAt: "desc" },
      });
      return res.json(files);
    }

    const folderId = req.query.folderId;
    const where =
      folderId === undefined || folderId === "null"
        ? { ownerId: req.userId!, folderId: null }
        : { ownerId: req.userId!, folderId: String(folderId) };

    const files = await db.file.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json(files);
  } catch (err) {
    console.error("list files error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Creates the metadata row AND returns a presigned URL to upload the actual
// bytes to. The row exists (with a reserved storageKey) even before the
// browser finishes the PUT — that's fine, it just means a file could
// theoretically have metadata but no bytes yet if the upload never
// completes, same tradeoff most cloud storage UIs make.
filesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const { name, sizeBytes, mimeType, folderId } = parsed.data;
    await assertValidFolder(req.userId!, folderId);

    const file = await db.file.create({
      data: { name, sizeBytes, mimeType, folderId: folderId ?? null, ownerId: req.userId! },
    });

    const storageKey = buildStorageKey(req.userId!, file.id);
    await db.file.update({ where: { id: file.id }, data: { storageKey } });

    const uploadUrl = await getUploadUrl(storageKey, mimeType);

    res.status(201).json({ ...file, storageKey, uploadUrl });
  } catch (err: any) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("create file error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Returns a fresh presigned download URL for an existing file. Short-lived
// on purpose (5 min) — only issued after confirming this user owns the file.
filesRouter.get("/:id/download-url", async (req: Request, res: Response) => {
  try {
    const file = await db.file.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!file) return res.status(404).json({ error: "File not found." });
    if (!file.storageKey) {
      return res.status(409).json({ error: "This file has no uploaded content yet." });
    }

    const url = await getDownloadUrl(file.storageKey);
    res.json({ url });
  } catch (err) {
    console.error("download url error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// Proxy routes — browser ↔ our server ↔ Oracle (no CORS needed)
// ---------------------------------------------------------------------------

// Upload proxy: the browser sends raw bytes here; we forward them to Oracle.
// Content-Type must be application/octet-stream so express.raw() parses the
// body into a Buffer.
filesRouter.post("/:id/upload", async (req: Request, res: Response) => {
  try {
    const file = await db.file.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!file) return res.status(404).json({ error: "File not found." });
    if (!file.storageKey) {
      return res.status(409).json({ error: "File has no storage key yet." });
    }

    const body = req.body as Buffer;
    if (!body || !body.length) {
      return res.status(400).json({ error: "Empty body — no bytes received." });
    }

    await uploadObject(file.storageKey, body, file.mimeType);

    // Sync the actual upload size back to the DB row
    await db.file.update({
      where: { id: file.id },
      data: { sizeBytes: body.length },
    });

    res.json({ ok: true, bytesReceived: body.length });
  } catch (err) {
    console.error("proxy upload error:", err);
    res.status(500).json({ error: "Upload failed. Please try again." });
  }
});

// Download proxy: fetch the object from Oracle and pipe it back to the browser.
filesRouter.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const file = await db.file.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!file) return res.status(404).json({ error: "File not found." });
    if (!file.storageKey) {
      return res.status(409).json({ error: "This file has no uploaded content yet." });
    }

    const obj = await downloadObject(file.storageKey);

    res.setHeader("Content-Type", obj.contentType || file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.name)}"`
    );
    if (obj.contentLength) res.setHeader("Content-Length", obj.contentLength);

    // The SDK returns a Readable stream (Node) — pipe it straight to the response.
    const stream = obj.body as NodeJS.ReadableStream;
    stream.pipe(res);
  } catch (err) {
    console.error("proxy download error:", err);
    res.status(500).json({ error: "Download failed. Please try again." });
  }
});

filesRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    }

    const existing = await db.file.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!existing) return res.status(404).json({ error: "File not found." });

    if (parsed.data.folderId !== undefined) {
      await assertValidFolder(req.userId!, parsed.data.folderId);
    }

    const file = await db.file.update({
      where: { id: req.params.id },
      data: {
        ...parsed.data,
        deletedAt:
          parsed.data.deletedAt === undefined
            ? undefined
            : parsed.data.deletedAt === null
            ? null
            : new Date(parsed.data.deletedAt),
      },
    });
    res.json(file);
  } catch (err: any) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("update file error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Hard delete — removes both the database row AND the object in storage,
// since leaving orphaned bytes in the bucket forever would be a silent
// storage leak (and, on a paid tier, a real cost leak).
filesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await db.file.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!existing) return res.status(404).json({ error: "File not found." });

    if (existing.storageKey) {
      try {
        await deleteObject(existing.storageKey);
      } catch (err) {
        console.error("storage delete error:", err);
      }
    }

    await db.file.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete file error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});