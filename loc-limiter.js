const axios = require("axios");
require("dotenv").config();

// === Configuration ===
const BASE_URL = "https://ind.ast.checkmarx.net";
const TOKEN_URL =
  "https://ind.iam.checkmarx.net/auth/realms/sudha/protocol/openid-connect/token";
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const LOC_THRESHOLD = 30;
const POLL_INTERVAL = 10_000; // 10 seconds

let accessToken = "";
let seenScans = new Set();
let totalScanCount = 0;

// === Fetch Auth Token ===
async function fetchAuthToken() {
  console.log("Fetching auth token …");
  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "client_credentials",
      client_secret: CLIENT_SECRET,
    });

    const { data } = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    accessToken = data.access_token;
    console.log("Access token retrieved successfully.");
  } catch (error) {
    console.error(
      "Error fetching auth token:",
      error.response?.data || error.message
    );
    process.exit(1);
  }
}

// === auth headers ===
function getHeaders(contentType = "application/json; version=1.0") {
  return {
    Accept: "application/json; version=1.0",
    "Content-Type": contentType,
    Authorization: `Bearer ${accessToken}`,
  };
}

// === Get list of scans ===
async function getScans() {
  console.log("Fetching list of scans …");
  try {
    const { data } = await axios.get(`${BASE_URL}/api/scans`, {
      headers: getHeaders(),
    });

    // 1. Log the full JSON body so you can see everything that comes back
    //console.log("Full scans response:\n", JSON.stringify(data, null, 2));

    // 2. Store totalCount globally
    totalScanCount = data.totalCount ?? 0;
    console.log(`totalCount saved globally: ${totalScanCount}`);

    // 3. Return the array so the caller can iterate
    return data.scans ?? [];
  } catch (error) {
    console.error(
      "Error fetching scan list:",
      error.response?.data || error.message
    );
    return []; // keep the rest of the loop alive
  }
}

// helper — find LOC no matter where the API puts it
function extractLOC(scanOrDetails) {
  // 1. top‑level fallback
  if (typeof scanOrDetails.loc === "number") return scanOrDetails.loc;

  // 2. inside statusDetails (usual case)
  if (Array.isArray(scanOrDetails.statusDetails)) {
    // prefer 'sast' record if it has loc
    const sast = scanOrDetails.statusDetails.find(
      (d) => d.name?.toLowerCase?.() === "sast" && typeof d.loc === "number"
    );
    if (sast) return sast.loc;

    // otherwise take the first entry that exposes loc
    const any = scanOrDetails.statusDetails.find(
      (d) => typeof d.loc === "number"
    );
    if (any) return any.loc;
  }

  return undefined; // couldn’t find it
}

// === Get scan details ===
async function getScanDetails(scanId) {
  console.log(`Fetching details for scan ${scanId} …`);
  try {
    const { data } = await axios.get(`${BASE_URL}/api/scans/${scanId}`, {
      headers: getHeaders(),
    });
    console.log(`Scan ${scanId} details retrieved.`);
    return data;
  } catch (error) {
    console.error(
      `Error fetching scan details for ${scanId}:`,
      error.response?.data || error.message
    );
    return null;
  }
}

// === Cancel scan ===
async function cancelScan(scanId) {
  console.log(`Cancelling scan ${scanId} …`);
  try {
    await axios.patch(
      `${BASE_URL}/api/scans/${scanId}`,
      { status: "Canceled" },
      { headers: getHeaders() }
    );
    console.log(`Scan ${scanId} canceled successfully.`);
  } catch (error) {
    console.error(
      `Error cancelling scan ${scanId}:`,
      error.response?.data || error.message
    );
  }
}

// === Main poller loop ===
async function monitorScans() {
  try {
    await fetchAuthToken();
    console.log("Starting scan-monitoring loop …");

    while (true) {
      const scans = await getScans();

      if (!scans.length) {
        console.log("No scans available at this time.");
      }

      for (const scan of scans) {
        const scanId = scan.id;

        if (seenScans.has(scanId)) continue; // already processed

        seenScans.add(scanId);
        console.log(`New scan detected: ${scanId}`);

        // try to get LOC straight from the current payload
        let loc = extractLOC(scan);

        // If not present, fall back to GET /scans/:id (rare)
        if (loc === undefined) {
          const details = await getScanDetails(scanId);
          loc = extractLOC(details);
        }

        // ---------- decision logic ----------
        if (loc === undefined) {
          console.warn(`LOC not found for scan ${scanId}`);
          continue;
        }

        if (loc > LOC_THRESHOLD) {
          console.log(
            `LOC (${loc}) exceeds threshold (${LOC_THRESHOLD}) for scan ${scanId}. Cancelling …`
          );
          await cancelScan(scanId);
        } else {
          console.log(`LOC (${loc}) is within threshold for scan ${scanId}.`);
        }
      }

      console.log(`Waiting ${POLL_INTERVAL / 1000}s before next check …\n`);
      await new Promise((res) => setTimeout(res, POLL_INTERVAL));
    }
  } catch (e) {
    console.error("Unexpected error in monitorScans:", e);
  }
}

// === Run ===
monitorScans();
