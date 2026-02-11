
const BRIDGE_URL = process.env.BRIDGE_URL || "http://localhost:8911";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY;
const USERNAME = process.env.GITHUB_USERNAME;

if (!BRIDGE_API_KEY || !USERNAME) {
  console.error("❌ Error: BRIDGE_API_KEY and GITHUB_USERNAME environment variables are required.");
  process.exit(1);
}

async function testAuth() {
  console.log(`Testing Bridge Auth at ${BRIDGE_URL}`);
  console.log(`Using username: ${USERNAME}`);

  // 1. Test without API key
  console.log("\n1. Testing request WITHOUT x-api-key...");
  try {
    const res = await fetch(`${BRIDGE_URL}/api/jobs?username=${USERNAME}`);
    console.log(`Status: ${res.status}`);
    if (res.status === 401) {
      console.log("✅ Success: Rejected as expected (401)");
    } else {
      console.log(`❌ Failure: Expected 401 but got ${res.status}`);
    }
  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }

  // 2. Test with WRONG API key
  console.log("\n2. Testing request with WRONG x-api-key...");
  try {
    const res = await fetch(`${BRIDGE_URL}/api/jobs?username=${USERNAME}`, {
      headers: { "x-api-key": "wrong-key" },
    });
    console.log(`Status: ${res.status}`);
    if (res.status === 401) {
      console.log("✅ Success: Rejected as expected (401)");
    } else {
      console.log(`❌ Failure: Expected 401 but got ${res.status}`);
    }
  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }

  // 3. Test with CORRECT API key
  console.log("\n3. Testing request with CORRECT x-api-key...");
  try {
    const res = await fetch(`${BRIDGE_URL}/api/jobs?username=${USERNAME}`, {
      headers: { "x-api-key": BRIDGE_API_KEY! },
    });
    console.log(`Status: ${res.status}`);
    if (res.ok) {
      console.log("✅ Success: Accepted as expected (200)");
      const data = await res.json();
      console.log("Response:", JSON.stringify(data, null, 2));
    } else {
      console.log(`❌ Failure: Expected 200 but got ${res.status}`);
      console.log("Response:", await res.text());
    }
  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }
}

testAuth();
