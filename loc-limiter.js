const axios = require("axios");
require("dotenv").config();

/* ---------- CONFIG ---------- */
const region = "ind";
const BASE_URL = `https://${region}.ast.checkmarx.net`;
const TOKEN_URL = `https://${region}.iam.checkmarx.net/auth/realms/sudha/protocol/openid-connect/token`;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const LOC_THRESHOLD = 30000000;
const POLL_INTERVAL = 10_000; // ms
/* ----------------------------- */

let accessToken = "";
const processedScans = new Set();

/* -------- AUTH --------------- */
async function fetchAuthToken() {
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
  console.log("Auth OK");
}

function headers(ctype = "application/json; version=1.0") {
  return {
    Accept: "application/json; version=1.0",
    "Content-Type": ctype,
    Authorization: `Bearer ${accessToken}`,
  };
}

/* -------- API HELPERS -------- */
async function listScans() {
  const { data } = await axios.get(`${BASE_URL}/api/scans`, {
    headers: headers(),
    params: { limit: 1000 },
  });
  return data.scans ?? [];
}

async function scanDetails(id) {
  const { data } = await axios.get(`${BASE_URL}/api/scans/${id}`, {
    headers: headers(),
  });
  return data;
}

async function deleteScan(id) {
  await axios.delete(`${BASE_URL}/api/scans/${id}`, { headers: headers() });
  console.log(`Deleted scan ${id}`);
}

/* -------- LOC EXTRACTOR ------ */
const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function extractLoc(obj) {
  let loc = toNumber(obj?.loc);
  if (loc !== undefined) return loc;

  const details = obj?.statusDetails;
  if (!Array.isArray(details)) return undefined;

  const sast = details.find(
    (d) => d.name?.toLowerCase?.() === "sast" && toNumber(d.loc) !== undefined
  );
  if (sast) return toNumber(sast.loc);

  const any = details.find((d) => toNumber(d.loc) !== undefined);
  return any ? toNumber(any.loc) : undefined;
}

/* -------- MAIN LOOP ---------- */
async function janitor() {
  await fetchAuthToken();
  console.log("Starting janitor loop");

  while (true) {
    try {
      const scans = await listScans();

      for (const s of scans) {
        if (s.status !== "Completed") continue;
        if (processedScans.has(s.id)) continue;

        let loc = extractLoc(s);
        if (loc === undefined) {
          try {
            const det = await scanDetails(s.id);
            loc = extractLoc(det);
          } catch (err) {
            console.warn(
              `Could not retrieve details for ${s.id}:`,
              err.response?.status || err.message
            );
          }
        }

        if (loc !== undefined && loc > LOC_THRESHOLD) {
          await deleteScan(s.id);
        } else {
          console.log(`Kept scan ${s.id} (loc = ${loc ?? "N/A"})`);
        }

        processedScans.add(s.id);
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    } catch (err) {
      console.error("Loop error:", err.response?.data || err.message);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
  }
}

janitor();
