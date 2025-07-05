/**
 * Checkmarx scan janitor
 * ----------------------
 * Deletes completed scans whose LOC exceeds LOC_THRESHOLD.
 *
 * ENV VARS REQUIRED:
 *   CLIENT_ID
 *   CLIENT_SECRET
 *
 * Usage: node loc-limiter.js
 */
