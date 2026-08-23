// E2E test for the Share feature
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const BASE = "http://localhost:4000";

// Helper: extract cookies from signup/login response
function extractCookies(res) {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  const body = await (opts.raw ? res.text() : res.json().catch(() => ({})));
  return { status: res.status, body, headers: res.headers, ok: res.ok };
}

async function run() {
  const ts = Date.now();

  // ---- Create User 1 ----
  console.log("=== Setup: Creating User 1 ===");
  const signup1 = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: `alice-${ts}@test.com`, password: "testpassword123" }),
  });
  if (!signup1.ok) throw new Error("User 1 signup failed: " + (await signup1.text()));
  const cookies1 = extractCookies(signup1);
  const user1 = await signup1.json();
  console.log("User 1:", user1.email);

  // ---- Create User 2 ----
  console.log("=== Setup: Creating User 2 ===");
  const signup2 = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: `bob-${ts}@test.com`, password: "testpassword123" }),
  });
  if (!signup2.ok) throw new Error("User 2 signup failed: " + (await signup2.text()));
  const cookies2 = extractCookies(signup2);
  const user2 = await signup2.json();
  console.log("User 2:", user2.email);

  // ---- User 1: Create a file with bytes ----
  console.log("\n=== Setup: User 1 creates a file ===");
  const createRes = await api("/files", {
    method: "POST",
    headers: { Cookie: cookies1 },
    body: JSON.stringify({ name: "shared-test.txt", sizeBytes: 18, mimeType: "text/plain" }),
  });
  if (!createRes.ok) throw new Error("Create file failed: " + JSON.stringify(createRes.body));
  const fileId = createRes.body.id;
  console.log("File ID:", fileId);

  // Upload bytes
  const uploadRes = await fetch(`${BASE}/files/${fileId}/upload`, {
    method: "POST",
    headers: { Cookie: cookies1, "Content-Type": "application/octet-stream" },
    body: "Shared file bytes!",
  });
  if (!uploadRes.ok) throw new Error("Upload failed");
  console.log("Upload: OK");

  // ================================================================
  // TEST 1: Create a public share (no sharedWith)
  // ================================================================
  console.log("\n=== Test 1: Create public share ===");
  const share1 = await api("/shares", {
    method: "POST",
    headers: { Cookie: cookies1 },
    body: JSON.stringify({ fileId }),
  });
  console.log("Status:", share1.status, "Token:", share1.body.token);
  if (share1.status !== 201) throw new Error("Public share creation failed");
  const publicToken = share1.body.token;
  const publicShareId = share1.body.id;
  console.log("✅ Public share created");

  // ================================================================
  // TEST 2: Access public share without auth
  // ================================================================
  console.log("\n=== Test 2: GET /shares/public/:token (no auth) ===");
  const pub = await api(`/shares/public/${publicToken}`);
  console.log("Status:", pub.status);
  console.log("Has file metadata:", !!pub.body.file);
  console.log("File name:", pub.body.file?.name);
  if (pub.status !== 200 || !pub.body.file) throw new Error("Public share lookup failed");
  console.log("✅ Public share accessible without auth");

  // ================================================================
  // TEST 3: Download via public link (no auth)
  // ================================================================
  console.log("\n=== Test 3: GET /shares/public/:token/download (no auth) ===");
  const dlRes = await fetch(`${BASE}/shares/public/${publicToken}/download`);
  console.log("Status:", dlRes.status, dlRes.statusText);
  const dlBody = await dlRes.text();
  console.log("Body:", JSON.stringify(dlBody));
  if (dlRes.status !== 200 || dlBody !== "Shared file bytes!") {
    throw new Error("Public download failed or content mismatch");
  }
  console.log("✅ Public download works — content matches!");

  // ================================================================
  // TEST 4: Create private share (sharedWith = user 2's email)
  // ================================================================
  console.log("\n=== Test 4: Create private share for User 2 ===");
  const share2 = await api("/shares", {
    method: "POST",
    headers: { Cookie: cookies1 },
    body: JSON.stringify({ fileId, sharedWith: user2.email }),
  });
  console.log("Status:", share2.status);
  if (share2.status !== 201) throw new Error("Private share creation failed");
  console.log("✅ Private share created for", user2.email);

  // ================================================================
  // TEST 5: User 2 sees the share under /shares/with-me
  // ================================================================
  console.log("\n=== Test 5: User 2 GET /shares/with-me ===");
  const withMe = await api("/shares/with-me", {
    headers: { Cookie: cookies2 },
  });
  console.log("Status:", withMe.status, "Count:", withMe.body.length);
  const found = withMe.body.find((s) => s.fileId === fileId);
  console.log("Found shared file:", !!found);
  console.log("Shared by:", found?.owner?.name, `(${found?.owner?.email})`);
  if (!found) throw new Error("Private share not visible to User 2");
  console.log("✅ User 2 can see the private share");

  // ================================================================
  // TEST 6: User 1 checks /shares/mine
  // ================================================================
  console.log("\n=== Test 6: User 1 GET /shares/mine ===");
  const mine = await api("/shares/mine", {
    headers: { Cookie: cookies1 },
  });
  console.log("Status:", mine.status, "Count:", mine.body.length);
  if (mine.body.length < 2) throw new Error("Expected at least 2 shares");
  console.log("✅ User 1 sees their shares");

  // ================================================================
  // TEST 7: Delete the public share, confirm 404
  // ================================================================
  console.log("\n=== Test 7: DELETE /shares/:id then verify 404 ===");
  const del = await api(`/shares/${publicShareId}`, {
    method: "DELETE",
    headers: { Cookie: cookies1 },
  });
  console.log("Delete status:", del.status);
  if (del.status !== 200) throw new Error("Delete share failed");

  const pubAfter = await api(`/shares/public/${publicToken}`);
  console.log("Public lookup after delete:", pubAfter.status);
  if (pubAfter.status !== 404) throw new Error("Expected 404 after deletion");
  console.log("✅ Revoked share returns 404");

  // ================================================================
  // TEST 8: Validation — can't share without fileId or folderId
  // ================================================================
  console.log("\n=== Test 8: Validation checks ===");
  const bad1 = await api("/shares", {
    method: "POST",
    headers: { Cookie: cookies1 },
    body: JSON.stringify({}),
  });
  console.log("No fileId/folderId:", bad1.status === 400 ? "✅ 400" : `❌ ${bad1.status}`);

  const bad2 = await api("/shares", {
    method: "POST",
    headers: { Cookie: cookies1 },
    body: JSON.stringify({ fileId: "nonexistent-id" }),
  });
  console.log("Nonexistent fileId:", bad2.status === 404 ? "✅ 404" : `❌ ${bad2.status}`);

  console.log("\n🎉 ALL TESTS PASSED!");
}

run().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
