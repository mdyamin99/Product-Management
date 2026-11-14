import { AppError } from "../../lib/app-error.js";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { publishProductEvent } from "../events/kafka-events.js";
import { readProductActivity } from "../events/product-activity.js";
import type { z } from "zod";
import type {
  createProductSchema,
  updateProductSchema,
} from "./product.schema.js";

type CreateProductInput = z.infer<typeof createProductSchema>;
type UpdateProductInput = z.infer<typeof updateProductSchema>;

const PRODUCT_LIST_KEY = "products:all";
const PRODUCT_KEY_PREFIX = "products:";

type ProductSource = "CACHE" | "DATABASE";

// Re-exported so existing importers keep working from a single definition.
export { AppError };

async function readCache<T>(key: string): Promise<T | null> {
  if (!redis.isReady) return null;

  try {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch (error) {
    console.error("Redis read failed:", error);
    return null;
  }
}

async function writeCache(key: string, value: unknown): Promise<void> {
  if (!redis.isReady) return;

  try {
    await redis.set(key, JSON.stringify(value), {
      EX: env.CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Redis write failed:", error);
  }
}

async function invalidateProductCache(id?: number): Promise<void> {
  if (!redis.isReady) return;

  try {
    const keys = [PRODUCT_LIST_KEY];

    if (id !== undefined) {
      keys.push(`${PRODUCT_KEY_PREFIX}${id}`);
    }

    await redis.del(keys);
  } catch (error) {
    console.error("Redis invalidation failed:", error);
  }
}

export async function getProducts() {
  const cached = await readCache<unknown[]>(PRODUCT_LIST_KEY);

  if (cached !== null) {
    await publishProductEvent("product.fetched", {
      source: "CACHE",
      count: cached.length,
    });

    return {
      data: cached,
      source: "CACHE" as ProductSource,
    };
  }

  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
  });

  await writeCache(PRODUCT_LIST_KEY, products);

  await publishProductEvent("product.fetched", {
    source: "DATABASE",
    count: products.length,
  });

  return {
    data: products,
    source: "DATABASE" as ProductSource,
  };
}

export async function getProductById(id: number) {
  const key = `${PRODUCT_KEY_PREFIX}${id}`;
  const cached = await readCache<unknown>(key);

  if (cached !== null) {
    await publishProductEvent("product.fetched", { id, source: "CACHE" });

    return {
      data: cached,
      source: "CACHE" as ProductSource,
    };
  }

  const product = await prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  await writeCache(key, product);

  await publishProductEvent("product.fetched", { id, source: "DATABASE" });

  return {
    data: product,
    source: "DATABASE" as ProductSource,
  };
}

export async function createProduct(input: CreateProductInput) {
  const product = await prisma.product.create({
    data: {
      name: input.name,
      description: input.description,
      price: input.price,
    },
  });

  await invalidateProductCache();

  await publishProductEvent("product.created", { ...product });

  return product;
}

export async function updateProduct(id: number, input: UpdateProductInput) {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw new AppError(404, "Product not found");
  }

  const product = await prisma.product.update({
    where: { id },
    data: input,
  });

  await invalidateProductCache(id);

  await publishProductEvent("product.updated", { ...product });

  return product;
}

export async function deleteProduct(id: number) {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw new AppError(404, "Product not found");
  }

  await prisma.product.delete({ where: { id } });

  await invalidateProductCache(id);

  await publishProductEvent("product.deleted", { id });
}

/**
 * The feed the RabbitMQ consumer fills from Kafka product events. Exposed so
 * the dashboard can show the message pipeline doing real work.
 */
export async function getProductActivity() {
  return readProductActivity();
}
