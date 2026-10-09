const { apiRequest } = require("../helpers/utils");
const Game = require("../apis/games/games.model");
const WebSocket = require("ws");
const gameDataManager = require("./gamedataManager");
const socketSubscriptions = new Map();


const {
  getCache,
  setCache,
} = require("../helpers/cache");


async function processAndSendGameData({
  socket,
  gmid,
  etid,
  domain,
  data,
}) {
  try {
    const mongoStart = process.hrtime.bigint();

    const game = await Game.findOne({
      gmid: Number(gmid),
      domain: domain,
    }).lean();

    const mongoMs =
      Number(process.hrtime.bigint() - mongoStart) / 1e6;

    if (mongoMs > 50) {
      console.warn(
        `[WS MONGO SLOW] ` +
        `gmid=${gmid} ` +
        `etid=${etid} ` +
        `mongo=${mongoMs.toFixed(2)}ms`
      );
    }

    const processingStart = process.hrtime.bigint();

    if (game && Array.isArray(data?.data)) {
      data.data = data.data
        .filter((market) => {
          let configKey = market.gtype;

          if (market.gtype === "fancy") {
            switch (market.mname) {
              case "Ball By Ball":
                configKey = "fancyBallByBall";
                break;

              case "Over By Over":
                configKey = "fancyOverByOver";
                break;

              default:
                configKey = "fancy";
            }
          } else if (market.gtype === "match") {
            switch (market.mname) {
              case "TIED_MATCH":
                configKey = "tiedMatch";
                break;

              default:
                configKey = "match";
            }
          }

          const enabled = game.bet_config?.[configKey];

          return enabled === undefined ? true : enabled;
        })
        .map((market) => {
          let configKey = market.gtype;

          if (market.gtype === "fancy") {
            switch (market.mname) {
              case "Ball By Ball":
                configKey = "fancyBallByBall";
                break;

              case "Over By Over":
                configKey = "fancyOverByOver";
                break;

              default:
                configKey = "fancy";
            }
          } else if (market.gtype === "match") {
            switch (market.mname) {
              case "TIED_MATCH":
                configKey = "tiedMatch";
                break;

              default:
                configKey = "match";
            }
          }

          const limit = game.bet_limit?.[configKey];

          if (
            limit &&
            (Number(limit.min) !== 0 ||
              Number(limit.max) !== 0)
          ) {
            market.min = limit.min;
            market.max = limit.max;

            if (market.mname === "MATCH_ODDS") {
              market.maxb = limit.max;
            }

            if (Array.isArray(market.section)) {
              market.section = market.section.map(
                (section) => ({
                  ...section,
                  min: limit.min,
                  max: limit.max,
                })
              );
            }
          }

          return market;
        });
    }

    const processingMs =
      Number(process.hrtime.bigint() - processingStart) / 1e6;

    if (processingMs > 50) {
      console.warn(
        `[WS JS PROCESS SLOW] ` +
        `gmid=${gmid} ` +
        `etid=${etid} ` +
        `processing=${processingMs.toFixed(2)}ms`
      );
    }

    /*
     * EXACT SAME RESPONSE AS BEFORE
     */
    socket.emit("gamedataPrivateResponse", {
      status: data?.status,
      data: data,
    });
  } catch (error) {
    console.error(
      "gamedataPrivate processing error:",
      error
    );

    socket.emit("gamedataPrivateError", {
      message: "Failed to process game data",
      error: error?.message,
    });
  }
}



// const registerGamedataSocket = (io) => {
//   io.on("connection", (socket) => {
//     console.log("Socket connected:", socket.id);

//     socket.on("gamedataPrivate", async (payload) => {
//       try {
//         console.log("SOCKET EVENT RECEIVED: gamedataPrivate");
//         console.log("PAYLOAD:", payload);

//         const { etid, gmid, domain } = payload || {};

//         if (!etid || !gmid) {
//           return socket.emit("gamedataPrivateError", {
//             message: "etid and gmid are required",
//           });
//         }

//         console.log("BEFORE API REQUEST");
//         console.log("etid =", etid);
//         console.log("gmid =", gmid);
//         console.log("JSK_KEY =", process.env.JSK_KEY);
//         console.log("JSK_SERVER_URL =", process.env.JSK_SERVER_URL);

//         // IMPORTANT:
//         // etid, gmid and key MUST be inside data
//         const response = await apiRequest({
//           url: "gamedataPrivate",
//           apiAction: "GET",
//           data: {
//             etid: etid,
//             gmid: gmid,
//             key: process.env.JSK_KEY,
//           },
//           host: process.env.JSK_SERVER_URL,
//           noEncrypt: true,
//         });

//         let data = response?.data;

//         console.log("UPSTREAM RESPONSE:", data);

//         const game = await Game.findOne({
//           gmid: Number(gmid),
//           domain: domain,
//         }).lean();

//         if (game && Array.isArray(data?.data)) {
//           data.data = data.data
//             .filter((market) => {
//               let configKey = market.gtype;

//               if (market.gtype === "fancy") {
//                 switch (market.mname) {
//                   case "Ball By Ball":
//                     configKey = "fancyBallByBall";
//                     break;

//                   case "Over By Over":
//                     configKey = "fancyOverByOver";
//                     break;

//                   default:
//                     configKey = "fancy";
//                 }
//               } else if (market.gtype === "match") {
//                 switch (market.mname) {
//                   case "TIED_MATCH":
//                     configKey = "tiedMatch";
//                     break;

//                   default:
//                     configKey = "match";
//                 }
//               }

//               const enabled = game.bet_config?.[configKey];

//               return enabled === undefined ? true : enabled;
//             })
//             .map((market) => {
//               let configKey = market.gtype;

//               if (market.gtype === "fancy") {
//                 switch (market.mname) {
//                   case "Ball By Ball":
//                     configKey = "fancyBallByBall";
//                     break;

//                   case "Over By Over":
//                     configKey = "fancyOverByOver";
//                     break;

//                   default:
//                     configKey = "fancy";
//                 }
//               } else if (market.gtype === "match") {
//                 switch (market.mname) {
//                   case "TIED_MATCH":
//                     configKey = "tiedMatch";
//                     break;

//                   default:
//                     configKey = "match";
//                 }
//               }

//               const limit = game.bet_limit?.[configKey];

//               if (
//                 limit &&
//                 (Number(limit.min) !== 0 || Number(limit.max) !== 0)
//               ) {
//                 market.min = limit.min;
//                 market.max = limit.max;

//                 if (market.mname === "MATCH_ODDS") {
//                   market.maxb = limit.max;
//                 }

//                 if (Array.isArray(market.section)) {
//                   market.section = market.section.map((section) => ({
//                     ...section,
//                     min: limit.min,
//                     max: limit.max,
//                   }));
//                 }
//               }

//               return market;
//             });
//         }

//         socket.emit("gamedataPrivateResponse", {
//           status: data?.status,
//           data: data,
//         });

//       } catch (error) {
//         console.error("gamedataPrivate socket error:", error);

//         socket.emit("gamedataPrivateError", {
//           message: "Failed to fetch game data",
//           error: error?.message,
//         });
//       }
//     });

//     socket.on("disconnect", () => {
//       console.log("Socket disconnected:", socket.id);
//     });
//   });
// };


const registerGamedataSocket = (io) => {

  /*
   * ============================================================
   * UPSTREAM DATA RECEIVED FROM SHARED GAME DATA MANAGER
   * ============================================================
   *
   * Manager is completely domain-independent.
   *
   * It gives us:
   *
   * gmid
   * etid
   * raw data
   *
   * This file then finds every frontend socket watching that
   * gmid + etid and applies its own domain-specific config.
   */
  gameDataManager.on(
    "gamedata",
    async ({ gmid, etid, data }) => {

      const eventStart = process.hrtime.bigint();

      let subscriberCount = 0;
      let processedCount = 0;
      let cloneTotalMs = 0;
      let processTotalMs = 0;

      for (const [
        socketId,
        subscription,
      ] of socketSubscriptions.entries()) {

        /*
         * Only send this upstream game's data to sockets
         * subscribed to the same gmid + etid.
         */
        if (
          String(subscription.gmid) !== String(gmid) ||
          String(subscription.etid) !== String(etid)
        ) {
          continue;
        }

        const socket =
          io.sockets.sockets.get(socketId);

        /*
         * Socket may have disconnected already.
         */
        if (!socket) {
          socketSubscriptions.delete(socketId);
          continue;
        }

        /*
         * IMPORTANT:
         *
         * Each socket can have a different domain.
         *
         * Therefore each socket gets its own copy of the
         * upstream data before domain-specific processing.
         */
        const cloneStart = process.hrtime.bigint();

        const socketData = JSON.parse(
          JSON.stringify(data)
        );

        const cloneMs =
          Number(process.hrtime.bigint() - cloneStart) / 1e6;

        cloneTotalMs += cloneMs;

        if (cloneMs > 10) {
          console.warn(
            `[WS JSON SLOW] gmid=${gmid} etid=${etid} ` +
            `socket=${socketId} ` +
            `clone=${cloneMs.toFixed(2)}ms ` +
            `payloadSize=${JSON.stringify(data).length}`
          );
        }

        const processStart = process.hrtime.bigint();

        await processAndSendGameData({
          socket,
          gmid,
          etid,
          domain: subscription.domain,
          data: socketData,
        });

        const processMs =
          Number(process.hrtime.bigint() - processStart) / 1e6;

        processTotalMs += processMs;
        processedCount++;

        if (processMs > 100) {
          console.warn(
            `[WS PROCESS SLOW] gmid=${gmid} etid=${etid} ` +
            `socket=${socketId} ` +
            `process=${processMs.toFixed(2)}ms`
          );
        }
      }
    }
  );


  /*
   * ============================================================
   * MANAGER ERROR
   * ============================================================
   */

  gameDataManager.on(
    "gamedataError",
    ({ gmid, etid, error }) => {

      for (const [
        socketId,
        subscription,
      ] of socketSubscriptions.entries()) {

        if (
          String(subscription.gmid) !== String(gmid) ||
          String(subscription.etid) !== String(etid)
        ) {
          continue;
        }

        const socket =
          io.sockets.sockets.get(socketId);

        if (!socket) {
          socketSubscriptions.delete(socketId);
          continue;
        }

        socket.emit(
          "gamedataPrivateError",
          {
            message: "Failed to fetch game data",
            error: error?.message,
          }
        );
      }
    }
  );


  /*
   * ============================================================
   * SOCKET.IO CONNECTION
   * ============================================================
   */

  io.on("connection", (socket) => {




    /*
     * ==========================================================
     * GAMEDATA PRIVATE
     * ==========================================================
     */

    socket.on(
      "gamedataPrivate",
      async (payload) => {

        try {



          const {
            etid,
            gmid,
            domain,
          } = payload || {};


          /*
           * Same validation as before.
           */
          if (!etid || !gmid) {

            return socket.emit(
              "gamedataPrivateError",
              {
                message:
                  "etid and gmid are required",
              }
            );
          }


          /*
           * ====================================================
           * SAVE FRONTEND SUBSCRIPTION
           * ====================================================
           *
           * Domain belongs to the frontend socket.
           *
           * The shared upstream connection does NOT care
           * about domain.
           */

          socketSubscriptions.set(
            socket.id,
            {
              gmid,
              etid,
              domain,
            }
          );


          /*
           * ====================================================
           * ENSURE SHARED UPSTREAM CONNECTION
           * ====================================================
           *
           * If another user already opened:
           *
           *     gmid + etid
           *
           * the manager reuses that WebSocket.
           *
           * Otherwise it creates one.
           */

          await gameDataManager.ensureConnection(
            gmid,
            etid,
            socket.id
          );


          /*
           * ====================================================
           * READ LATEST DATA FROM REDIS
           * ====================================================
           *
           * This handles the case where data is already
           * available before this frontend subscribed.
           *
           * IMPORTANT:
           * Use your existing getCache import/helper here.
           */

          const redisKey =
            gameDataManager.getRedisKey(
              gmid,
              etid
            );

          const redisData =
            await getCache(redisKey);


          /*
           * If Redis already has data, immediately send it
           * through the SAME processing pipeline.
           */
          if (redisData) {

            const socketData =
              JSON.parse(
                JSON.stringify(redisData)
              );

            await processAndSendGameData({
              socket,
              gmid,
              etid,
              domain,
              data: socketData,
            });
          }

        } catch (error) {

          console.error(
            "gamedataPrivate socket error:",
            error
          );

          socket.emit(
            "gamedataPrivateError",
            {
              message:
                "Failed to fetch game data",
              error:
                error?.message,
            }
          );
        }
      }
    );


    /*
     * ==========================================================
     * SOCKET DISCONNECTED
     * ==========================================================
     */

    socket.on("disconnect", (reason) => {

      const subscription =
        socketSubscriptions.get(socket.id);


      if (subscription) {
        gameDataManager.removeSubscriber(
          subscription.gmid,
          subscription.etid,
          socket.id
        );

        socketSubscriptions.delete(socket.id);
      }
    });
  });
};

module.exports = registerGamedataSocket;
