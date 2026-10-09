const express = require("express");
const {
  profitLoss,
  marketAnalysis,
  listPendingBets,
  clientProfitLoss,
  clientTrack,
  getClientHierarchy,
  bettingTurnover,
  betBettingListing,
  partnershipReport,
  getStreamSyncStatus,
  userTrack,
  clientProfitLossShotx,
  listCompletedBetsShotx
} = require("./report.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const router = express.Router();
router.route("/stream-sync-status").get(getStreamSyncStatus);
router.route("/role-wise-profit-loss").post(clientProfitLossShotx);

router.use(requireAuth);
router.post("/completed-bets", listCompletedBetsShotx);
router.route("/profit-loss").post(profitLoss);
router.route("/client-profit-loss").post(clientProfitLoss);
router.route("/market-analysis").get(marketAnalysis);
router.route("/betting").post(listPendingBets);
router.route("/client-track").get(clientTrack);
router.route("/get-user").get(userTrack);
router.route("/client-track/:clientId").get(getClientHierarchy);
router.route("/turnover").post(bettingTurnover);
router.route("/betting-listing").post(betBettingListing);
router.route("/partner-ship").get(partnershipReport);


module.exports = router;
