const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getCache, setCache } = require("../../helpers/cache");

const router = express.Router();

// const get_latest_events = async (req, res, next) => {
//   try {
//     const cacheKey = "get_latest_events";

//     let getLatestEventsData = await getCache(cacheKey);

//     if (!getLatestEventsData) {
//       const [resCricket, resFootball] = await Promise.all([
//         apiRequest({
//           url: "esid",
//           apiAction: "GET",
//           data: { sid: 4, key: process.env.JSK_KEY }, // Cricket
//           host: process.env.JSK_CASINO_SERVER_URL,
//           noEncrypt: true,
//         }),
//         apiRequest({
//           url: "esid",
//           apiAction: "GET",
//           data: { sid: 1, key: process.env.JSK_KEY }, // Football
//           host: process.env.JSK_CASINO_SERVER_URL,
//           noEncrypt: true,
//         }),
//       ]);

//       const cricketEvents = resCricket?.data?.t1 || [];
//       const footballEvents = resFootball?.data?.t1 || [];

//       const pickEvents = (events, limit) => {
//         const liveEvents = events.filter((event) => event.iplay === true);
//         const nonLiveEvents = events.filter((event) => event.iplay !== true);

//         return [...liveEvents, ...nonLiveEvents]
//           .slice(0, limit)
//           .map((event) => ({
//             ename: event.ename,
//             gmid: event.gmid,
//             etid: event.etid,
//           }));
//       };

//       getLatestEventsData = {
//         t1: [
//           ...pickEvents(cricketEvents, 2),
//           ...pickEvents(footballEvents, 3),
//         ],
//       };

//       await setCache(cacheKey, getLatestEventsData, 5000);
//     }

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(
//           getLatestEventsData,
//           "Match fetched",
//           httpStatus.OK
//         )
//       );
//   } catch (err) {
//     next(err);
//   }
// };

const get_latest_events = async (req, res, next) => {
  try {
    console.log("new called")
    const cacheKey = `get_latest_events`;
    let getLatestEventsData = await getCache(cacheKey);
    getLatestEventsData=null;
    if (!getLatestEventsData) {
      const res = await apiRequest({
        url: `get_latest_events`,
        apiAction: "GET",
        data: {key: process.env.JSK_KEY},
        host: process.env.JSK_SERVER_URL,
        noEncrypt: true,
      });
      getLatestEventsData = res?.data;
      await setCache(cacheKey, getLatestEventsData, 5000); // cache for 60s
    }
    

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(getLatestEventsData, "Match fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", get_latest_events);

module.exports = router;
