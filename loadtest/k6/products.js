import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Counter } from "k6/metrics";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const HOLD_DURATION = __ENV.K6_DURATION || "2m";
const SEED_COUNT = Number(__ENV.K6_SEED_COUNT || 50);
const READ_ONLY = __ENV.K6_READ_ONLY === "true" || __ENV.K6_READ_ONLY === "1";

// How many scratch products a single VU may own at once. Writes are
// self-contained per VU (create -> update -> delete) so they never race
// against another VU's data or the seeded read pool.
const MAX_SCRATCH_IDS = 50;

// Read-heavy mix by default: ~90% reads, ~10% writes.
const FULL_MIX = [
  { weight: 0.68, endpoint: "list" },
  { weight: 0.22, endpoint: "detail" },
  { weight: 0.05, endpoint: "create" },
  { weight: 0.03, endpoint: "update" },
  { weight: 0.02, endpoint: "delete" },
];

// With K6_READ_ONLY=true the write weights are dropped and the remaining
// weights renormalised, so reads fill 100% of the traffic. Useful for
// measuring the Redis cache path in isolation.
const TRAFFIC_MIX = READ_ONLY
  ? renormalise(FULL_MIX.filter((entry) => entry.weight <= 0.5))
  : FULL_MIX;

// Baseline virtual users, shared across the ramp stages below.
const BASE_VUS = Number(__ENV.K6_VUS || 22);

// Counters for CACHE vs DATABASE, read from the X-Data-Source response header
// the backend sets on both product read endpoints.
const dataSourceResponses = new Counter("product_data_source");

export const options = {
  discardResponseBodies: true,
  stages: [
    { target: BASE_VUS, duration: "30s" },
    { target: BASE_VUS, duration: HOLD_DURATION },
    { target: 0, duration: "20s" },
  ],
  thresholds: {
    // Fail the run outright on any request error.
    http_req_failed: ["rate<0.01"],
    // Reads should stay fast; both are usually served from Redis.
    "http_req_duration{endpoint:list}": ["p(95)<250"],
    "http_req_duration{endpoint:detail}": ["p(95)<250"],
    // Writes round-trip Postgres plus a cache invalidation, so allow more.
    "http_req_duration{endpoint:create}": ["p(95)<600"],
    "http_req_duration{endpoint:update}": ["p(95)<600"],
    "http_req_duration{endpoint:delete}": ["p(95)<600"],
    "http_req_duration": ["p(95)<750"],
  },
};

// ---------------------------------------------------------------------------
// Local helpers (no external imports, so the script runs fully offline)
// ---------------------------------------------------------------------------

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickWeighted(mix) {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;

  for (const entry of mix) {
    roll -= entry.weight;
    if (roll <= 0) return entry.endpoint;
  }

  return mix[mix.length - 1].endpoint;
}

function renormalise(mix) {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
  return mix.map((entry) => ({ ...entry, weight: entry.weight / total }));
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    "User-Agent": "k6-loadtest",
  };
}

// Per-VU scratch store. Each VU gets its own JS runtime, so this array is
// private to it and needs no locking.
const scratchIds = [];

function rememberId(id) {
  scratchIds.push(id);
  if (scratchIds.length > MAX_SCRATCH_IDS) scratchIds.shift();
}

function forgetId(id) {
  const index = scratchIds.indexOf(id);
  if (index !== -1) scratchIds.splice(index, 1);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function readList() {
  const res = http.get(`${BASE_URL}/api/products`, {
    headers: jsonHeaders(),
    tags: { endpoint: "list" },
  });

  recordDataSource(res);

  check(res, {
    "list: status 200": (r) => r.status === 200,
    "list: returns data array": (r) => Array.isArray(r.json("data")),
  });
}

function readDetail(productIds) {
  // Every VU has the same seeded pool, so this is safe to sample directly.
  const id = randomItem(productIds);

  const res = http.get(`${BASE_URL}/api/products/${id}`, {
    headers: jsonHeaders(),
    tags: { endpoint: "detail" },
  });

  recordDataSource(res);

  check(res, {
    "detail: status 200": (r) => r.status === 200,
    "detail: returns product id": (r) => r.json("data.id") === id,
  });
}

function createProduct() {
  const res = http.post(
    `${BASE_URL}/api/products`,
    JSON.stringify({
      name: `loadtest-scratch-${__VU}-${__ITER}`,
      description: "Scratch product owned by a single k6 VU.",
      price: Number(randomBetween(1, 999).toFixed(2)),
    }),
    { headers: jsonHeaders(), tags: { endpoint: "create" } },
  );

  check(res, {
    "create: status 201": (r) => r.status === 201,
    "create: returns product id": (r) => typeof r.json("data.id") === "number",
  });

  if (res.status === 201) rememberId(res.json("data.id"));
}

function updateProduct() {
  // No scratch product yet: fall back to a create so the VU stays busy.
  if (scratchIds.length === 0) return createProduct();

  const id = randomItem(scratchIds);

  const res = http.patch(
    `${BASE_URL}/api/products/${id}`,
    JSON.stringify({ price: Number(randomBetween(1, 999).toFixed(2)) }),
    { headers: jsonHeaders(), tags: { endpoint: "update" } },
  );

  check(res, {
    "update: status 200 or 404": (r) => [200, 404].includes(r.status),
    "update: returns product id": (r) => r.json("data.id") === id,
  });

  // 404 means another request cleaned it up; stop tracking it either way.
  if (res.status !== 200) forgetId(id);
}

function deleteProduct() {
  if (scratchIds.length === 0) return createProduct();

  const id = scratchIds.pop();

  const res = http.del(`${BASE_URL}/api/products/${id}`, null, {
    headers: jsonHeaders(),
    tags: { endpoint: "delete" },
  });

  check(res, {
    "delete: status 200 or 404": (r) => [200, 404].includes(r.status),
  });
}

// Record CACHE vs DATABASE for the Grafana dashboard.
function recordDataSource(res) {
  const source =
    res.headers["X-Data-Source"] || res.headers["x-data-source"] || "UNKNOWN";
  dataSourceResponses.add(1, { source });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function setup() {
  const productIds = [];
  const deadline = Date.now() + 30000;

  // The backend may still be starting (e.g. right after `compose up`), so
  // retry seeding for up to 30s before giving up.
  while (productIds.length < SEED_COUNT) {
    const i = productIds.length;

    const res = http.post(
      `${BASE_URL}/api/products`,
      JSON.stringify({
        name: `loadtest-seed-${i}`,
        description: "Seeded by k6 setup(); read pool for the load test.",
        price: 10 + i,
      }),
      { headers: jsonHeaders(), tags: { endpoint: "setup" } },
    );

    if (res.status === 201) {
      productIds.push(res.json("data.id"));
      continue;
    }

    if (Date.now() > deadline) {
      fail(
        `Unable to seed products against ${BASE_URL} (last status ${res.status}). ` +
          "Is the backend running and migrated?",
      );
    }

    sleep(1);
  }

  return { productIds };
}

export default function (data) {
  switch (pickWeighted(TRAFFIC_MIX)) {
    case "list":
      readList();
      break;
    case "detail":
      readDetail(data.productIds);
      break;
    case "create":
      createProduct();
      break;
    case "update":
      updateProduct();
      break;
    case "delete":
      deleteProduct();
      break;
  }

  // Small think time so the mix reads like real traffic rather than a
  // tight request loop.
  sleep(randomBetween(0.05, 0.25));
}

export function teardown(data) {
  for (const id of data.productIds) {
    http.del(`${BASE_URL}/api/products/${id}`, null, {
      headers: jsonHeaders(),
      tags: { endpoint: "teardown" },
    });
  }
}
