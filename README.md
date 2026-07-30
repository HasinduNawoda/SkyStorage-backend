# skystorage-backend — Milestone 2: Database connection

Milestone 1 got the server running. This milestone connects it to a real
Postgres database using Prisma, and creates the first table (`User`).
Still no signup/login yet — that's Milestone 3.

## What's new since Milestone 1

```
prisma/schema.prisma  — describes the database tables. Currently just User.
src/db.ts              — the shared connection to the database
.env.example            — template for your database connection string
src/index.ts            — added a new /db-check route
```

## 1. Install Docker Desktop (if you don't have it)

https://www.docker.com/products/docker-desktop/ — installer, click through,
then make sure it's actually running (you'll see a whale icon in your system tray).

We're using Docker so you don't have to install Postgres directly on Windows —
it runs in an isolated container instead, and you can delete it cleanly later.

## 2. Start a local Postgres database

Open PowerShell and run:

```powershell
docker run --name skystorage-db -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=skystorage -p 5432:5432 -d postgres:16
```

This downloads Postgres (first time only) and starts it in the background.
Check it's running:

```powershell
docker ps
```

You should see `skystorage-db` in the list. Later, if you restart your
computer, this container stops — start it again with:

```powershell
docker start skystorage-db
```

## 3. Set up your `.env` file

In the project folder:

```powershell
copy .env.example .env
```

The default values already match the Docker command above, so you shouldn't
need to edit anything for local development.

## 4. Install the new dependencies and create the table

```powershell
npm install
npx prisma migrate dev --name init
```

That second command is the important one: it reads `prisma/schema.prisma`,
connects to your Postgres container, and actually creates the `User` table.
You'll see it print out the SQL it ran. Any time we change `schema.prisma`
later (adding Folders, Files, etc.), we run this same command again with a
new name.

## 5. Run the server and test the connection

```powershell
npm run dev
```

Then in a browser or another terminal:

```powershell
curl.exe http://localhost:4000/health
curl.exe http://localhost:4000/db-check
```

Expected for `/db-check`: `{"connected":true,"userCount":0}` — `0` is
correct, since we haven't created any users yet. That number will go up once
we build signup in Milestone 3.

## Troubleshooting

- **`Can't reach database server at localhost:5432`** — the Docker container
  isn't running. Run `docker start skystorage-db`, then try again.
- **`docker: command not found`** — Docker Desktop isn't installed, or isn't
  on your PATH yet; restart your terminal after installing it.
- **`npx prisma migrate dev` asks to reset the database** — safe to say yes
  on a fresh local database with no real data in it yet.

## What just happened

- `prisma/schema.prisma` is a description of your tables, written in
  Prisma's own simple syntax instead of raw SQL.
- `npx prisma migrate dev` turns that description into real tables in
  Postgres, and generates a matching set of TypeScript types/functions
  (`db.user.count()`, `db.user.create()`, etc.) so your code stays in sync
  with your actual database schema.
- `src/db.ts` creates one shared connection (`db`) that the rest of the app
  imports and reuses, rather than opening a new database connection on every
  request.

## Next: Milestone 3

Once `/db-check` returns `{"connected":true,"userCount":0}` for you, let me
know and we'll build real signup/login: password hashing, JWT session
cookies, and the `/auth/signup` + `/auth/login` routes.
