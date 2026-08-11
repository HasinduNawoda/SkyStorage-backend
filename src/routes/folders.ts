import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/requireAuth";

export const foldersRouter = Router();

// Every route here requires a logged-in user, and — just as importantly —
// every query below is scoped to `ownerId: req.userId`. That second part is
// what actually prevents user A from reading/renaming/deleting user B's
// folders by guessing an id; requireAuth alone only proves *someone* is
// logged in, not that they own the thing they're asking about.
foldersRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parentId: z.string().nullable().optional(),
  isFavorite: z.boolean().optional(),
  deletedAt: z.union([z.string(), z.null()]).optional(),
});

/** Confirms `parentId` (if given) is null, or a folder this user actually owns. */
async function assertValidParent(userId: string, parentId: string | null | undefined) {
  if (parentId === null || parentId === undefined) return;
  const parent = await db.folder.findFirst({ where: { id: parentId, ownerId: userId } });
  if (!parent) {
    throw Object.assign(new Error("Parent folder not found."), { status: 400 });
  }
}

// GET /folders?parentId=<uuid>  (omit parentId, or pass "null", for root)
// GET /folders?all=true         (every folder this user owns, any depth —
//   the frontend keeps its whole tree in memory client-side for filtering/
//   search, rather than lazy-loading level by level, so it needs this.)
foldersRouter.get("/", async (req: Request, res: Response) => {
  try {
    if (req.query.all === "true") {
      const folders = await db.folder.findMany({
        where: { ownerId: req.userId! },
        orderBy: { createdAt: "desc" },
      });
      return res.json(folders);
    }

    const parentId = req.query.parentId;
    const where =
      parentId === undefined || parentId === "null"
        ? { ownerId: req.userId!, parentId: null }
        : { ownerId: req.userId!, parentId: String(parentId) };

    const folders = await db.folder.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json(folders);
  } catch (err) {
    console.error("list folders error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

foldersRouter.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    }
    const { name, parentId } = parsed.data;
    await assertValidParent(req.userId!, parentId);

    const folder = await db.folder.create({
      data: { name, parentId: parentId ?? null, ownerId: req.userId! },
    });
    res.status(201).json(folder);
  } catch (err: any) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("create folder error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

foldersRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    }

    const existing = await db.folder.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!existing) return res.status(404).json({ error: "Folder not found." });

    if (parsed.data.parentId !== undefined) {
      if (parsed.data.parentId === req.params.id) {
        return res.status(400).json({ error: "A folder can't be moved into itself." });
      }
      await assertValidParent(req.userId!, parsed.data.parentId);
    }

    const folder = await db.folder.update({
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
    res.json(folder);
  } catch (err: any) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("update folder error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Hard delete — only meant to be called from the Recycle Bin (permanently remove).
foldersRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await db.folder.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
    });
    if (!existing) return res.status(404).json({ error: "Folder not found." });

    await db.folder.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete folder error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});