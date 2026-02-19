async function testPoll() {
  const url = "http://localhost:8910/_apis/distributedtask/pools/1/messages?sessionId=test-session";
  console.log(`Polling ${url}...`);
  const start = Date.now();
  const res = await fetch(url);
  const body = await res.json();
  const duration = Date.now() - start;
  console.log(`Response (${duration}ms):`, JSON.stringify(body, null, 2));
}

testPoll();
