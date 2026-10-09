const express = require("express");
const {
  depositToUser,
  withdrawFromUser,
  getAccountStatement,
  adminDeposit,
  handleTransactions,
  paymentRequest,
  getWithdrawRequest,
  getDepositRequest,
  getWithdrawStatement,
  getDepositStatement,
  withdrawRequest,
  verifyWithdrawRequest,
  verifyDepositRequest,
  getDepositWithdrawReport,
  getUserHistory,
} = require("./transaction.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const {
  transactionPassword,
} = require("../../Middleware/transaction.middleware");

const router = express.Router();
router.use([requireAuth]);

router.route("/user/deposit").post(transactionPassword, depositToUser);
router.route("/admin/deposit").post(adminDeposit);
router.route("/user/withdraw").post(transactionPassword, withdrawFromUser);
router.route("/deposit-withdraw").post(transactionPassword, handleTransactions);
router.route("/user/statement/:userId").get(getAccountStatement);
router.route("/user/bank-deposit").post(paymentRequest);
router.route("/user/bank-withdraw").post(withdrawRequest);
router.route("/withdraw-request").get(getWithdrawRequest);
router.route("/deposit-request").get(getDepositRequest);
router.route("/withdraw/statement").get(getWithdrawStatement);
router.route("/deposit/statement").get(getDepositStatement);
router.route("/report").get(getDepositWithdrawReport);
router
  .route("/verify-withdraw-request")
  .post(transactionPassword, verifyWithdrawRequest);
router
  .route("/verify-deposit-request")
  .post(transactionPassword, verifyDepositRequest);

router.route("/admin/user-history/:userId").get(getUserHistory);

module.exports = router;
