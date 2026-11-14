import type { RequestHandler } from "express";
import { AppError } from "./product.service.js";
import * as productService from "./product.service.js";
import {
  createProductSchema,
  updateProductSchema,
  productIdSchema,
} from "./product.schema.js";

function parseId(value: unknown): number {
  const result = productIdSchema.safeParse(value);

  if (!result.success) {
    throw new AppError(400, "Invalid product ID");
  }

  return result.data;
}

// GET /api/products
export const listProducts: RequestHandler = async (_req, res, next) => {
  try {
    const result = await productService.getProducts();

    res.setHeader("X-Data-Source", result.source);

    res.status(200).json({
      success: true,
      source: result.source,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/products/activity
//
// Reads the feed the RabbitMQ consumer writes, so the dashboard can show
// which product events have flowed through Kafka and RabbitMQ.
export const getActivity: RequestHandler = async (_req, res, next) => {
  try {
    const feed = await productService.getProductActivity();

    res.status(200).json({
      success: true,
      data: feed,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/products/:id
export const getProduct: RequestHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params["id"]);
    const result = await productService.getProductById(id);

    res.setHeader("X-Data-Source", result.source);

    res.status(200).json({
      success: true,
      source: result.source,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/products
export const createProduct: RequestHandler = async (req, res, next) => {
  try {
    const input = createProductSchema.parse(req.body);
    const product = await productService.createProduct(input);

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/products/:id
export const updateProduct: RequestHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params["id"]);
    const input = updateProductSchema.parse(req.body);

    const product = await productService.updateProduct(id, input);

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/products/:id
export const deleteProduct: RequestHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params["id"]);

    await productService.deleteProduct(id);

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
