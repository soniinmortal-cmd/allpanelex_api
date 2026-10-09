const httpStatus = require("http-status");
const { apiRequest } = require("../helpers/utils");

const {
  getOrSetCache,
  getCache,
  setCache,
  delCache,
} = require("../helpers/cache");

const {
  checkCasinoBettingResult,
} = require("../helpers/bettingResultChecker");


const registerData2Socket = (io) => {

  //console.log(" data2 socket module registered");

  io.on("connection", (socket) => {

    //console.log("data2 socket connection:", socket.id);

    socket.on("data2", async (payload) => {

      try {

        //console.log("DATA2 EVENT RECEIVED");
        //console.log("PAYLOAD:", payload);

        const type = payload?.type;

        // Same cache-key logic based on type
        const cacheKey = `casinodata:data2type=${type || ""}`;

        const fetchData = async () => {

          const response = await apiRequest({
            url: `casino/data`,
            apiAction: "GET",
            data: {
              gtype: type,
              key: process.env.JSK_CASINO_KEY,
            },
            host: process.env.JSK_CASINO_SERVER_URL,
            noEncrypt: true,
          });


          const casinodata = response?.data;


          if (
            Array.isArray(casinodata) &&
            casinodata.length > 0
          ) {

            // OPEN market first
            const currentMarket =
              casinodata.find(
                (item) => item.mtype === "OPEN"
              ) || casinodata[0];


            const marketId = currentMarket?.mid;
            const gType = type;

            const lastMarketKey =
              `lastMarket:${gType}`;

            const lastMarketId =
              await getCache(lastMarketKey);


            if (marketId && gType) {

              if (
                lastMarketId &&
                lastMarketId !== marketId
              ) {

                checkCasinoBettingResult(
                  lastMarketId
                );

                await delCache(
                  lastMarketKey
                );
              }


              await setCache(
                lastMarketKey,
                marketId,
                1200
              );
            }


            const isLastResult =
              lastMarketId
                ? lastMarketId !== marketId
                : true;


            // Add isLastResult to every item
            return casinodata.map((item) => ({
              ...item,
              isLastResult,
            }));
          }


          return casinodata;
        };


        // Same 1 second cache
        const result = await getOrSetCache(
          cacheKey,
          fetchData,
          1
        );


        // console.log(
        //   "DATA2 RESPONSE READY"
        // );


        socket.emit(
          "data2Response",
          {
            status: httpStatus.OK,
            data: result,
            message: "casion data fetched",
          }
        );

      } catch (err) {

        console.error(
          "data2 socket error:",
          err
        );
        socket.emit(
          "data2Error",
          {
            status:
              httpStatus.INTERNAL_SERVER_ERROR,
            message:
              err?.message ||
              "Failed to fetch casino data",
          }
        );
      }

    });
  });
};


module.exports = registerData2Socket;