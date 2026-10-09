const express = require("express");
const {
  deleteUser,
  create,
  createPartner,
  getAll,
  getById,
  getUsersByPartner,
  update,
  getPartners,
  changePassword,
  accessRules,
  getAccountDetails,
  getDashboardDetails,
  updateUserRequest,
  register,
 registerWithShare,
 
  getByUsername,
  forgotPassword,
  resetPassword,
  createSubUser,
  getSubUser,
  getTransactionPassword,
  updatePartnership,
  getSingleUsersById,
  revertPartnershipUpdate,
  getDisabledUsers,
  updateUserCR, // Import new controller
  updateExpLimit,
  filterByUser,
  saveUserAccess,
  generatePin,
  getDirectChildBettingReport,
  getChildUserDetails,
  updatePartnerSeat,
  getPartnerSeat,
  getUserPartnershipValue,
  updateUserPartnershipValue,
  //getCainoData,
  // initialSetup,
  getUsersByPartnerWithUserLock,
  getUsersByPartnerWithUserLockShotx,
  getUserLockHistory,
  getDirectChildBettingReportShotx
  
} = require("./users.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const { requireDomain } = require("../../Middleware/domain.middleware");
const {
  transactionPassword,
} = require("../../Middleware/transaction.middleware");

const router = express.Router();
// router.route("/initial-setup").get(initialSetup);
router.route("/register").post(register);

router.route("/find-by-username/:username").get(getByUsername);
router.route("/forgot-password/:id").post(forgotPassword);
router.route("/user/direct-child-betting-report").get(getDirectChildBettingReport);
router.route("/user/direct-child-commission-report").get(
  getDirectChildBettingReportShotx
);

router.route("/child-user-details").get(getChildUserDetails);


router.route("/partner/update-seat").post(
  updatePartnerSeat
);
router
  .route("/partner/seat/:userId")
  .get(getPartnerSeat);


router
  .route("/partner/partnership-value/:userId")
  .get(getUserPartnershipValue);

router
  .route("/partner/update-partnership-value")
  .post(
    updateUserPartnershipValue
  );

router
  .route("/lock-history/:userId")
  .get(getUserLockHistory);

router.use([requireAuth]);

router.route("/register-with-share").post(registerWithShare);
router.route("/update/update-exp-limit").put(transactionPassword, updateExpLimit);
router.route("/create").post(transactionPassword, create);
router.route("/sub-user/create").post(transactionPassword, createSubUser);
router.route("/sub-user").get(getSubUser);
router.route("/update/:id").put(transactionPassword, updateUserRequest);
router.route("/partner/create").post(transactionPassword, createPartner);
router.route("/delete/:id").delete(deleteUser);
router.route("/all").get(getAll);
router.route("/").get(getById);
router.route("/transaction-pin").get(getTransactionPassword);

router.route("/update-cr/:id").put(transactionPassword, updateUserCR); // New route definition
router.route("/partner/update").put(transactionPassword, updatePartnership);
router.route("/partner/revert/:logId").post(transactionPassword, revertPartnershipUpdate);
router.route("/by-partner").get(getUsersByPartner);
router.route("/by-partnerWithUserLock").get(getUsersByPartnerWithUserLock);
router.route("/by-partnerWithUserLockshotx").get(getUsersByPartnerWithUserLockShotx);
router.route("/single-user/:id").get(getSingleUsersById);
router.route("/partner/:id").get(getPartners);
router.route("/change-password").post(changePassword);
router.route("/reset/password").put(transactionPassword, resetPassword);

router.route("/access-rules/:id").get(accessRules);
router.route("/account-load").get(getAccountDetails);
router.route("/dashboard").get(getDashboardDetails);
 console.log(" filterByUser route loaded");
router.route("/filter/filterByUser").post(filterByUser);
router.route("/access/saveUserAccess").post(saveUserAccess);
router.route("/pin/generatePin").get(generatePin);
//router.route("/casino/getCainoData").post(getCainoData);
router.route("/disabled-account").get(getDisabledUsers);
router.route("/:id").put(update);
module.exports = router;

