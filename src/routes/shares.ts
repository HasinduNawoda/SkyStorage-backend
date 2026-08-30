import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { downloadObject } from "../utils/storage";

export const sharesRouter = Router();

const createSchema = z
  .object({
    fileId: z.string().optional(),
    folderId: z.string().optional(),
    sharedWith: z.string().email().optional(),
    role: z.enum(["viewer", "editor"]).default("viewer"),
    message: z.string().optional(),
  })
  .refine((data) => data.fileId || data.folderId, {
    message: "Must provide either fileId or folderId",
  });

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------

// POST / — create a share (public link or private share)
sharesRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const { fileId, folderId, sharedWith, role, message } = parsed.data;

    // Verify the requesting user owns the target file or folder
    if (fileId) {
      const file = await db.file.findFirst({ where: { id: fileId, ownerId: req.userId! } });
      if (!file) return res.status(404).json({ error: "File not found." });
    }
    if (folderId) {
      const folder = await db.folder.findFirst({ where: { id: folderId, ownerId: req.userId! } });
      if (!folder) return res.status(404).json({ error: "Folder not found." });
    }

    const share = await db.share.create({
      data: {
        fileId: fileId ?? null,
        folderId: folderId ?? null,
        ownerId: req.userId!,
        sharedWith: sharedWith ?? null,
        role,
        message: message ?? null,
      },
    });

    res.status(201).json(share);
  } catch (err) {
    console.error("create share error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /mine — shares the current user created
sharesRouter.get("/mine", requireAuth, async (req: Request, res: Response) => {
  try {
    const shares = await db.share.findMany({
      where: { ownerId: req.userId! },
      include: { file: true, folder: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(shares);
  } catch (err) {
    console.error("list my shares error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /with-me — shares other people sent to the current user's email
sharesRouter.get("/with-me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.userId! }, select: { email: true } });
    if (!user) return res.status(404).json({ error: "User not found." });

    const shares = await db.share.findMany({
      where: { sharedWith: user.email },
      include: {
        file: true,
        folder: true,
        owner: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(shares);
  } catch (err) {
    console.error("shared with me error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE /:id — revoke a share (only creator can revoke)
sharesRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const share = await db.share.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!share) return res.status(404).json({ error: "Share not found." });

    await db.share.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete share error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// Public routes (NO requireAuth — that's the whole point of public links)
// ---------------------------------------------------------------------------

// GET /public/:token — look up a share by its unique token
sharesRouter.get("/public/:token", async (req: Request, res: Response) => {
  try {
    const share = await db.share.findUnique({
      where: { token: req.params.token },
      include: { file: true, folder: true },
    });
    if (!share) {
      return res.status(404).json({ error: "This link is invalid or has been revoked." });
    }
    res.json(share);
  } catch (err) {
    console.error("public share lookup error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /public/:token/download — stream the file bytes (backend-proxy pattern,
// same as GET /files/:id/download but without ownership check — the token IS
// the authorization).
sharesRouter.get("/public/:token/download", async (req: Request, res: Response) => {
  try {
    const share = await db.share.findUnique({
      where: { token: req.params.token },
      include: { file: true },
    });
    if (!share) {
      return res.status(404).json({ error: "This link is invalid or has been revoked." });
    }
    if (!share.file) {
      return res.status(400).json({ error: "This share points to a folder, not a file." });
    }
    if (!share.file.storageKey) {
      return res.status(409).json({ error: "This file has no uploaded content yet." });
    }

    const obj = await downloadObject(share.file.storageKey);

    res.setHeader("Content-Type", obj.contentType || share.file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(share.file.name)}"`
    );
    if (obj.contentLength) res.setHeader("Content-Length", obj.contentLength);

    const stream = obj.body as NodeJS.ReadableStream;
    stream.pipe(res);
  } catch (err) {
    console.error("public download error:", err);
    res.status(500).json({ error: "Download failed. Please try again." });
  }
});
