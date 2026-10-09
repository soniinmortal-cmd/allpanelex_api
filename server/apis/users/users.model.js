const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;
const CreateUser = mongoose.Schema(
  {
    email: { type: String },
    currentToken: { type: String },
    name: {
      type: String,
    },
    username: {
      type: String,
    },

    softApiId: {
      type: String,
      unique: true,
      sparse: true,
      index:true
    },
    
    city: {
      type: String,
    },
    balance: {
      type: Number,
      default: 0,
      set: v => Number(Number(v).toFixed(2)),
    },
    exp: {
      type: Number,
      default: 0,
      set: v => Number(Number(v).toFixed(2)),
    },
    
    exp_limit: {
      type: Number,
      default: 0,
    },
    userCR: {
      type: Number,
      default: 0,
    },
    remark: {
      type: String,
    },
    password: { type: String },
    phone: {
      type: String,
      // unique: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    registration_user_master: {
      type: Boolean,
      default: false,
    },
    transaction_pin: {
      type: Number,
      default: 0,
    },
    role: {
      type: String,
      enum: [
        "owner",
        "super-admin",
        "admin",
        "sub-admin",
        "super-master",
        "master",
        "user",
        "demo",
        "sub-user",
      ],
      default: "user",
    },
    parent: {
      type: ObjectId,
      ref: "Users",
      default: null,
    },
    masterId: {
      type: ObjectId,
      ref: "Users",
      default: null,
    },
    partnerLevel: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },
    usedSeats: {
      type: Number,
      default: 0,
    },
    seat: {
      type: Number,
      default: 100,
    },
    commission: {
      type: Number,
      default: 0,
    },
    partnershipValue: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // partnership: [
    //   {
    //     userId: {
    //       type: mongoose.Schema.Types.ObjectId,
    //       ref: "User",
    //       required: true,
    //     },
    //     commission: {
    //       type: Number,
    //       required: true,
    //       default: 0,
    //     },
    //     downLineCommission: {
    //       type: Number,
    //       required: true,
    //       default: 0,
    //     },
    //   },
    // ],
    domain: [
      {
        type: String,
      },
    ],
    privileges: {
      dashboard: { type: Boolean, default: false },
      createAccount: { type: Boolean, default: false },
      insertUser: { type: Boolean, default: false },
      zeroBalanceUsers: { type: Boolean, default: false },
      withdrawRequests: { type: Boolean, default: false },
      accountStatement: { type: Boolean, default: false },
      adminMatchPLResult: { type: Boolean, default: false },
      userHistory: { type: Boolean, default: false },
      liveCasinoReport: { type: Boolean, default: false },
      casinoList: { type: Boolean, default: false },
      pCasinoList: { type: Boolean, default: false },
      events: { type: Boolean, default: false },
      cricketListing: { type: Boolean, default: false },
      tennisListing: { type: Boolean, default: false },
      bank: { type: Boolean, default: false },
      secureAuth: { type: Boolean, default: false },
      users: { type: Boolean, default: false },
      inactiveUsers: { type: Boolean, default: false },
      gameDetails: { type: Boolean, default: false },
      depositRequests: { type: Boolean, default: false },
      clientProfitLoss: { type: Boolean, default: false },
      profitLoss: { type: Boolean, default: false },
      userLock: { type: Boolean, default: false },
      turnover: { type: Boolean, default: false },
      vCasinoList: { type: Boolean, default: false },
      tCasinoList: { type: Boolean, default: false },
      casinoDetail: { type: Boolean, default: false },
      electionsListing: { type: Boolean, default: false },
      privilegeList: { type: Boolean, default: false },
      blockMarket: { type: Boolean, default: false },
      marketAnalysis: { type: Boolean, default: false },
      partnerAccountList: { type: Boolean, default: false },
      deletedUsers: { type: Boolean, default: false },
      managePayment: { type: Boolean, default: false },
      cheatBet: { type: Boolean, default: false },
      sportProfitLoss: { type: Boolean, default: false },
      currentBets: { type: Boolean, default: false },
      casinoResult: { type: Boolean, default: false },
      authList: { type: Boolean, default: false },
      casinoVip: { type: Boolean, default: false },
      lineMarketList: { type: Boolean, default: false },
      casinoListing: { type: Boolean, default: false },
      soccerListing: { type: Boolean, default: false },
      privilegeCreate: { type: Boolean, default: false },
      clientTrack: { type: Boolean, default: false },
      bettingListing: { type: Boolean, default: false },
      onlineDepositWithdraw: { type: Boolean, default: false },
      addSports: { type: Boolean, default: false },
      casinoMainMarket: { type: Boolean, default: false },
      addCasino: { type: Boolean, default: false },
      sportMainMarket: { type: Boolean, default: false },
      manageHistory: { type: Boolean, default: false },
      manageMatch: { type: Boolean, default: false },
      manageFancy: { type: Boolean, default: false },
      fancyHistory: { type: Boolean, default: false },
      managePrefix: { type: Boolean, default: false },
      manageBanner: { type: Boolean, default: false },
      partnerShip: { type: Boolean, default: false },
    },
    isLogin: {
      type: Boolean,
      default: false,
    },
    isAcceptRules: {
      type: Boolean,
      default: false,
    },
    depositRequestsCount: {
      type: Number,
      default: 0,
    },
    withdrawRequestsCount: {
      type: Number,
      default: 0,
    },
    userLock: {
      type: Boolean,
      default: false,
    },
    betLock: {
      type: Boolean,
      default: false,
    },

    ////new fields
    shareType: {
        type: String,
      },

      // myMatchShare: {
      //   type: Number,
      //   default: 0,
      // },

      // myCommType: {
      //   type: String,
      // },

      // matchShare: {
      //   type: Number,
      //   default: 0,
      // },

      // commType: {
      //    type: String,
      // },

      // myCasinoShare: {
      //   type: Number,
      //   default: 0,
      // },

      // casinoShare: {
      //   type: Number,
      //   default: 0,
      // },
      
      // coins: {
      //   type: Number,
      //   default: 0,
      //   set: v => Number(Number(v).toFixed(2)),
      // },
  },
  {
    timestamps: true,
  }
);

// module.exports = new mongoose.model("Users", CreateUser);
module.exports = mongoose.model("Users", CreateUser);
