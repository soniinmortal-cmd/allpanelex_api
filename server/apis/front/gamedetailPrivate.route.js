const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getOrSetCache } = require("../../helpers/cache");
// const axios = require("axios");
// const https = require("https");

// const agent = new https.Agent({
//   rejectUnauthorized: false,
// });

const router = express.Router();

const gamedetailPrivate = async (req, res, next) => {
  try {
    const sortedBody = Object.keys(req.body).sort().reduce((acc, key) => {
      acc[key] = req.body[key];
      return acc;
    }, {});
    const {etid,gmid}=req.body;
    const queryString = new URLSearchParams(sortedBody).toString();
    const cacheKey = `gamedetailPrivateData:${queryString}`;

    const fetchDetailData = async () => {
      // const response = await apiRequest({
      //   url: `getDetailsData`,
      //   apiAction: "GET",
      //   data: { sid:etid,gmid:gmid, key: process.env.JSK_KEY },
      //   host: process.env.JSK_CASINO_SERVER_URL,
      //   noEncrypt: true,
      // });
      const response = await apiRequest({
        url: `gamedetailPrivate`,
        apiAction: "GET",
        data: {
            etid: etid,
            gmid: gmid,
            key: process.env.JSK_KEY,
        },
        host: process.env.JSK_SERVER_URL,
        noEncrypt: true,
      });
      // try {
      //   if (response?.data?.length > 0) {
      //     const { ename } = response.data[0];
      //     const etid = req?.body?.etid;
      //     const fluxCacheKey = `flux_event_id:${etid}:${ename}`;

      //     const oldgmid = await getOrSetCache(
      //       fluxCacheKey,
      //       async () => {
      //         try {
      //           const skyResponse = await axios({
      //             method: "get",
      //             url: `${process.env.JSK_FLUX_URL}/getEventId?id=${etid}&name=${ename}`,
      //             httpsAgent: agent,
      //           });
      //           if (skyResponse?.status === 200 && skyResponse?.data?.id) {
      //             return skyResponse.data.id;
      //           }
      //           return null;
      //         } catch (skyErr) {
      //           const status = skyErr.response?.status || 'Unknown';
      //           console.log(`[FluxAPI] Event ID not found for ${ename}: ${skyErr.message} (Status: ${status})`);
      //           return null;
      //         }
      //       },
      //       1800,
      //     );

      //     if (oldgmid) {
      //       response.data[0].oldgmid = oldgmid;
      //     } else {
      //       await delCache(fluxCacheKey);
      //     }
      //   }
      // } catch (err) {
      //   console.log("err in find old id ", err?.message);
      // }
      // Logic for finding old gmid was commented out in original file, so omitted here.

      return response?.data;
    };

    // Original TTL was 5 seconds
    const result = await fetchDetailData();

    res
      .status(httpStatus.OK)
      .send(new APIResponse(result, "Match fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

router.post("/", gamedetailPrivate);

module.exports = router;
