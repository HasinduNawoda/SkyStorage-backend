import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/requireAuth";

export const filesRouter = Router();

// Same pattern as foldersRouter: requireAuth proves someone is logged in,
// but every query below is additionally scoped to `ownerId: req.userId` —
// that's what actually stops user A from touching user B's files.
filesRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().trim().min(1).max(255),
  folderId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  folderId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});

/** Confirms `folderId` (if given) is null, or a folder this user actually owns. */
async function assertValidFolder(userId: string, folderId: string | null | undefined) {
  if (folderId === null || folderId === undefined) return;
  const folder = await db.folder.findFirst({ where: { id: folderId, ownerId: userId } });
  if (!folder) {
    throw Object.assign(new Error("Folder not found."), { status: 400 });
  }
}

// GET /files?folderId=<uuid>  (omit folderId, or pass "null", for root)
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
    res.status(201).json(file);
  } catch (err: any) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("create file error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
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

// Hard delete — only meant to be called from the Recycle Bin (permanently remove).
filesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await db.file.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!existing) return res.status(404).json({ error: "File not found." });

    await db.file.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete file error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});