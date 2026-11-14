import { useEffect, useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { apiFetch } from "./api/client";
import { useAuth } from "./auth/AuthContext";

type Product = {
  id: number | string;
  name: string;
  price: number;
  description?: string | null;
};

type Tab = "products" | "add" | "fetch" | "activity";

type ActivityEntry = {
  eventId: string;
  type: string;
  productId: number | null;
  occurredAt: string;
  source?: string;
  name?: string;
};

type ActivityFeed = {
  available: boolean;
  recent: ActivityEntry[];
  counts: Record<string, number>;
};

type ActivityResponse = {
  success: boolean;
  data: ActivityFeed;
};

const ACTIVITY_TYPES: { type: string; label: string; badge: string }[] = [
  {
    type: "product.fetched",
    label: "Fetched",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  },
  {
    type: "product.created",
    label: "Created",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  {
    type: "product.updated",
    label: "Updated",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  {
    type: "product.deleted",
    label: "Deleted",
    badge: "border-red-500/30 bg-red-500/10 text-red-300",
  },
];

/** Read the feed the RabbitMQ consumer writes (no state touched: effect-safe). */
function fetchActivity(): Promise<ActivityFeed> {
  return apiFetch<ActivityResponse>("/products/activity").then(
    (payload) => payload.data,
  );
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getProducts(data: unknown): Product[] {
  if (Array.isArray(data)) return data as Product[];

  if (data && typeof data === "object") {
    const result = data as Record<string, unknown>;

    if (Array.isArray(result.products)) {
      return result.products as Product[];
    }

    if (Array.isArray(result.data)) {
      return result.data as Product[];
    }

    if (result.data && typeof result.data === "object") {
      const nested = result.data as Record<string, unknown>;

      if (Array.isArray(nested.products)) {
        return nested.products as Product[];
      }

      if (Array.isArray(nested.items)) {
        return nested.items as Product[];
      }
    }
  }

  return [];
}

function App() {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<number | string | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const [productId, setProductId] = useState("");
  const [fetchedProduct, setFetchedProduct] = useState<Product | null>(null);
  const [source, setSource] = useState("");
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [fetching, setFetching] = useState(false);

  const [activity, setActivity] = useState<ActivityFeed | null>(null);
  const [activityError, setActivityError] = useState("");

  async function fetchProducts(): Promise<Product[]> {
    const data = await apiFetch<unknown>("/products");
    return getProducts(data);
  }

  function loadError(error: unknown): string {
    return error instanceof Error ? error.message : "Failed to load products.";
  }

  async function loadProducts() {
    setLoadingProducts(true);
    setPageError("");

    try {
      setProducts(await fetchProducts());
    } catch (error) {
      setPageError(loadError(error));
    } finally {
      setLoadingProducts(false);
    }
  }

  // The initial load inlines its state updates on purpose:
  // `react-hooks/set-state-in-effect` rejects calling a state-touching helper
  // from an effect, even one that only writes after an `await`.
  useEffect(() => {
    void fetchProducts()
      .then((list) => {
        setProducts(list);
        setPageError("");
      })
      .catch((error: unknown) => {
        setPageError(loadError(error));
      })
      .finally(() => {
        setLoadingProducts(false);
      });
  }, []);

  // Poll the activity feed while its tab is open so the pipeline (Kafka ->
  // RabbitMQ -> Redis) is visible live. State is only written from promise
  // callbacks, never synchronously from the effect itself.
  useEffect(() => {
    if (tab !== "activity") return;

    let cancelled = false;

    const read = () =>
      fetchActivity().then(
        (feed) => {
          if (!cancelled) {
            setActivity(feed);
            setActivityError("");
          }
        },
        (error: unknown) => {
          if (!cancelled) setActivityError(loadError(error));
        },
      );

    void read();

    const timer = setInterval(() => void read(), 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tab]);

  function refreshActivity() {
    setActivityError("");

    fetchActivity().then(
      (feed) => setActivity(feed),
      (error: unknown) => setActivityError(loadError(error)),
    );
  }

  function openAddForm() {
    setEditingProduct(null);
    setName("");
    setPrice("");
    setDescription("");
    setPageError("");
    setNotice("");
    setTab("add");
  }

  function openEditForm(product: Product) {
    setEditingProduct(product);
    setName(product.name);
    setPrice(String(product.price));
    setDescription(product.description || "");
    setPageError("");
    setNotice("");
    setTab("add");
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setPageError("");

    const payload = {
      name: name.trim(),
      price: Number(price),
      description: description.trim(),
    };

    try {
      if (editingProduct) {
        await apiFetch(
          `/products/${encodeURIComponent(String(editingProduct.id))}`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
          },
        );
        setNotice("Product updated successfully.");
      } else {
        await apiFetch("/products", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice("Product added successfully.");
      }

      setEditingProduct(null);
      setName("");
      setPrice("");
      setDescription("");
      setTab("products");
      await loadProducts();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Failed to save product.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(product: Product) {
    setBusyDelete(true);
    setNotice("");
    setPageError("");

    try {
      await apiFetch(`/products/${encodeURIComponent(String(product.id))}`, {
        method: "DELETE",
      });

      setNotice(`Product "${product.name}" deleted successfully.`);
      setDeletingId(null);

      if (String(productId) === String(product.id)) {
        setFetchedProduct(null);
        setSource("");
      }

      await loadProducts();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Failed to delete product.",
      );
    } finally {
      setBusyDelete(false);
    }
  }

  async function fetchOneProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFetching(true);
    setFetchedProduct(null);
    setSource("");
    setFetchError("");
    setResponseTime(null);

    const start = performance.now();

    try {
      const data = await apiFetch<unknown>(
        `/products/${encodeURIComponent(productId.trim())}`,
      );

      setResponseTime(Math.round(performance.now() - start));

      if (!data || typeof data !== "object") {
        throw new Error("Invalid product response from server.");
      }

      const result = data as Record<string, unknown>;
      const nested = result.data;

      const product =
        nested && typeof nested === "object"
          ? (nested as Product)
          : (result as unknown as Product);

      if (product.id === undefined || product.name === undefined) {
        throw new Error("Product details were missing from the response.");
      }

      setFetchedProduct(product);

      const dataSource = result.source || "UNKNOWN";

      setSource(String(dataSource).toUpperCase());
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "Failed to fetch product.",
      );
    } finally {
      setFetching(false);
    }
  }

  const isCache = source.includes("CACHE");

  const initials = (user?.name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "products", label: "All Products" },
    { id: "add", label: editingProduct ? "Edit Product" : "Add Product" },
    { id: "fetch", label: "Fetch & Cache" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-3 text-xl">📦</div>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">
                Product Monitor
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Product Management · PostgreSQL · Redis · Kafka · RabbitMQ
              </p>
            </div>
          </div>

          {user && (
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
              </div>

              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600/20 text-sm font-semibold text-blue-300">
                {initials || "?"}
              </div>

              <button
                onClick={() => void handleSignOut()}
                disabled={signingOut}
                className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm transition hover:bg-slate-800 disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Total Products</p>
            <p className="mt-2 text-3xl font-bold">
              {loadingProducts ? "..." : products.length}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">API Status</p>
            <p className="mt-2 text-xl font-semibold">
              {loadingProducts
                ? "Checking..."
                : pageError
                  ? "Connection Issue"
                  : "Products Loaded"}
            </p>
          </div>
        </section>

        <nav className="mb-6 flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setNotice("");
                setPageError("");

                if (item.id === "add" && !editingProduct) {
                  setName("");
                  setPrice("");
                  setDescription("");
                }
              }}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                tab === item.id
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {notice && (
          <p className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
            {notice}
          </p>
        )}

        {pageError && (
          <p className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {pageError}
          </p>
        )}

        {tab === "products" && (
          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-5">
              <div>
                <h2 className="text-lg font-semibold">All Products</h2>
                <p className="mt-1 text-sm text-slate-400">
                  View, update, or delete your products.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => void loadProducts()}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
                >
                  ↻ Refresh
                </button>
                <button
                  onClick={openAddForm}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500"
                >
                  + Add Product
                </button>
              </div>
            </div>

            {loadingProducts ? (
              <p className="p-8 text-center text-slate-400">
                Loading products...
              </p>
            ) : products.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-slate-300">No products found.</p>
                <button
                  onClick={openAddForm}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 font-medium"
                >
                  Add Your First Product
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-slate-950/70 text-slate-400">
                    <tr>
                      <th className="px-5 py-4">ID</th>
                      <th className="px-5 py-4">Product Name</th>
                      <th className="px-5 py-4">Price</th>
                      <th className="px-5 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr
                        key={product.id}
                        className="border-t border-slate-800 hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4 font-mono text-blue-300">
                          {product.id}
                        </td>
                        <td className="px-5 py-4 font-medium">
                          {product.name}
                          {product.description && (
                            <p className="mt-1 max-w-xs truncate text-xs text-slate-500">
                              {product.description}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {Number(product.price).toLocaleString("en-BD", {
                            style: "currency",
                            currency: "BDT",
                          })}
                        </td>
                        <td className="px-5 py-4">
                          {deletingId === product.id ? (
                            <div className="flex items-center gap-2">
                              <button
                                disabled={busyDelete}
                                onClick={() => void deleteProduct(product)}
                                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold hover:bg-red-500 disabled:opacity-50"
                              >
                                {busyDelete ? "Deleting..." : "Confirm"}
                              </button>
                              <button
                                disabled={busyDelete}
                                onClick={() => setDeletingId(null)}
                                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setProductId(String(product.id));
                                  setFetchedProduct(null);
                                  setSource("");
                                  setFetchError("");
                                  setTab("fetch");
                                }}
                                className="rounded-md border border-slate-700 px-3 py-1.5 text-blue-300 hover:bg-slate-800"
                              >
                                Fetch
                              </button>
                              <button
                                onClick={() => openEditForm(product)}
                                className="rounded-md border border-amber-500/30 px-3 py-1.5 text-amber-300 hover:bg-amber-500/10"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeletingId(product.id)}
                                className="rounded-md border border-red-500/30 px-3 py-1.5 text-red-300 hover:bg-red-500/10"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "add" && (
          <section className="max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
            <h2 className="text-xl font-semibold">
              {editingProduct ? "Update Product" : "Add New Product"}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {editingProduct
                ? `Editing product ID: ${editingProduct.id}`
                : "Enter the product details below."}
            </p>

            <form onSubmit={saveProduct} className="mt-6 space-y-5">
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Product Name *
                </label>
                <input
                  required
                  minLength={1}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Mechanical Keyboard"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Price (BDT) *
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="e.g. 1500"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Enter an optional description"
                  rows={3}
                  className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  disabled={saving}
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : editingProduct
                      ? "Update Product"
                      : "+ Add Product"}
                </button>

                {editingProduct && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProduct(null);
                      setName("");
                      setPrice("");
                      setDescription("");
                      setTab("products");
                      setPageError("");
                    }}
                    className="rounded-lg border border-slate-700 px-5 py-3 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>
        )}

        {tab === "fetch" && (
          <section className="max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
            <h2 className="text-xl font-semibold">Fetch a Product</h2>
            <p className="mt-2 text-sm text-slate-400">
              Enter a product ID to inspect its data source.
            </p>

            <form
              onSubmit={fetchOneProduct}
              className="mt-6 flex flex-col gap-3 sm:flex-row"
            >
              <input
                required
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                placeholder="Enter Product ID"
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
              />
              <button
                disabled={fetching}
                type="submit"
                className="rounded-lg bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-500 disabled:opacity-50"
              >
                {fetching ? "Fetching..." : "Fetch Product"}
              </button>
            </form>

            {fetchError && (
              <p className="mt-5 rounded-lg bg-red-500/10 p-4 text-red-300">
                {fetchError}
              </p>
            )}

            {source && (
              <div
                className={`mt-6 rounded-xl border p-5 ${
                  isCache
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : source.includes("DATABASE")
                      ? "border-blue-500/40 bg-blue-500/10"
                      : "border-amber-500/40 bg-amber-500/10"
                }`}
              >
                <p className="text-xs font-semibold tracking-widest text-slate-400">
                  DATA SOURCE
                </p>
                <h3
                  className={`mt-2 text-2xl font-extrabold ${
                    isCache
                      ? "text-emerald-400"
                      : source.includes("DATABASE")
                        ? "text-blue-400"
                        : "text-amber-300"
                  }`}
                >
                  {isCache ? "REDIS CACHE HIT" : source}
                </h3>
                <p className="mt-2 text-sm text-slate-300">
                  {isCache
                    ? "This response came from Redis cache."
                    : source.includes("DATABASE")
                      ? "This response came from the database."
                      : "The backend did not provide a recognized data source."}
                </p>
                {responseTime !== null && (
                  <p className="mt-2 text-sm text-slate-400">
                    Response Time: {responseTime} ms
                  </p>
                )}
              </div>
            )}

            {fetchedProduct && (
              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950 p-5">
                <p className="mb-4 text-sm font-semibold text-slate-300">
                  Product Details
                </p>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">ID</dt>
                    <dd className="font-mono text-blue-300">
                      {fetchedProduct.id}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Name</dt>
                    <dd className="text-right font-medium">
                      {fetchedProduct.name}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Price</dt>
                    <dd>
                      {Number(fetchedProduct.price).toLocaleString("en-BD", {
                        style: "currency",
                        currency: "BDT",
                      })}
                    </dd>
                  </div>
                  {fetchedProduct.description && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-400">Description</dt>
                      <dd className="text-right">
                        {fetchedProduct.description}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </section>
        )}

        {tab === "activity" && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Event Activity</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Product events consumed from RabbitMQ (forwarded from Kafka)
                  and recorded in Redis.
                </p>
              </div>

              <button
                onClick={refreshActivity}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
              >
                ↻ Refresh
              </button>
            </div>

            {activityError && (
              <p className="mt-5 rounded-lg bg-red-500/10 p-4 text-red-300">
                {activityError}
              </p>
            )}

            {!activity && !activityError && (
              <p className="mt-6 text-slate-400">Loading activity...</p>
            )}

            {activity && (
              <>
                {!activity.available && (
                  <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
                    Redis is unavailable, so the feed is paused. Events keep
                    flowing through Kafka and RabbitMQ and reappear once Redis
                    is back.
                  </p>
                )}

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {ACTIVITY_TYPES.map((item) => (
                    <div
                      key={item.type}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-4"
                    >
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${item.badge}`}
                      >
                        {item.label}
                      </span>
                      <p className="mt-2 text-2xl font-bold">
                        {activity.counts[item.type] ?? 0}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        events consumed
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-300">
                    Recent events
                  </h3>

                  {activity.recent.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">
                      No events yet — add, edit, fetch or delete a product and
                      it will show up here within seconds.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-slate-800 rounded-xl border border-slate-800">
                      {activity.recent.map((entry) => {
                        const meta = ACTIVITY_TYPES.find(
                          (item) => item.type === entry.type,
                        );

                        return (
                          <li
                            key={entry.eventId}
                            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${
                                  meta?.badge ?? "border-slate-700 text-slate-400"
                                }`}
                              >
                                {meta?.label ?? entry.type}
                              </span>
                              <span className="text-slate-300">
                                {entry.productId !== null
                                  ? `Product #${entry.productId}`
                                  : "Product list"}
                                {entry.name ? ` · ${entry.name}` : ""}
                                {entry.source ? ` · ${entry.source}` : ""}
                              </span>
                            </div>

                            <span className="text-xs text-slate-500">
                              {formatActivityTime(entry.occurredAt)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        <footer className="mt-8 text-center text-xs text-slate-500">
          Product Monitor · Node.js · PostgreSQL · Redis · Kafka · RabbitMQ
        </footer>
      </div>
    </main>
  );
}

export default App;
