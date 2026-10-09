const express = require("express");
const {
  createOrUpdate,
  getMethods,
  getMethodById,
  removeMethod,
  getMethodByPartner,
} = require("./payment-method.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const {
  transactionPassword,
} = require("../../Middleware/transaction.middleware");
const uploadcryptoMiddleware = require("../../Middleware/uploadcrypto.middleware");

const router = express.Router();
router.use([requireAuth]);

router.route("/create").post( uploadcryptoMiddleware.fields([{ name: "image", maxCount: 1 }]),transactionPassword,createOrUpdate);
router.route("/update").put(uploadcryptoMiddleware.fields([{ name: "image", maxCount: 1 }]),transactionPassword, createOrUpdate);
router.route("/delete/:id").delete(removeMethod);
router.route("/get-by-partner").get(getMethodByPartner);
router.route("/:id").get(getMethodById);
router.route("/").get(getMethods);

module.exports = router;
