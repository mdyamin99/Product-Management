# Load Testing

k6 load test for the products API, using a read-heavy traffic mix that mirrors
real usage.

## Traffic mix

| Endpoint              | Share | Notes                                    |
| --------------------- | ----- | ---------------------------------------- |
| `GET /api/products`   | 68%   | Served from Redis cache after first read |
| `GET /api/products/:id` | 22% | Served from Redis cache after first read |
| `POST /api/products`  | 5%    | Invalidates the list cache               |
| `PATCH /api/products/:id` | 3% | Invalidates list + item cache           |
| `DELETE /api/products/:id` | 2% | Invalidates list + item cache         |

~90% reads, ~10% writes. Each VU owns its own scratch products for writes, so
concurrent runs don't race on the same rows. `setup()` seeds a read pool of
products and `teardown()` cleans them up.

## Run it

Against a running local backend (defaults to `http://localhost:3000`):

```sh
k6 run loadtest/k6/products.js
```

Or as part of the compose stack, with metrics streamed to Prometheus/Grafana:

```sh
docker compose --profile loadtest up loadtest
```

## Options

| Variable           | Default              | Purpose                                   |
| ------------------ | -------------------- | ----------------------------------------- |
| `K6_BASE_URL`      | `http://localhost:3000` | Target base URL                        |
| `K6_DURATION`      | `2m`                 | Hold time at full load                    |
| `K6_VUS`           | `22`                 | Virtual users at peak                     |
| `K6_SEED_COUNT`    | `50`                 | Products seeded for the read pool         |
| `K6_READ_ONLY`     | `false`              | Drop all writes; measure the cache path   |

Examples:

```sh
# Short 30s smoke run
K6_DURATION=30s k6 run loadtest/k6/products.js

# Isolate the Redis cache read path
K6_READ_ONLY=true k6 run loadtest/k6/products.js

# Heavier load
K6_VUS=100 K6_DURATION=5m k6 run loadtest/k6/products.js
```

## Thresholds

The run **fails** (non-zero exit) if any of these are breached, so it can gate
CI:

- `http_req_failed` rate under 1%
- Reads (`list`, `detail`) p95 under 250ms
- Writes (`create`, `update`, `delete`) p95 under 600ms
- Overall p95 under 750ms

## Watching it in Grafana

The compose `loadtest` service writes to Prometheus via remote write. In Grafana
(query the Prometheus datasource) look for:

- `k6_http_reqs` — request rate, `split by endpoint`
- `k6_http_req_duration_p95` — latency, `split by endpoint`
- `k6_http_req_failed` — error rate
- `product_data_source_total` — cache vs. database reads, `split by source`

`product_data_source` comes from the `X-Data-Source` header the backend sets on
read endpoints. In a read-heavy mix you should see most list/detail reads
served from `CACHE`, with `DATABASE` spikes after each write invalidates the
cache.
