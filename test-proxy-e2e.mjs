// E2E test: signup → create file → upload via proxy → download via proxy → verify
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const BASE = "http://localhost:4000";

async function run() {
  // 1. Sign up
  console.log("=== Step 1: Signing up ===");
  const signupRes = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Proxy Tester",
      email: `proxy-${Date.now()}@test.com`,
      password: "testpassword123",
    }),
  });
  const signupBody = await signupRes.json();
  console.log("Signup status:", signupRes.status, signupBody);
  if (!signupRes.ok) throw new Error("Signup failed");

  const setCookies = signupRes.headers.getSetCookie();
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");

  const authedHeaders = { Cookie: cookieHeader, "Content-Type": "application/json" };

  // 2. POST /files — create a file record
  console.log("\n=== Step 2: Creating file record ===");
  const createRes = await fetch(`${BASE}/files`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify({ name: "proxy-test.txt", sizeBytes: 13, mimeType: "text/plain" }),
  });
  const createBody = await createRes.json();
  console.log("Create status:", createRes.status);
  console.log("File ID:", createBody.id);
  console.log("Storage Key:", createBody.storageKey);
  if (!createRes.ok) throw new Error("Create failed: " + JSON.stringify(createBody));

  const fileId = createBody.id;

  // 3. POST /files/:id/upload — upload bytes via proxy
  console.log("\n=== Step 3: Uploading via proxy ===");
  const testPayload = "Hello Proxy!";
  const uploadRes = await fetch(`${BASE}/files/${fileId}/upload`, {
    method: "POST",
    headers: { Cookie: cookieHeader, "Content-Type": "application/octet-stream" },
    body: testPayload,
  });
  const uploadBody = await uploadRes.json();
  console.log("Upload status:", uploadRes.status, uploadBody);
  if (!uploadRes.ok) throw new Error("Proxy upload failed");

  // 4. GET /files/:id/download — download via proxy
  console.log("\n=== Step 4: Downloading via proxy ===");
  const dlRes = await fetch(`${BASE}/files/${fileId}/download`, {
    headers: { Cookie: cookieHeader },
  });
  console.log("Download status:", dlRes.status, dlRes.statusText);
  console.log("Content-Type:", dlRes.headers.get("content-type"));
  console.log("Content-Disposition:", dlRes.headers.get("content-disposition"));
  if (!dlRes.ok) throw new Error("Proxy download failed");

  const downloaded = await dlRes.text();
  console.log("Downloaded body:", JSON.stringify(downloaded));
  console.log("Expected body: ", JSON.stringify(testPayload));

  if (downloaded === testPayload) {
    console.log("\n✅ FULL PROXY ROUND-TRIP SUCCESS! Upload → Download matches exactly.");
  } else {
    console.error("\n❌ MISMATCH!");
    process.exit(1);
  }

  // 5. Also verify the old presigned-URL download path still works
  console.log("\n=== Step 5: Verifying presigned URL path still works ===");
  const dlUrlRes = await fetch(`${BASE}/files/${fileId}/download-url`, {
    headers: { Cookie: cookieHeader },
  });
  const dlUrlBody = await dlUrlRes.json();
  console.log("Download URL status:", dlUrlRes.status);
  if (!dlUrlRes.ok) throw new Error("Get download URL failed");

  const presignedDl = await fetch(dlUrlBody.url);
  const presignedBody = await presignedDl.text();
  console.log("Presigned download status:", presignedDl.status);
  console.log("Presigned body matches:", presignedBody === testPayload ? "✅ YES" : "❌ NO");
}

run().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
