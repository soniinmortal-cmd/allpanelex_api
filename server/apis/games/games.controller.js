// const httpStatus = require("http-status");
// const APIError = require("../../helpers/APIError");
// const APIResponse = require("../../helpers/APIResponse");
// const Utils = require("../../helpers/utils");
// const {
//   Game,
//   getAllGame,
//   updateGame,
//   getGame,
//   getGameByCid,
//   getGameByGidAndType,
//   getGameByGmid,
//   getGameById,
// } = require("./games.helper");
// const {
//   delCache,
//   getCache,
//   setCache,
//   delCacheByPattern,
// } = require("../../helpers/cache");
// const moment = require("moment/moment");
// const { getDomainByDomain } = require("../domain/domain.helper");
// const {
//   getBlockMarketByUserId,
//   getBlockMarket,
// } = require("../block-market/block-market.helper");

// const create = async (req, res, next) => {
//   try {
//     const matchesData = Array.isArray(req.body) ? req.body : [req.body];
//     const results = [];

//     for (const data of matchesData) {
//       const query = {
//         gmid: data.gmid,
//         domain: data.domain,
//       };
//       if (data?.gtype) query.gtype = data.gtype;

//       let existingMatch = await getGame(query);

//       if (existingMatch) {
//         // Update isActive if:
//         // 1. The existing record is NOT a casino (prevents accidental deactivation from sports UI)
//         // 2. OR the request explicitly targets a casino (data.gtype === "casino")
//         if (existingMatch.gtype !== "casino" || data?.gtype === "casino") {
//           existingMatch.isActive =
//             data.isActive !== undefined ? data.isActive : existingMatch.isActive;
//         }

//         if (data?.gtype === "casino") {
//           existingMatch.gmid = data.gmid || existingMatch.gmid;
//           existingMatch.gname = data.gname || existingMatch.gname;
//           existingMatch.imgpath = data.imgpath || existingMatch.imgpath;
//         }
//         if (data?.bet_config) {
//           existingMatch.bet_config = {
//             ...(existingMatch.bet_config.toObject?.() ||
//               existingMatch.bet_config),
//             ...data?.bet_config,
//           };
//         }
//         if (data?.bet_limit) {
//           existingMatch.bet_limit = {
//             ...(existingMatch.bet_limit.toObject?.() ||
//               existingMatch.bet_limit),
//             ...data?.bet_limit,
//           };
//         }
//         await existingMatch.save();

//         results.push({
//           match: existingMatch.toObject(),
//           message: `Game updated (isActive: ${existingMatch.isActive})`,
//         });
//       } else {
//         if (data?.gtype !== "casino") {
//           const payload = {
//             etid: data.etid,
//             gmid: data.gmid,
//             vir: true,
//           };
//           const res = await Utils.apiRequest({
//             url: `front/gamedataPrivate?etId=${data.etid}&gameId=${data.gmid}`,
//             data: payload,
//           });
//           let section = null;
//           if (res?.data?.length > 0) {
//             section = res?.data
//               ?.find(
//                 (item) => item?.gtype === "match1" || item?.gtype === "match"
//               )
//               ?.section?.map((item) => ({
//                 teamName: item?.nat,
//                 sid: item?.sid,
//               }));
//             data.section = section;
//           }
//         }
//         const domainConfig = await getDomainByDomain(data?.domain);
//         const match = new Game({
//           ...data,
//           bet_limit: domainConfig?.bet_limit,
//         });
//         await match.save();

//         results.push({
//           match: match.toObject(),
//           message: "Game created",
//         });
//       }

//       const target = existingMatch || results[results.length - 1].match;
//       await delCache("matches:all");
//       await delCache(`matches:cid:${target.cid}`);
//       await delCache(`matches:gid:${target.gid}:type:${target.type}`);
//       if (target?.gtype === "casino") {
//         await delCache(`tablelist:${target.gid}-${data?.domain}`);
//       }
//     }

//     const gameData = matchesData?.[0];
//     if (gameData?.domain && gameData?.etid) {
//       const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}`;
//       await delCache(cacheKey);
//     }

//     if (gameData?.domain && gameData?.gid) {
//       const cacheKey = `tablelist:${gameData?.gid}-${gameData?.domain}-*`;
//       await delCacheByPattern(cacheKey);
//     } else if (gameData?.domain && gameData?.etid) {
//       const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}-*`;
//       await delCacheByPattern(cacheKey);
//     }
//     return res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(results, "Bulk create/update complete", httpStatus.OK)
//       );
//   } catch (e) {
//     next(new APIError(e.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const deleteGame = async (req, res, next) => {
//   try {
//     const id = req.params.gmid;
//     const result = await updateGame({ _id: id }, { $set: { isActive: false } });

//     if (result) {
//       await delCache("matches:all");
//       await delCache(`matches:cid:${result.cid}`);
//       await delCache(`matches:gid:${result.gid}:type:${result.type}`);
//       await delCache(`match:${id}`);

//       return res
//         .status(httpStatus.OK)
//         .send(
//           new APIResponse(
//             { ...result.toObject(), isActive: false },
//             Utils.messages.SUCCESS_DELETE,
//             httpStatus.OK
//           )
//         );
//     }

//     return next(new APIError("Please check game id", httpStatus.NOT_FOUND));
//   } catch (error) {
//     next(new APIError(error.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const getAll = async (req, res, next) => {
//   try {
//     const {
//       etid,
//       domain,
//       search,
//       date,
//       startDate,
//       endDate,
//       gid,
//       type,
//       parent,
//     } = req.query;
//     const filter = {};
//     if (etid) filter.etid = etid;
//     if (domain) filter.domain = domain;
//     if (gid) filter.gid = Number(gid);
//     if (type) filter.gtype = type;

//     if (search) {
//       filter.$or = [
//         { gname: { $regex: search, $options: "i" } },
//         { ename: { $regex: search, $options: "i" } },
//         {
//           $expr: {
//             $regexMatch: {
//               input: { $toString: "$gmid" },
//               regex: search,
//               options: "i",
//             },
//           },
//         },
//       ];
//     }

//     let matches = await getAllGame(filter);

//     if (date || (startDate && endDate)) {
//       const start = startDate
//         ? moment(startDate, "YYYY-MM-DD").startOf("day")
//         : moment(date, "YYYY-MM-DD").startOf("day");
//       const end = endDate
//         ? moment(endDate, "YYYY-MM-DD").endOf("day")
//         : moment(date, "YYYY-MM-DD").endOf("day");

//       matches = matches.filter((match) => {
//         if (!match.stime) return false;
//         const matchDate = moment(match.stime, "M/D/YYYY h:mm:ss A");
//         return matchDate.isBetween(start, end, null, "[]");
//       });
//     }

//     if (parent) {
//       const blockMarket = await getBlockMarketByUserId(parent, domain);
//       matches = matches.filter((match) => {
//         return !blockMarket?.map((game) => game?.gmid)?.includes(match?.gmid);
//       });
//     }
//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(matches, "Game fetched", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const getGamesBygmid = async (req, res, next) => {
//   try {
//     const gmid = req.params.gmid;
//     const domain = req.domainConfig.domain;
//     // const cacheKey = `matches:etid:${etid}`;

//     // let matches = await getCache(cacheKey);
//     // if (!matches) {
//     const matches = await getGameByGmid(gmid, domain);
//     // await setCache(cacheKey, matches, 60);
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(matches, "Game under this etid", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };
// const getGamesBycid = async (req, res, next) => {
//   try {
//     const fields = req?.query?.fields?.split(",");
//     const etid = req.params.etid;
//     const domain = req.params.domain;
//     // const cacheKey = `matches:etid:${etid}`;

//     // let matches = await getCache(cacheKey);
//     // if (!matches) {
//     const matches = await getGameByCid(etid, domain, fields);
//     // await setCache(cacheKey, matches, 60);
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(matches, "Game under this etid", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const getGamesBygid = async (req, res, next) => {
//   try {
//     const gid = req.params.gid;
//     const type = req.params.type;
//     const domain = req.params.domain;
//     // const cacheKey = `matches:gid:${gid}:type:${type}`;
//     // let matches = await getCache(cacheKey);

//     // if (!matches) {
//     const matches = await getGameByGidAndType(gid, type, domain);
//     // await setCache(cacheKey, matches, 60);
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(matches, "Game under this gid/type", httpStatus.OK)
//       );
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };
// const updateCasino = async (req, res, next) => {
//   try {
//     const id = req.params.id;
//     const body = req.body;
//     const casino = await getGameById(id);
//     if (req.files?.imgUrl) {
//       if (casino?.imgUrl) {
//         Utils.deleteFile(casino.imgUrl);
//       }
//       body.imgUrl = `/uploads/${body.domain}/${req.files.imgUrl[0].filename}`;
//     } else if (body.imgUrl && typeof body.imgUrl !== "string") {
//       body.imgUrl = null;
//     }

//     const update = await updateGame({ _id: id }, { $set: body });
//     await delCache(`tablelist:${casino.gid}-${casino?.domain}`);
//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(update, "updated", httpStatus.OK));
//   } catch (err) {
//     next(err);
//   }
// };

// const checkGame = async (req, res, next) => {
//   try {
//     const { etid, gmid } = req.body;
//     const filter = { isActive: true };
//     const domain = req?.domainConfig?.domain;
//     if (etid) filter.etid = etid;
//     if (domain) filter.domain = domain;
//     if (gmid) filter.gmid = gmid;
//     if (etid && gmid) filter.gmid = Number(gmid);
//     let match = await getGame(filter);
//     if (!match) {
//       return res
//         .status(httpStatus.NOT_FOUND)
//         .send(
//           new APIResponse(
//             { isActive: false },
//             "Game not found",
//             httpStatus.NOT_FOUND
//           )
//         );
//     }

//     // const userId = req?.user?._id;
//     // let blockMarket = await getBlockMarket({
//     //   gmid: filter.gmid,
//     //   domain: filter.domain,
//     //   userId: userId,
//     //   isActive: true,
//     // });
//     // if (blockMarket) {
//     //   return res
//     //     .status(httpStatus.NOT_FOUND)
//     //     .send(
//     //       new APIResponse(
//     //         { isActive: false },
//     //         "Game not found",
//     //         httpStatus.NOT_FOUND
//     //       )
//     //     );
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(match, "Game fetched", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };
// module.exports = {
//   deleteGame,
//   create,
//   getAll,
//   getGamesBygmid,
//   getGamesBycid,
//   getGamesBygid,
//   updateCasino,
//   checkGame,
// };

const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const Utils = require("../../helpers/utils");
const mongoose = require("mongoose");

const {
  Game,
  getAllGame,
  getAllGameLean,
  updateGame,
  getGame,
  getGameByCid,
  getGameByGidAndType,
  getGameByGmid,
  getGameById,
} = require("./games.helper");
const {
  delCache,
  getCache,
  setCache,
  delCacheByPattern,
} = require("../../helpers/cache");
const moment = require("moment/moment");
const { getDomainByDomain } = require("../domain/domain.helper");

const DomainModal = require("../domain/domain.model");

const {
  getBlockMarketByUserId,
  getBlockMarket,
} = require("../block-market/block-market.helper");


const create = async (req, res, next) => {
  try {
    let matchesData = Array.isArray(req.body) ? req.body : [req.body];

    // ============================================================
    // NEW LOGIC ONLY:
    // If domain = "all", apply same request to all domains.
    // For single domain, OLD LOGIC remains exactly the same.
    // ============================================================
    const expandedMatchesData = [];

    for (const data of matchesData) {
      if (data?.domain === "all") {
        const allDomains = await mongoose.connection.db
          .collection("domains")
          .find({})
          .toArray();

        for (const domainData of allDomains) {
          if (domainData?.domain) {
            expandedMatchesData.push({
              ...data,
              domain: domainData.domain,
            });
          }
        }
      } else {
        // OLD LOGIC - unchanged
        expandedMatchesData.push(data);
      }
    }

    matchesData = expandedMatchesData;

    const results = [];

    for (const data of matchesData) {
      const query = {
        gmid: data.gmid,
        domain: data.domain,
      };

      if (data?.gtype) query.gtype = data.gtype;

      let existingMatch = await getGame(query);

      if (existingMatch) {
        // Update isActive if:
        // 1. The existing record is NOT a casino (prevents accidental deactivation from sports UI)
        // 2. OR the request explicitly targets a casino (data.gtype === "casino")
        if (existingMatch.gtype !== "casino" || data?.gtype === "casino") {
          existingMatch.isActive =
            data.isActive !== undefined
              ? data.isActive
              : existingMatch.isActive;
        }

        if (data?.gtype === "casino") {
          existingMatch.gmid = data.gmid || existingMatch.gmid;
          existingMatch.gname = data.gname || existingMatch.gname;
          existingMatch.imgpath = data.imgpath || existingMatch.imgpath;
        }

        if (data?.bet_config) {
          existingMatch.bet_config = {
            ...(existingMatch.bet_config.toObject?.() ||
              existingMatch.bet_config),
            ...data?.bet_config,
          };
        }

        if (data?.bet_limit) {
          existingMatch.bet_limit = {
            ...(existingMatch.bet_limit.toObject?.() ||
              existingMatch.bet_limit),
            ...data?.bet_limit,
          };
        }

        await existingMatch.save();

        results.push({
          match: existingMatch.toObject(),
          message: `Game updated (isActive: ${existingMatch.isActive})`,
        });
      } else {
        if (data?.gtype !== "casino") {
          const payload = {
            etid: data.etid,
            gmid: data.gmid,
            vir: true,
          };

          const res = await Utils.apiRequest({
            url: `gamedataPrivate`,
            apiAction: "GET",
            data: {
              etid: data.etid,
              gmid: data.gmid,
              key: process.env.JSK_KEY,
            },
            host: process.env.JSK_SERVER_URL,
            noEncrypt: true,
          });

          let section = null;

          if (res?.data?.data?.length > 0) {
            section = res?.data?.data
              ?.find(
                (item) =>
                  item?.gtype === "match1" || item?.gtype === "match"
              )
              ?.section?.map((item) => ({
                teamName: item?.nat,
                sid: item?.sid,
              }));

            data.section = section;// const httpStatus = require("http-status");
// const APIError = require("../../helpers/APIError");
// const APIResponse = require("../../helpers/APIResponse");
// const Utils = require("../../helpers/utils");
// const {
//   Game,
//   getAllGame,
//   updateGame,
//   getGame,
//   getGameByCid,
//   getGameByGidAndType,
//   getGameByGmid,
//   getGameById,
// } = require("./games.helper");
// const {
//   delCache,
//   getCache,
//   setCache,
//   delCacheByPattern,
// } = require("../../helpers/cache");
// const moment = require("moment/moment");
// const { getDomainByDomain } = require("../domain/domain.helper");
// const {
//   getBlockMarketByUserId,
//   getBlockMarket,
// } = require("../block-market/block-market.helper");

// const create = async (req, res, next) => {
//   try {
//     const matchesData = Array.isArray(req.body) ? req.body : [req.body];
//     const results = [];

//     for (const data of matchesData) {
//       const query = {
//         gmid: data.gmid,
//         domain: data.domain,
//       };
//       if (data?.gtype) query.gtype = data.gtype;

//       let existingMatch = await getGame(query);

//       if (existingMatch) {
//         // Update isActive if:
//         // 1. The existing record is NOT a casino (prevents accidental deactivation from sports UI)
//         // 2. OR the request explicitly targets a casino (data.gtype === "casino")
//         if (existingMatch.gtype !== "casino" || data?.gtype === "casino") {
//           existingMatch.isActive =
//             data.isActive !== undefined ? data.isActive : existingMatch.isActive;
//         }

//         if (data?.gtype === "casino") {
//           existingMatch.gmid = data.gmid || existingMatch.gmid;
//           existingMatch.gname = data.gname || existingMatch.gname;
//           existingMatch.imgpath = data.imgpath || existingMatch.imgpath;
//         }
//         if (data?.bet_config) {
//           existingMatch.bet_config = {
//             ...(existingMatch.bet_config.toObject?.() ||
//               existingMatch.bet_config),
//             ...data?.bet_config,
//           };
//         }
//         if (data?.bet_limit) {
//           existingMatch.bet_limit = {
//             ...(existingMatch.bet_limit.toObject?.() ||
//               existingMatch.bet_limit),
//             ...data?.bet_limit,
//           };
//         }
//         await existingMatch.save();

//         results.push({
//           match: existingMatch.toObject(),
//           message: `Game updated (isActive: ${existingMatch.isActive})`,
//         });
//       } else {
//         if (data?.gtype !== "casino") {
//           const payload = {
//             etid: data.etid,
//             gmid: data.gmid,
//             vir: true,
//           };
//           const res = await Utils.apiRequest({
//             url: `front/gamedataPrivate?etId=${data.etid}&gameId=${data.gmid}`,
//             data: payload,
//           });
//           let section = null;
//           if (res?.data?.length > 0) {
//             section = res?.data
//               ?.find(
//                 (item) => item?.gtype === "match1" || item?.gtype === "match"
//               )
//               ?.section?.map((item) => ({
//                 teamName: item?.nat,
//                 sid: item?.sid,
//               }));
//             data.section = section;
//           }
//         }
//         const domainConfig = await getDomainByDomain(data?.domain);
//         const match = new Game({
//           ...data,
//           bet_limit: domainConfig?.bet_limit,
//         });
//         await match.save();

//         results.push({
//           match: match.toObject(),
//           message: "Game created",
//         });
//       }

//       const target = existingMatch || results[results.length - 1].match;
//       await delCache("matches:all");
//       await delCache(`matches:cid:${target.cid}`);
//       await delCache(`matches:gid:${target.gid}:type:${target.type}`);
//       if (target?.gtype === "casino") {
//         await delCache(`tablelist:${target.gid}-${data?.domain}`);
//       }
//     }

//     const gameData = matchesData?.[0];
//     if (gameData?.domain && gameData?.etid) {
//       const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}`;
//       await delCache(cacheKey);
//     }

//     if (gameData?.domain && gameData?.gid) {
//       const cacheKey = `tablelist:${gameData?.gid}-${gameData?.domain}-*`;
//       await delCacheByPattern(cacheKey);
//     } else if (gameData?.domain && gameData?.etid) {
//       const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}-*`;
//       await delCacheByPattern(cacheKey);
//     }
//     return res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(results, "Bulk create/update complete", httpStatus.OK)
//       );
//   } catch (e) {
//     next(new APIError(e.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const deleteGame = async (req, res, next) => {
//   try {
//     const id = req.params.gmid;
//     const result = await updateGame({ _id: id }, { $set: { isActive: false } });

//     if (result) {
//       await delCache("matches:all");
//       await delCache(`matches:cid:${result.cid}`);
//       await delCache(`matches:gid:${result.gid}:type:${result.type}`);
//       await delCache(`match:${id}`);

//       return res
//         .status(httpStatus.OK)
//         .send(
//           new APIResponse(
//             { ...result.toObject(), isActive: false },
//             Utils.messages.SUCCESS_DELETE,
//             httpStatus.OK
//           )
//         );
//     }

//     return next(new APIError("Please check game id", httpStatus.NOT_FOUND));
//   } catch (error) {
//     next(new APIError(error.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const getAll = async (req, res, next) => {
//   try {
//     const {
//       etid,
//       domain,
//       search,
//       date,
//       startDate,
//       endDate,
//       gid,
//       type,
//       parent,
//     } = req.query;
//     const filter = {};
//     if (etid) filter.etid = etid;
//     if (domain) filter.domain = domain;
//     if (gid) filter.gid = Number(gid);
//     if (type) filter.gtype = type;

//     if (search) {
//       filter.$or = [
//         { gname: { $regex: search, $options: "i" } },
//         { ename: { $regex: search, $options: "i" } },
//         {
//           $expr: {
//             $regexMatch: {
//               input: { $toString: "$gmid" },
//               regex: search,
//               options: "i",
//             },
//           },
//         },
//       ];
//     }

//     let matches = await getAllGame(filter);

//     if (date || (startDate && endDate)) {
//       const start = startDate
//         ? moment(startDate, "YYYY-MM-DD").startOf("day")
//         : moment(date, "YYYY-MM-DD").startOf("day");
//       const end = endDate
//         ? moment(endDate, "YYYY-MM-DD").endOf("day")
//         : moment(date, "YYYY-MM-DD").endOf("day");

//       matches = matches.filter((match) => {
//         if (!match.stime) return false;
//         const matchDate = moment(match.stime, "M/D/YYYY h:mm:ss A");
//         return matchDate.isBetween(start, end, null, "[]");
//       });
//     }

//     if (parent) {
//       const blockMarket = await getBlockMarketByUserId(parent, domain);
//       matches = matches.filter((match) => {
//         return !blockMarket?.map((game) => game?.gmid)?.includes(match?.gmid);
//       });
//     }
//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(matches, "Game fetched", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const getGamesBygmid = async (req, res, next) => {
//   try {
//     const gmid = req.params.gmid;
//     const domain = req.domainConfig.domain;
//     // const cacheKey = `matches:etid:${etid}`;

//     // let matches = await getCache(cacheKey);
//     // if (!matches) {
//     const matches = await getGameByGmid(gmid, domain);
//     // await setCache(cacheKey, matches, 60);
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(matches, "Game under this etid", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };
// const getGamesBycid = async (req, res, next) => {
//   try {
//     const fields = req?.query?.fields?.split(",");
//     const etid = req.params.etid;
//     const domain = req.params.domain;
//     // const cacheKey = `matches:etid:${etid}`;

//     // let matches = await getCache(cacheKey);
//     // if (!matches) {
//     const matches = await getGameByCid(etid, domain, fields);
//     // await setCache(cacheKey, matches, 60);
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(matches, "Game under this etid", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

// const getGamesBygid = async (req, res, next) => {
//   try {
//     const gid = req.params.gid;
//     const type = req.params.type;
//     const domain = req.params.domain;
//     // const cacheKey = `matches:gid:${gid}:type:${type}`;
//     // let matches = await getCache(cacheKey);

//     // if (!matches) {
//     const matches = await getGameByGidAndType(gid, type, domain);
//     // await setCache(cacheKey, matches, 60);
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(matches, "Game under this gid/type", httpStatus.OK)
//       );
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };
// const updateCasino = async (req, res, next) => {
//   try {
//     const id = req.params.id;
//     const body = req.body;
//     const casino = await getGameById(id);
//     if (req.files?.imgUrl) {
//       if (casino?.imgUrl) {
//         Utils.deleteFile(casino.imgUrl);
//       }
//       body.imgUrl = `/uploads/${body.domain}/${req.files.imgUrl[0].filename}`;
//     } else if (body.imgUrl && typeof body.imgUrl !== "string") {
//       body.imgUrl = null;
//     }

//     const update = await updateGame({ _id: id }, { $set: body });
//     await delCache(`tablelist:${casino.gid}-${casino?.domain}`);
//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(update, "updated", httpStatus.OK));
//   } catch (err) {
//     next(err);
//   }
// };

// const checkGame = async (req, res, next) => {
//   try {
//     const { etid, gmid } = req.body;
//     const filter = { isActive: true };
//     const domain = req?.domainConfig?.domain;
//     if (etid) filter.etid = etid;
//     if (domain) filter.domain = domain;
//     if (gmid) filter.gmid = gmid;
//     if (etid && gmid) filter.gmid = Number(gmid);
//     let match = await getGame(filter);
//     if (!match) {
//       return res
//         .status(httpStatus.NOT_FOUND)
//         .send(
//           new APIResponse(
//             { isActive: false },
//             "Game not found",
//             httpStatus.NOT_FOUND
//           )
//         );
//     }

//     // const userId = req?.user?._id;
//     // let blockMarket = await getBlockMarket({
//     //   gmid: filter.gmid,
//     //   domain: filter.domain,
//     //   userId: userId,
//     //   isActive: true,
//     // });
//     // if (blockMarket) {
//     //   return res
//     //     .status(httpStatus.NOT_FOUND)
//     //     .send(
//     //       new APIResponse(
//     //         { isActive: false },
//     //         "Game not found",
//     //         httpStatus.NOT_FOUND
//     //       )
//     //     );
//     // }

//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(match, "Game fetched", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };
// module.exports = {
//   deleteGame,
//   create,
//   getAll,
//   getGamesBygmid,
//   getGamesBycid,
//   getGamesBygid,
//   updateCasino,
//   checkGame,
// };

const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const Utils = require("../../helpers/utils");
const mongoose = require("mongoose");

const {
  Game,
  getAllGame,
  updateGame,
  getGame,
  getGameByCid,
  getGameByGidAndType,
  getGameByGmid,
  getGameById,
} = require("./games.helper");
const {
  delCache,
  getCache,
  setCache,
  delCacheByPattern,
} = require("../../helpers/cache");
const moment = require("moment/moment");
const { getDomainByDomain } = require("../domain/domain.helper");

const DomainModal = require("../domain/domain.model");

const {
  getBlockMarketByUserId,
  getBlockMarket,
} = require("../block-market/block-market.helper");

// const create = async (req, res, next) => {
//   try {
//     const matchesData = Array.isArray(req.body) ? req.body : [req.body];
//     const results = [];

//     for (const data of matchesData) {
//       const query = {
//         gmid: data.gmid,
//         domain: data.domain,
//       };
//       if (data?.gtype) query.gtype = data.gtype;

//       let existingMatch = await getGame(query);



//       if (existingMatch) {
//         // Update isActive if:
//         // 1. The existing record is NOT a casino (prevents accidental deactivation from sports UI)
//         // 2. OR the request explicitly targets a casino (data.gtype === "casino")
//         if (existingMatch.gtype !== "casino" || data?.gtype === "casino") {
//           existingMatch.isActive =
//             data.isActive !== undefined ? data.isActive : existingMatch.isActive;
//         }

//         if (data?.gtype === "casino") {
//           existingMatch.gmid = data.gmid || existingMatch.gmid;
//           existingMatch.gname = data.gname || existingMatch.gname;
//           existingMatch.imgpath = data.imgpath || existingMatch.imgpath;
//         }
//         if (data?.bet_config) {
//           existingMatch.bet_config = {
//             ...(existingMatch.bet_config.toObject?.() ||
//               existingMatch.bet_config),
//             ...data?.bet_config,
//           };
//         }
//         if (data?.bet_limit) {
//           existingMatch.bet_limit = {
//             ...(existingMatch.bet_limit.toObject?.() ||
//               existingMatch.bet_limit),
//             ...data?.bet_limit,
//           };
//         }
//         await existingMatch.save();

//         results.push({
//           match: existingMatch.toObject(),
//           message: `Game updated (isActive: ${existingMatch.isActive})`,
//         });
//       } else {
//         if (data?.gtype !== "casino") {
//           const payload = {
//             etid: data.etid,
//             gmid: data.gmid,
//             vir: true,
//           };
//           const res = await Utils.apiRequest({
//         url: `gamedataPrivate`,
//         apiAction: "GET",
//         data: {
//           etid: data.etid,
//           gmid: data.gmid,
//           key: process.env.JSK_KEY,
//         },
//         host: process.env.JSK_SERVER_URL,
//         noEncrypt: true,
//       });
//           let section = null;
//           if (res?.data?.data?.length > 0) {
//             section = res?.data?.data
//               ?.find(
//                 (item) => item?.gtype === "match1" || item?.gtype === "match"
//               )
//               ?.section?.map((item) => ({
//                 teamName: item?.nat,
//                 sid: item?.sid,
//               }));
//             data.section = section;
//           }
//         }
//         const domainConfig = await getDomainByDomain(data?.domain);
//         const match = new Game({
//           ...data,
//           bet_limit: domainConfig?.bet_limit,
//         });
//         console.log("SAVING GAME:", {
//           gmid: match.gmid,
//           domain: match.domain,
//           etid: match.etid,
//         });
//         await match.save();

//         results.push({
//           match: match.toObject(),
//           message: "Game created",
//         });
//       }

//       const target = existingMatch || results[results.length - 1].match;
//       await delCache("matches:all");
//       await delCache(`matches:cid:${target.cid}`);
//       await delCache(`matches:gid:${target.gid}:type:${target.type}`);
//       if (target?.gtype === "casino") {
//         await delCache(`tablelist:${target.gid}-${data?.domain}`);
//       }
//     }

//     const gameData = matchesData?.[0];
//     if (gameData?.domain && gameData?.etid) {
//       const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}`;
//       await delCache(cacheKey);
//     }

//     if (gameData?.domain && gameData?.gid) {
//       const cacheKey = `tablelist:${gameData?.gid}-${gameData?.domain}-*`;
//       await delCacheByPattern(cacheKey);
//     } else if (gameData?.domain && gameData?.etid) {
//       const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}-*`;
//       await delCacheByPattern(cacheKey);
//     }
//     return res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(results, "Bulk create/update complete", httpStatus.OK)
//       );
//   } catch (e) {
//     next(new APIError(e.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

//below with all
const create = async (req, res, next) => {
  try {
    let matchesData = Array.isArray(req.body) ? req.body : [req.body];

    // ============================================================
    // NEW LOGIC ONLY:
    // If domain = "all", apply same request to all domains.
    // For single domain, OLD LOGIC remains exactly the same.
    // ============================================================
    const expandedMatchesData = [];

    for (const data of matchesData) {
      if (data?.domain === "all") {
        const allDomains = await mongoose.connection.db
          .collection("domains")
          .find({})
          .toArray();

        for (const domainData of allDomains) {
          if (domainData?.domain) {
            expandedMatchesData.push({
              ...data,
              domain: domainData.domain,
            });
          }
        }
      } else {
        // OLD LOGIC - unchanged
        expandedMatchesData.push(data);
      }
    }

    matchesData = expandedMatchesData;

    const results = [];

    for (const data of matchesData) {
      const query = {
        gmid: data.gmid,
        domain: data.domain,
      };

      if (data?.gtype) query.gtype = data.gtype;

      let existingMatch = await getGame(query);

      if (existingMatch) {
        // Update isActive if:
        // 1. The existing record is NOT a casino (prevents accidental deactivation from sports UI)
        // 2. OR the request explicitly targets a casino (data.gtype === "casino")
        if (existingMatch.gtype !== "casino" || data?.gtype === "casino") {
          existingMatch.isActive =
            data.isActive !== undefined
              ? data.isActive
              : existingMatch.isActive;
        }

        if (data?.gtype === "casino") {
          existingMatch.gmid = data.gmid || existingMatch.gmid;
          existingMatch.gname = data.gname || existingMatch.gname;
          existingMatch.imgpath = data.imgpath || existingMatch.imgpath;
        }

        if (data?.bet_config) {
          existingMatch.bet_config = {
            ...(existingMatch.bet_config.toObject?.() ||
              existingMatch.bet_config),
            ...data?.bet_config,
          };
        }

        if (data?.bet_limit) {
          existingMatch.bet_limit = {
            ...(existingMatch.bet_limit.toObject?.() ||
              existingMatch.bet_limit),
            ...data?.bet_limit,
          };
        }

        await existingMatch.save();

        results.push({
          match: existingMatch.toObject(),
          message: `Game updated (isActive: ${existingMatch.isActive})`,
        });
      } else {
        if (data?.gtype !== "casino") {
          const payload = {
            etid: data.etid,
            gmid: data.gmid,
            vir: true,
          };

          const res = await Utils.apiRequest({
            url: `gamedataPrivate`,
            apiAction: "GET",
            data: {
              etid: data.etid,
              gmid: data.gmid,
              key: process.env.JSK_KEY,
            },
            host: process.env.JSK_SERVER_URL,
            noEncrypt: true,
          });

          let section = null;

          if (res?.data?.data?.length > 0) {
            section = res?.data?.data
              ?.find(
                (item) =>
                  item?.gtype === "match1" || item?.gtype === "match"
              )
              ?.section?.map((item) => ({
                teamName: item?.nat,
                sid: item?.sid,
              }));

            data.section = section;
          }
        }

        const domainConfig = await getDomainByDomain(data?.domain);

        const match = new Game({
          ...data,
          bet_limit: domainConfig?.bet_limit,
        });

        console.log("SAVING GAME:", {
          gmid: match.gmid,
          domain: match.domain,
          etid: match.etid,
        });

        await match.save();

        results.push({
          match: match.toObject(),
          message: "Game created",
        });
      }

      const target =
        existingMatch || results[results.length - 1].match;

      await delCache("matches:all");
      await delCache(`matches:cid:${target.cid}`);
      await delCache(`matches:gid:${target.gid}:type:${target.type}`);

      if (target?.gtype === "casino") {
        await delCache(`tablelist:${target.gid}-${data?.domain}`);
      }

      // Delete highlight cache for this domain + etid
      if (data?.domain && data?.etid) {
        const cacheKey =
          `highlighthomePrivate:${data.domain}-${data.etid}`;

        console.log("Deleting highlight cache:", cacheKey);

        await delCache(cacheKey);
      }
    }

    const gameData = matchesData?.[0];

    if (gameData?.domain && gameData?.etid) {
      const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}`;
      console.log(cacheKey);
      await delCache(cacheKey);
    }

    if (gameData?.domain && gameData?.gid) {
      const cacheKey = `tablelist:${gameData?.gid}-${gameData?.domain}-*`;
      await delCacheByPattern(cacheKey);
    } else if (gameData?.domain && gameData?.etid) {
      const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}-*`;
      await delCacheByPattern(cacheKey);
      const cacheKey2 = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}`;
      await delCache(cacheKey2);
    }

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          results,
          "Bulk create/update complete",
          httpStatus.OK
        )
      );
  } catch (e) {
    console.log(e,"++++++=Create Game Active Error+++++");
    next(
      new APIError(
        e.message,
        httpStatus.INTERNAL_SERVER_ERROR
      )
    );
  }
};

const deleteGame = async (req, res, next) => {
  try {
    const id = req.params.gmid;
    const result = await updateGame({ _id: id }, { $set: { isActive: false } });

    if (result) {
      await delCache("matches:all");
      await delCache(`matches:cid:${result.cid}`);
      await delCache(`matches:gid:${result.gid}:type:${result.type}`);
      await delCache(`match:${id}`);

      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { ...result.toObject(), isActive: false },
            Utils.messages.SUCCESS_DELETE,
            httpStatus.OK
          )
        );
    }

    return next(new APIError("Please check game id", httpStatus.NOT_FOUND));
  } catch (error) {
    next(new APIError(error.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};

const getAll = async (req, res, next) => {



  try {
    const {
      etid,
      domain,
      search,
      date,
      startDate,
      endDate,
      gid,
      type,
      parent,
    } = req.query;
    const filter = {};
    if (etid) filter.etid = etid;
    if (domain) filter.domain = domain;
    if (gid) filter.gid = Number(gid);
    if (type) filter.gtype = type;

    if (search) {
      filter.$or = [
        { gname: { $regex: search, $options: "i" } },
        { ename: { $regex: search, $options: "i" } },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$gmid" },
              regex: search,
              options: "i",
            },
          },
        },
      ];
    }

    let matches = await getAllGame(filter);

    if (date || (startDate && endDate)) {
      const start = startDate
        ? moment(startDate, "YYYY-MM-DD").startOf("day")
        : moment(date, "YYYY-MM-DD").startOf("day");
      const end = endDate
        ? moment(endDate, "YYYY-MM-DD").endOf("day")
        : moment(date, "YYYY-MM-DD").endOf("day");

      matches = matches.filter((match) => {
        if (!match.stime) return false;
        const matchDate = moment(match.stime, "M/D/YYYY h:mm:ss A");
        return matchDate.isBetween(start, end, null, "[]");
      });
    }

    if (parent) {
      const blockMarket = await getBlockMarketByUserId(parent, domain);
      matches = matches.filter((match) => {
        return !blockMarket?.map((game) => game?.gmid)?.includes(match?.gmid);
      });
    }
    const domainConfig = await getDomainByDomain(domain);
    const autoEnable = domainConfig?.autoEnable ?? false;
    
    console.log("+++++++ GET ALL AUTO ENABLE:", {
      domain,
      autoEnable,
    });
    res
      .status(httpStatus.OK)
      .send(new APIResponse(matches, autoEnable, "Game fetched", httpStatus.OK));
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};

const getGamesBygmid = async (req, res, next) => {
  try {
    const gmid = req.params.gmid;
    const domain = req.domainConfig.domain;
    // const cacheKey = `matches:etid:${etid}`;

    // let matches = await getCache(cacheKey);
    // if (!matches) {
    const matches = await getGameByGmid(gmid, domain);
    // await setCache(cacheKey, matches, 60);
    // }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(matches, "Game under this etid", httpStatus.OK));
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};
const getGamesBycid = async (req, res, next) => {
   //console.log("+++++autoEnable+++++");
  try {
    const fields = req?.query?.fields?.split(",");
    const etid = req.params.etid;
    const domain = req.params.domain;
    // const cacheKey = `matches:etid:${etid}`;

    // let matches = await getCache(cacheKey);
    // if (!matches) {
    const matches = await getGameByCid(etid, domain, fields);
    // await setCache(cacheKey, matches, 60);
    // }
        const domainConfig = await getDomainByDomain(domain);
        const autoEnable = domainConfig?.autoEnable ?? false;

    //     console.log(autoEnable,"+++++KEYYYautoEnable+++");
    // res
    //   .status(httpStatus.OK)
    //   .send(new APIResponse(matches,autoEnable, "Game under this etid", httpStatus.OK));
    console.log(autoEnable, "+++++KEYYYautoEnable+++");

    const response = new APIResponse(
      matches,
      autoEnable,
      "Game under this etid",
      httpStatus.OK
    );


    response.autoEnable = autoEnable;

    // console.log("+++++ FINAL RESPONSE TO FRONTEND +++++");
    // console.log(JSON.stringify(response, null, 2));
    // console.log("+++++ FINAL RESPONSE END +++++");

    res
      .status(httpStatus.OK)
      .send(response);
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};

const getGamesBygid = async (req, res, next) => {
  try {
    const gid = req.params.gid;
    const type = req.params.type;
    const domain = req.params.domain;
    // const cacheKey = `matches:gid:${gid}:type:${type}`;
    // let matches = await getCache(cacheKey);

    // if (!matches) {
    const matches = await getGameByGidAndType(gid, type, domain);
    // await setCache(cacheKey, matches, 60);
    // }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(matches, "Game under this gid/type", httpStatus.OK)
      );
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};
const updateCasino = async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = req.body;
    const casino = await getGameById(id);
    if (req.files?.imgUrl) {
      if (casino?.imgUrl) {
        Utils.deleteFile(casino.imgUrl);
      }
      body.imgUrl = `/uploads/${body.domain}/${req.files.imgUrl[0].filename}`;
    } else if (body.imgUrl && typeof body.imgUrl !== "string") {
      body.imgUrl = null;
    }

    const update = await updateGame({ _id: id }, { $set: body });
    await delCache(`tablelist:${casino.gid}-${casino?.domain}`);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(update, "updated", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const checkGame = async (req, res, next) => {
  try {
    const { etid, gmid } = req.body;
    const filter = { isActive: true };
    const domain = req?.domainConfig?.domain;
    if (etid) filter.etid = etid;
    if (domain) filter.domain = domain;
    if (gmid) filter.gmid = gmid;
    if (etid && gmid) filter.gmid = Number(gmid);
    let match = await getGame(filter);
    // if (!match) {
    //   return res
    //     .status(httpStatus.NOT_FOUND)
    //     .send(
    //       new APIResponse(
    //         { isActive: false },
    //         "Game not found",
    //         httpStatus.NOT_FOUND
    //       )
    //     );
    // }

    // const userId = req?.user?._id;
    // let blockMarket = await getBlockMarket({
    //   gmid: filter.gmid,
    //   domain: filter.domain,
    //   userId: userId,
    //   isActive: true,
    // });
    // if (blockMarket) {
    //   return res
    //     .status(httpStatus.NOT_FOUND)
    //     .send(
    //       new APIResponse(
    //         { isActive: false },
    //         "Game not found",
    //         httpStatus.NOT_FOUND
    //       )
    //     );
    // }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(match, "Game fetched", httpStatus.OK));
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};



// const autoEnableCricket = async (req, res, next) => {
//   try {
//     const { domain, autoEnable } = req.body;

//     if (!domain) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "Domain is required",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     let autoEnableValue = false;

//     if (typeof autoEnable === "string") {
//       autoEnableValue = autoEnable.toLowerCase() === "true";
//     } else if (autoEnable !== undefined && autoEnable !== null) {
//       autoEnableValue = Boolean(autoEnable);
//     }

//     const domainDoc = await DomainModal.findOneAndUpdate(
//       { domain: domain },
//       {
//         $set: {
//           autoEnable: autoEnableValue,
//         },
//       },
//       {
//         new: true,
//       }
//     );

//     if (!domainDoc) {
//       return res
//         .status(httpStatus.NOT_FOUND)
//         .json(
//           new APIError(
//             "Domain not found",
//             httpStatus.NOT_FOUND
//           )
//         );
//     }

//     return res
//       .status(httpStatus.OK)
//       .json(
//         new APIResponse(
//           domainDoc,
//           "Auto enable updated successfully",
//           httpStatus.OK
//         )
//       );
//   } catch (err) {
//     console.log(err, "++++++++++AutoEnable++++++++++++");
//     next(err);
//   }
// };

const autoEnableCricket = async (req, res, next) => {
  try {
    const { domain, autoEnable } = req.body;

    if (!domain) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Domain is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    let autoEnableValue = false;

    if (typeof autoEnable === "string") {
      autoEnableValue = autoEnable.toLowerCase() === "true";
    } else if (
      autoEnable !== undefined &&
      autoEnable !== null
    ) {
      autoEnableValue = Boolean(autoEnable);
    }

    // =====================================================
    // CASE 1: domain = "all"
    // Update autoEnable for ALL domains
    // =====================================================
    if (domain.toLowerCase() === "all") {
      const result = await DomainModal.updateMany(
        {},
        {
          $set: {
            autoEnable: autoEnableValue,
          },
        }
      );

      return res
        .status(httpStatus.OK)
        .json(
          new APIResponse(
            {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              autoEnable: autoEnableValue,
            },
            "Auto enable updated for all domains",
            httpStatus.OK
          )
        );
    }

    // =====================================================
    // CASE 2: Specific domain
    // =====================================================
    const domainDoc = await DomainModal.findOneAndUpdate(
      {
        domain: domain,
      },
      {
        $set: {
          autoEnable: autoEnableValue,
        },
      },
      {
        new: true,
      }
    );

    if (!domainDoc) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "Domain not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    return res
      .status(httpStatus.OK)
      .json(
        new APIResponse(
          domainDoc,
          "Auto enable updated successfully",
          httpStatus.OK
        )
      );

  } catch (err) {
    console.log(
      err,
      "++++++++++AutoEnable++++++++++++"
    );

    next(err);
  }
};


module.exports = {
  deleteGame,
  create,
  getAll,
  getGamesBygmid,
  getGamesBycid,
  getGamesBygid,
  updateCasino,
  checkGame,
  autoEnableCricket,
};

          }
        }

        const domainConfig = await getDomainByDomain(data?.domain);

        const match = new Game({
          ...data,
          bet_limit: domainConfig?.bet_limit,
        });

        console.log("SAVING GAME:", {
          gmid: match.gmid,
          domain: match.domain,
          etid: match.etid,
        });

        await match.save();

        results.push({
          match: match.toObject(),
          message: "Game created",
        });
      }

      const target =
        existingMatch || results[results.length - 1].match;

      await delCache("matches:all");
      await delCache(`matches:cid:${target.cid}`);
      await delCache(`matches:gid:${target.gid}:type:${target.type}`);

      if (target?.gtype === "casino") {
        await delCache(`tablelist:${target.gid}-${data?.domain}`);
      }

      // Delete highlight cache for this domain + etid
      if (data?.domain && data?.etid) {
        const cacheKey =
          `highlighthomePrivate:${data.domain}-${data.etid}`;

        console.log("Deleting highlight cache:", cacheKey);

        await delCache(cacheKey);
      }
    }

    const gameData = matchesData?.[0];

    if (gameData?.domain && gameData?.etid) {
      const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}`;
      console.log(cacheKey);
      await delCache(cacheKey);
    }

    if (gameData?.domain && gameData?.gid) {
      const cacheKey = `tablelist:${gameData?.gid}-${gameData?.domain}-*`;
      await delCacheByPattern(cacheKey);
    } else if (gameData?.domain && gameData?.etid) {
      const cacheKey = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}-*`;
      await delCacheByPattern(cacheKey);
      const cacheKey2 = `highlighthomePrivate:${gameData?.domain}-${gameData?.etid}`;
      await delCache(cacheKey2);
    }

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          results,
          "Bulk create/update complete",
          httpStatus.OK
        )
      );
  } catch (e) {
    console.log(e,"++++++=Create Game Active Error+++++");
    next(
      new APIError(
        e.message,
        httpStatus.INTERNAL_SERVER_ERROR
      )
    );
  }
};

const deleteGame = async (req, res, next) => {
  try {
    const id = req.params.gmid;
    const result = await updateGame({ _id: id }, { $set: { isActive: false } });

    if (result) {
      await delCache("matches:all");
      await delCache(`matches:cid:${result.cid}`);
      await delCache(`matches:gid:${result.gid}:type:${result.type}`);
      await delCache(`match:${id}`);

      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { ...result.toObject(), isActive: false },
            Utils.messages.SUCCESS_DELETE,
            httpStatus.OK
          )
        );
    }

    return next(new APIError("Please check game id", httpStatus.NOT_FOUND));
  } catch (error) {
    next(new APIError(error.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};

// const getAll = async (req, res, next) => {



//   try {
//     const {
//       etid,
//       domain,
//       search,
//       date,
//       startDate,
//       endDate,
//       gid,
//       type,
//       parent,
//     } = req.query;
//     const filter = {};
//     if (etid) filter.etid = etid;
//     if (domain) filter.domain = domain;
//     if (gid) filter.gid = Number(gid);
//     if (type) filter.gtype = type;

//     if (search) {
//       filter.$or = [
//         { gname: { $regex: search, $options: "i" } },
//         { ename: { $regex: search, $options: "i" } },
//         {
//           $expr: {
//             $regexMatch: {
//               input: { $toString: "$gmid" },
//               regex: search,
//               options: "i",
//             },
//           },
//         },
//       ];
//     }

//     let matches = await getAllGame(filter);

//     if (date || (startDate && endDate)) {
//       const start = startDate
//         ? moment(startDate, "YYYY-MM-DD").startOf("day")
//         : moment(date, "YYYY-MM-DD").startOf("day");
//       const end = endDate
//         ? moment(endDate, "YYYY-MM-DD").endOf("day")
//         : moment(date, "YYYY-MM-DD").endOf("day");

//       matches = matches.filter((match) => {
//         if (!match.stime) return false;
//         const matchDate = moment(match.stime, "M/D/YYYY h:mm:ss A");
//         return matchDate.isBetween(start, end, null, "[]");
//       });
//     }

//     if (parent) {
//       const blockMarket = await getBlockMarketByUserId(parent, domain);
//       matches = matches.filter((match) => {
//         return !blockMarket?.map((game) => game?.gmid)?.includes(match?.gmid);
//       });
//     }
//     const domainConfig = await getDomainByDomain(domain);
//     const autoEnable = domainConfig?.autoEnable ?? false;
    
//     console.log("+++++++ GET ALL AUTO ENABLE:", {
//       domain,
//       autoEnable,
//     });
//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(matches, autoEnable, "Game fetched", httpStatus.OK));
//   } catch (err) {
//     next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
//   }
// };

//optimized
const getAll = async (req, res, next) => {
  try {
    const {
      etid,
      domain,
      search,
      date,
      startDate,
      endDate,
      gid,
      type,
      parent,
    } = req.query;

    const filter = {};

    // -----------------------------------------
    // BASIC FILTERS
    // -----------------------------------------
    if (etid) filter.etid = etid;
    if (domain) filter.domain = domain;
    if (gid) filter.gid = Number(gid);
    if (type) filter.gtype = type;

    // -----------------------------------------
    // SEARCH
    // -----------------------------------------
    if (search) {
      filter.$or = [
        {
          gname: {
            $regex: search,
            $options: "i",
          },
        },
        {
          ename: {
            $regex: search,
            $options: "i",
          },
        },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$gmid" },
              regex: search,
              options: "i",
            },
          },
        },
      ];
    }

    // -----------------------------------------
    // GET INDEPENDENT DATA IN PARALLEL
    // -----------------------------------------
    const [blockMarket, domainConfig] = await Promise.all([
      parent
        ? getBlockMarketByUserId(parent, domain)
        : Promise.resolve([]),

      getDomainByDomain(domain),
    ]);

    // -----------------------------------------
    // BLOCKED GMIDS
    // -----------------------------------------
    let blockedGmids = null;

    if (blockMarket?.length) {
      blockedGmids = new Set(
        blockMarket
          .map((game) => game?.gmid)
          .filter(Boolean)
      );
    }

    // -----------------------------------------
    // GET GAMES
    // -----------------------------------------
    let matches = await getAllGameLean(filter);

    // -----------------------------------------
    // DATE FILTER
    // -----------------------------------------
    if (date || (startDate && endDate)) {
      const start = startDate
        ? moment(startDate, "YYYY-MM-DD").startOf("day")
        : moment(date, "YYYY-MM-DD").startOf("day");

      const end = endDate
        ? moment(endDate, "YYYY-MM-DD").endOf("day")
        : moment(date, "YYYY-MM-DD").endOf("day");

      matches = matches.filter((match) => {
        if (!match.stime) return false;

        const matchDate = moment(
          match.stime,
          "M/D/YYYY h:mm:ss A"
        );

        return matchDate.isBetween(
          start,
          end,
          null,
          "[]"
        );
      });
    }

    // -----------------------------------------
    // BLOCK MARKET FILTER
    // -----------------------------------------
    if (blockedGmids?.size) {
      matches = matches.filter(
        (match) => !blockedGmids.has(match?.gmid)
      );
    }

    // -----------------------------------------
    // AUTO ENABLE
    // -----------------------------------------
    const autoEnable = domainConfig?.autoEnable ?? false;

    console.log("+++++++ GET ALL AUTO ENABLE:", {
      domain,
      autoEnable,
    });

    // -----------------------------------------
    // RESPONSE — UNCHANGED
    // -----------------------------------------
    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          matches,
          autoEnable,
          "Game fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(
      new APIError(
        err.message,
        httpStatus.INTERNAL_SERVER_ERROR
      )
    );
  }
};

const getGamesBygmid = async (req, res, next) => {
  try {
    const gmid = req.params.gmid;
    const domain = req.domainConfig.domain;
    // const cacheKey = `matches:etid:${etid}`;

    // let matches = await getCache(cacheKey);
    // if (!matches) {
    const matches = await getGameByGmid(gmid, domain);
    // await setCache(cacheKey, matches, 60);
    // }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(matches, "Game under this etid", httpStatus.OK));
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};
const getGamesBycid = async (req, res, next) => {
   //console.log("+++++autoEnable+++++");
  try {
    const fields = req?.query?.fields?.split(",");
    const etid = req.params.etid;
    const domain = req.params.domain;
    // const cacheKey = `matches:etid:${etid}`;

    // let matches = await getCache(cacheKey);
    // if (!matches) {
    const matches = await getGameByCid(etid, domain, fields);
    // await setCache(cacheKey, matches, 60);
    // }
        const domainConfig = await getDomainByDomain(domain);
        const autoEnable = domainConfig?.autoEnable ?? false;

    //     console.log(autoEnable,"+++++KEYYYautoEnable+++");
    // res
    //   .status(httpStatus.OK)
    //   .send(new APIResponse(matches,autoEnable, "Game under this etid", httpStatus.OK));
    console.log(autoEnable, "+++++KEYYYautoEnable+++");

    const response = new APIResponse(
      matches,
      autoEnable,
      "Game under this etid",
      httpStatus.OK
    );


    response.autoEnable = autoEnable;

    // console.log("+++++ FINAL RESPONSE TO FRONTEND +++++");
    // console.log(JSON.stringify(response, null, 2));
    // console.log("+++++ FINAL RESPONSE END +++++");

    res
      .status(httpStatus.OK)
      .send(response);
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};

const getGamesBygid = async (req, res, next) => {
  try {
    const gid = req.params.gid;
    const type = req.params.type;
    const domain = req.params.domain;
    // const cacheKey = `matches:gid:${gid}:type:${type}`;
    // let matches = await getCache(cacheKey);

    // if (!matches) {
    const matches = await getGameByGidAndType(gid, type, domain);
    // await setCache(cacheKey, matches, 60);
    // }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(matches, "Game under this gid/type", httpStatus.OK)
      );
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};
const updateCasino = async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = req.body;
    const casino = await getGameById(id);
    if (req.files?.imgUrl) {
      if (casino?.imgUrl) {
        Utils.deleteFile(casino.imgUrl);
      }
      body.imgUrl = `/uploads/${body.domain}/${req.files.imgUrl[0].filename}`;
    } else if (body.imgUrl && typeof body.imgUrl !== "string") {
      body.imgUrl = null;
    }

    const update = await updateGame({ _id: id }, { $set: body });
    await delCache(`tablelist:${casino.gid}-${casino?.domain}`);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(update, "updated", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const checkGame = async (req, res, next) => {
  try {
    const { etid, gmid } = req.body;
    const filter = { isActive: true };
    const domain = req?.domainConfig?.domain;
    if (etid) filter.etid = etid;
    if (domain) filter.domain = domain;
    if (gmid) filter.gmid = gmid;
    if (etid && gmid) filter.gmid = Number(gmid);
    let match = await getGame(filter);
    // if (!match) {
    //   return res
    //     .status(httpStatus.NOT_FOUND)
    //     .send(
    //       new APIResponse(
    //         { isActive: false },
    //         "Game not found",
    //         httpStatus.NOT_FOUND
    //       )
    //     );
    // }

    // const userId = req?.user?._id;
    // let blockMarket = await getBlockMarket({
    //   gmid: filter.gmid,
    //   domain: filter.domain,
    //   userId: userId,
    //   isActive: true,
    // });
    // if (blockMarket) {
    //   return res
    //     .status(httpStatus.NOT_FOUND)
    //     .send(
    //       new APIResponse(
    //         { isActive: false },
    //         "Game not found",
    //         httpStatus.NOT_FOUND
    //       )
    //     );
    // }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(match, "Game fetched", httpStatus.OK));
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};



// const autoEnableCricket = async (req, res, next) => {
//   try {
//     const { domain, autoEnable } = req.body;

//     if (!domain) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "Domain is required",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     let autoEnableValue = false;

//     if (typeof autoEnable === "string") {
//       autoEnableValue = autoEnable.toLowerCase() === "true";
//     } else if (autoEnable !== undefined && autoEnable !== null) {
//       autoEnableValue = Boolean(autoEnable);
//     }

//     const domainDoc = await DomainModal.findOneAndUpdate(
//       { domain: domain },
//       {
//         $set: {
//           autoEnable: autoEnableValue,
//         },
//       },
//       {
//         new: true,
//       }
//     );

//     if (!domainDoc) {
//       return res
//         .status(httpStatus.NOT_FOUND)
//         .json(
//           new APIError(
//             "Domain not found",
//             httpStatus.NOT_FOUND
//           )
//         );
//     }

//     return res
//       .status(httpStatus.OK)
//       .json(
//         new APIResponse(
//           domainDoc,
//           "Auto enable updated successfully",
//           httpStatus.OK
//         )
//       );
//   } catch (err) {
//     console.log(err, "++++++++++AutoEnable++++++++++++");
//     next(err);
//   }
// };

const autoEnableCricket = async (req, res, next) => {
  try {
    const { domain, autoEnable } = req.body;

    if (!domain) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Domain is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    let autoEnableValue = false;

    if (typeof autoEnable === "string") {
      autoEnableValue = autoEnable.toLowerCase() === "true";
    } else if (
      autoEnable !== undefined &&
      autoEnable !== null
    ) {
      autoEnableValue = Boolean(autoEnable);
    }

    // =====================================================
    // CASE 1: domain = "all"
    // Update autoEnable for ALL domains
    // =====================================================
    if (domain.toLowerCase() === "all") {
      const result = await DomainModal.updateMany(
        {},
        {
          $set: {
            autoEnable: autoEnableValue,
          },
        }
      );

      return res
        .status(httpStatus.OK)
        .json(
          new APIResponse(
            {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              autoEnable: autoEnableValue,
            },
            "Auto enable updated for all domains",
            httpStatus.OK
          )
        );
    }

    // =====================================================
    // CASE 2: Specific domain
    // =====================================================
    const domainDoc = await DomainModal.findOneAndUpdate(
      {
        domain: domain,
      },
      {
        $set: {
          autoEnable: autoEnableValue,
        },
      },
      {
        new: true,
      }
    );

    if (!domainDoc) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "Domain not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    return res
      .status(httpStatus.OK)
      .json(
        new APIResponse(
          domainDoc,
          "Auto enable updated successfully",
          httpStatus.OK
        )
      );

  } catch (err) {
    console.log(
      err,
      "++++++++++AutoEnable++++++++++++"
    );

    next(err);
  }
};


module.exports = {
  deleteGame,
  create,
  getAll,
  getGamesBygmid,
  getGamesBycid,
  getGamesBygid,
  updateCasino,
  checkGame,
  autoEnableCricket,
};
