// End-to-end test: signup → create file → upload bytes → download bytes
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Avast Web Shield intercepts HTTPS
const BASE = "http://localhost:4000";

async function run() {
  // 1. Sign up
  console.log("=== Step 1: Signing up ===");
  const signupRes = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Tester",
      email: `e2e-${Date.now()}@test.com`,
      password: "testpassword123",
    }),
  });
  const signupBody = await signupRes.json();
  console.log("Signup status:", signupRes.status, signupBody);
  if (!signupRes.ok) throw new Error("Signup failed");

  // Extract cookies from Set-Cookie headers
  const setCookies = signupRes.headers.getSetCookie();
  const cookieHeader = setCookies
    .map((c) => c.split(";")[0])
    .join("; ");
  console.log("Cookies:", cookieHeader);

  const authedHeaders = {
    Cookie: cookieHeader,
    "Content-Type": "application/json",
  };

  // 2. POST /files — create a file record and get uploadUrl
  console.log("\n=== Step 2: Creating file record ===");
  const createRes = await fetch(`${BASE}/files`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify({
      name: "hello.txt",
      sizeBytes: 13,
      mimeType: "text/plain",
    }),
  });
  const createBody = await createRes.json();
  console.log("Create status:", createRes.status);
  console.log("File record:", JSON.stringify(createBody, null, 2));
  if (!createRes.ok) throw new Error("Create file failed: " + JSON.stringify(createBody));

  const { id: fileId, uploadUrl, storageKey } = createBody;
  console.log("File ID:", fileId);
  console.log("Storage Key:", storageKey);
  console.log("Upload URL:", uploadUrl?.slice(0, 120) + "...");

  // 3. PUT the test string to the presigned upload URL
  console.log("\n=== Step 3: Uploading bytes ===");
  const testPayload = "Hello Oracle!";
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: testPayload,
  });
  console.log("Upload status:", uploadRes.status, uploadRes.statusText);
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error("Upload error body:", errText);
    throw new Error("Upload failed");
  }
  console.log("Upload succeeded!");

  // 4. GET /files/:id/download-url — get a presigned download URL
  console.log("\n=== Step 4: Getting download URL ===");
  const dlUrlRes = await fetch(`${BASE}/files/${fileId}/download-url`, {
    headers: { Cookie: cookieHeader },
  });
  const dlUrlBody = await dlUrlRes.json();
  console.log("Download URL status:", dlUrlRes.status);
  console.log("Download URL:", dlUrlBody.url?.slice(0, 120) + "...");
  if (!dlUrlRes.ok) throw new Error("Get download URL failed");

  // 5. GET the download URL and verify the body
  console.log("\n=== Step 5: Downloading and verifying ===");
  const downloadRes = await fetch(dlUrlBody.url);
  console.log("Download status:", downloadRes.status, downloadRes.statusText);
  const downloaded = await downloadRes.text();
  console.log("Downloaded body:", JSON.stringify(downloaded));
  console.log("Expected body: ", JSON.stringify(testPayload));

  if (downloaded === testPayload) {
    console.log("\n✅ FULL ROUND-TRIP SUCCESS! Upload → Download matches exactly.");
  } else {
    console.error("\n❌ MISMATCH! Downloaded content does not match uploaded content.");
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
