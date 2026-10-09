const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getCache, setCache, getActiveServerRedis } = require("../../helpers/cache");
const { getGameByCid,getGameByCidWithoutIsActive } = require("../games/games.helper");
const {
  getBlockMarketByUserId,
} = require("../block-market/block-market.helper");
const Game = require("../games/games.model");
const router = express.Router();

const highlighthomePrivate = async (req, res, next) => {
  try {
    const { etid = 4, type = "all", parent } = req.body;
    const domain = req?.domainConfig?.domain;
    


    const cacheKey = parent
      ? `highlighthomePrivates:${domain}-${etid}-${parent}`
      : `highlighthomePrivates:${domain}-${etid}`;

    const cacheStart = Date.now();
    let highlighthomePrivateData = await getCache(cacheKey);
    console.log(
  `[HIGHLIGHT CACHE GET] key=${cacheKey} hit=${!!highlighthomePrivateData} time=${Date.now() - cacheStart}ms`
);
    //highlighthomePrivateData=null;
    console.log("parent",parent);
    console.log(
  `[HIGHLIGHT CACHE GET] key=${cacheKey} hit=${!!highlighthomePrivateData}`
);

    //highlighthomePrivateData=null;

    if (!highlighthomePrivateData) {
      const missStart = Date.now();
      console.log(`[HIGHLIGHT CACHE MISS] key=${cacheKey}`);
      
      const jskStart = Date.now();

      const res = await apiRequest({
        url: "highlighthomePrivate",
        apiAction: "GET",
        data: { etid:etid, key: process.env.JSK_KEY },
        host: process.env.JSK_SERVER_URL,
        noEncrypt: true,
      });
      console.log(
        `[HIGHLIGHT] JSK apiRequest: ${Date.now() - jskStart}ms`
      );
      let updatedData = res?.data?.data ?? {};
      const jskGames = [
        ...(Array.isArray(updatedData.t1) ? updatedData.t1 : []),
        ...(Array.isArray(updatedData.t2) ? updatedData.t2 : []),
      ];

      const uniqueGmids = [
        ...new Set(
          jskGames
            .map(game => game.gmid)
            .filter(
              gmid =>
                gmid !== undefined &&
                gmid !== null
            )
        ),
      ];

      let matches = [];

      const matchesStart = Date.now();

      if ([10, 65].includes(Number(etid))) {

        // 10 and 65: existing behavior
        matches = await getGameByCidWithoutIsActive(etid, domain);

      } else {

        // Other ETIDs: only fetch games returned by JSK
        matches = await Game.find({
          etid,
          domain,
          gmid: {
            $in: uniqueGmids.map(Number),
          },
        })
          .select("gmid etid isActive")
          .lean();
      }

      console.log(
        `[HIGHLIGHT] DB game lookup: ${Date.now() - matchesStart}ms`,
        `matches=${matches.length}`
      );

      console.log(
        `[HIGHLIGHT] JSK TOTAL GAMES: ${jskGames.length}, UNIQUE GMIDS: ${uniqueGmids.length}`
      );
      console.log("[HIGHLIGHT AFTER JSK]", {
        key: cacheKey,
        t1Length: Array.isArray(updatedData?.t1)
          ? updatedData.t1.length
          : "NOT_ARRAY",
        t2Length: Array.isArray(updatedData?.t2)
          ? updatedData.t2.length
          : "NOT_ARRAY",
      });

      const filterStart = Date.now();

      if (Array.isArray(updatedData?.t1) && updatedData.t1?.length > 0) {
        


        if ([10, 65].includes(Number(etid))) {

          updatedData.t1 = updatedData.t1
            .map(country => ({
              ...country,
              children: (country.children || [])
                .map(track => ({
                  ...track,
                  // children: (track.children || []).filter(game =>
                  //   matches.some(
                  //     dbGame =>
                  //       dbGame.gmid === game.gmid &&
                  //       dbGame.etid === game.etid &&
                  //       dbGame.isActive
                  //   )
                  // )

                    children: (track.children || []).filter(game => {
                      const dbGame = matches.find(
                        item =>
                          item.gmid === game.gmid &&
                          item.etid === game.etid
                      );

                      // not in DB  -> third-party API show
                      if (!dbGame) {
                        return true;
                      }

                      //In DB  -> old isActive logic
                      return dbGame.isActive === true;
                    })
                }))
                .filter(track => track.children.length > 0)
            }))
            .filter(country => country.children.length > 0);



        }else{
          console.log("else ran");
          // updatedData.t1 = updatedData?.t1.filter(({ gmid, etid }) => {
          //   return matches.filter(
          //     (game) => game.gmid === gmid && game.etid === etid && game.isActive
          //   )?.length;
          // });

          updatedData.t1 = updatedData.t1.filter(({ gmid, etid }) => {
            const dbGame = matches.find(
              (game) => game.gmid === gmid && game.etid === etid
            );

            // not in DB  -> show third-party API 
            if (!dbGame) {
              return true;
            }

            //in DB  -> old isActive logic
            return dbGame.isActive === true;
          });

          console.log("[HIGHLIGHT AFTER T1 FILTER]", {
  key: cacheKey,
  t1Length: updatedData.t1.length,
  t2Length: updatedData.t2.length,
});
        }

        



        
      } else {
        updatedData.t1 = [];
      }

      if (Array.isArray(updatedData?.t2) && updatedData.t2.length > 0) {
        updatedData.t2 = updatedData.t2.filter(({ gmid, etid }) =>
          matches.some(
            (game) => game.gmid === gmid && game.etid === etid && game.isActive
          )
        );
      } else {
        updatedData.t2 = [];
      }
      if (!Array.isArray(updatedData?.t1)) {
        updatedData.t1 = [];
      }

      if (!Array.isArray(updatedData?.t2)) {
        updatedData.t2 = [];
      }

      console.log(
        `[HIGHLIGHT] t1/t2 filtering: ${Date.now() - filterStart}ms`
      );

      if (parent) {
        const blockStart = Date.now();
        const blockMarket = await getBlockMarketByUserId(parent, domain);
        console.log(
          `[HIGHLIGHT] getBlockMarketByUserId: ${Date.now() - blockStart}ms`,
          `blocks=${blockMarket?.length || 0}`
        );
        if (Array.isArray(updatedData?.t1) && updatedData.t1?.length > 0) {

          if ([10, 65].includes(Number(etid))) {

            updatedData.t1 = updatedData.t1
              .map(country => ({
                ...country,
                children: (country.children || [])
                  .map(track => ({
                    ...track,
                    children: (track.children || []).filter(game =>
                      !blockMarket.some(
                        blocked =>
                          blocked.gmid === game.gmid &&
                          blocked.etid === game.etid &&
                          blocked.isActive
                      )
                    )
                  }))
                  .filter(track => track.children.length > 0)
              }))
              .filter(country => country.children.length > 0);

          }else{
            updatedData.t1 = updatedData?.t1.filter(({ gmid, etid }) => {
              const isBlock = blockMarket.filter(
                (game) =>
                  game.gmid === gmid && game.etid === etid && game.isActive
              )?.length;
              return !isBlock;
            });
          }
          
          
        } else {
          updatedData.t1 = [];
        }

        if (Array.isArray(updatedData?.t2) && updatedData.t2.length > 0) {
          updatedData.t2 = updatedData.t2.filter(({ gmid, etid }) => {
            const isBlock = blockMarket.filter(
              (game) =>
                game.gmid === gmid && game.etid === etid && game.isActive
            )?.length;
            return !isBlock;
          });
        } else {
          updatedData.t2 = [];
        }
      }
      highlighthomePrivateData = updatedData;
      const cacheSetStart = Date.now();
      
      await setCache(cacheKey, highlighthomePrivateData, 2); // cache for 60s


      console.log(
        `[HIGHLIGHT CACHE SET] ${Date.now() - cacheSetStart}ms`
      );

      console.log(
        `[HIGHLIGHT MISS TOTAL] ${Date.now() - missStart}ms`
      );
    }
    if (!highlighthomePrivateData) {
      const matches = await getGameByCidWithoutIsActive(etid, domain);

      let updatedData = {
        t1: matches.filter((game) => game.isActive),
        t2: [],
      };

      if (parent) {
        const blockMarket = await getBlockMarketByUserId(parent, domain);

        updatedData.t1 = updatedData.t1.filter((game) => {
          const isBlocked = blockMarket.some(
            (blocked) =>
              blocked.gmid === game.gmid &&
              blocked.etid === game.etid &&
              blocked.isActive
          );

          return !isBlocked;
        });
      }

      highlighthomePrivateData = updatedData;

      await setCache(cacheKey, highlighthomePrivateData, 2);
    }




    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          highlighthomePrivateData,
          "Match fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", highlighthomePrivate);

module.exports = router;
