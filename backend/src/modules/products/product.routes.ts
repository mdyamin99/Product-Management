import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import {
  listProducts,
  getActivity,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from "./product.controller.js";

const router = Router();

// Every product endpoint demands a verified access token: the dashboard
// only ever calls these with `Authorization: Bearer …` attached, so an
// anonymous request never reaches the service layer.
router.use(requireAuth);

// Registered before "/:id" so "activity" is not parsed as a product id.
router.get("/activity", getActivity);
router.get("/", listProducts);
router.get("/:id", getProduct);
router.post("/", createProduct);
router.patch("/:id", updateProduct);
router.delete("/:id", deleteProduct);

export default router;
