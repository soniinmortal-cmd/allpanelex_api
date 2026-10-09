const httpStatus = require("http-status");
const { getCache, setCache } = require("../helpers/cache");
const Utils = require("../helpers/utils");

const {
  User,
} = require("../apis/users/users.helper");

const UserAccess = require("../apis/users/userAccess.model");

const {
  Domain,
} = require("../apis/domain/domain.helper");


const registerGetByIdSocket = (io) => {


  io.on("connection", (socket) => {



    socket.on("getById", async (payload) => {

      try {




        /*
         * Same as:
         *
         * let id = req.user?._id;
         */

        const socketUser =
          socket.user || payload?.user || {};

        let id = socketUser?._id;


        /*
         * Same as:
         *
         * if (req?.user?.currentUserId) {
         *   id = req.user.currentUserId;
         * }
         */

        if (socketUser?.currentUserId) {
          id = socketUser.currentUserId;
        }


        /*
         * Same as:
         *
         * if (req.query?._id) {
         *   id = req.query._id;
         * }
         */

        if (payload?._id) {
          id = payload._id;
        }


        /*
         * Same as:
         *
         * const fields =
         * req.query?.fields?.split(",");
         */

        const fields =
          payload?.fields?.split(",");


        /*
         * Same cache key
         */

        const cacheKey =
          `user:getById:${id}`;


        /*
         * Same:
         *
         * let user = await getCache(cacheKey);
         */

        let user =
          await getCache(cacheKey);


        /*
         * Same:
         *
         * if (!user)
         */

        if (!user) {

          user =
            await User.findById(id).lean();


          /*
           * Same User not found logic
           */

          if (!user) {

            return socket.emit(
              "getByIdError",
              {
                status:
                  httpStatus.NOT_FOUND,

                message:
                  "User not found",
              }
            );
          }


          /*
           * Same user role logic
           */

          if (user.role === "user") {

            delete user.privileges;
            delete user.depositRequestsCount;
            delete user.withdrawRequestsCount;
            delete user.usedSeats;
            delete user.seat;
            delete user.commission;
            delete user.transaction_pin;
            delete user.parent;
            delete user.currentToken;
            delete user.registration_user_master;
            delete user.remark;
            delete user.partnerLevel;
            delete user.masterId;
            delete user.createdAt;
            delete user.updatedAt;
            delete user.__v;
          }


          /*
           * Same password removal
           */

          if (user.password) {
            delete user.password;
          }


          /*
           * Same cache
           */

          await setCache(
            cacheKey,
            user,
            60
          );
        }


        /*
         * Same liveData query
         */

        const liveData =
          await User.findById(id)
            .select(
              "role balance exp isActive userLock betLock isLogin currentToken"
            )
            .lean();


        /*
         * Same User not found logic
         */

        if (!liveData) {

          return socket.emit(
            "getByIdError",
            {
              status:
                httpStatus.NOT_FOUND,

              message:
                "User not found",
            }
          );
        }


        /*
         * Same live fields update
         */

        user.role =
          liveData.role;

        user.balance =
          liveData.balance;

        user.exp =
          liveData.exp;

        user.isActive =
          liveData.isActive;

        user.userLock =
          liveData.userLock;

        user.betLock =
          liveData.betLock;

        user.isLogin =
          liveData.isLogin;

        user.currentToken =
          liveData.currentToken;


        /*
         * Same Domain logic
         */

        if (user?.domain) {

          const domainData =
            await Domain.findOne({
              domain: user.domain,
            })
              .select(
                "isTransactionpassword isSeat isMatchLock maintenance_mode isCasinoThirdParty"
              )
              .lean();


          user.isTransactionpassword =
            domainData?.isTransactionpassword ??
            true;


          user.isSeat =
            domainData?.isSeat ??
            true;


          user.isMatchLock =
            domainData?.isMatchLock ??
            true;


          user.isCasinoThirdParty =
            domainData?.isCasinoThirdParty ??
            true;


          /*
           * Same demo logic
           */

          if (
            user.role === "demo" &&
            domainData
          ) {

            user.isMatchLock =
              domainData.isMatchLock;
          }


          user.maintenance_mode =
            domainData?.maintenance_mode ??
            false;
        }


        /*
         * Same:
         *
         * if (req?.user?.currentUserId)
         */

        if (
          socketUser?.currentUserId
        ) {

          user.privileges_role =
            socketUser.role;

          user.parent =
            socketUser.parent;
        }


        /*
         * Same UserAccess query
         */

        const userAccess =
          await UserAccess.findOne({
            userId: id,
          }).lean();


        /*
         * Same Utils.cleanUser
         */

        user =
          await Utils.cleanUser(
            user,
            fields
          );


        /*
         * Same commission
         */

        user.commission =
          userAccess?.commission ??
          true;


        /*
         * Same interCasino
         */

        user.interCasino =
          userAccess?.interCasino ??
          true;


        /*
         * Socket response
         *
         * REST:
         * res.status(200).send(
         *   new APIResponse(
         *     user,
         *     "User fetched",
         *     200
         *   )
         * )
         */

        return socket.emit(
          "getByIdResponse",
          {
            status:
              httpStatus.OK,

            data:
              user,

            message:
              "User fetched",
          }
        );

      } catch (err) {

        console.error(
          "getById socket error:",
          err
        );


        /*
         * Socket equivalent of next(err)
         */

        return socket.emit(
          "getByIdError",
          {
            status:
              httpStatus.INTERNAL_SERVER_ERROR,

            message:
              err?.message ||
              "Failed to fetch user",
          }
        );
      }

    });

  });
};


module.exports =
  registerGetByIdSocket;