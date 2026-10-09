const mongoose = require("mongoose");
const Schema = mongoose.Schema;
// const ObjectId = Schema.Types.ObjectId;

const GamesSchema = new mongoose.Schema(
  {
    gid: Number,
    gname: String,
    gtid: Number,
    imgpath: String,
    isframe: Number,
    srno: Number,
    tabno: Number,
    tid: Number,
    gmid: Schema.Types.Mixed,
    ename: String,
    etid: Number,
    cid: Number,
    cname: String,
    iplay: Boolean,
    stime: String, // could also use Date if formatted
    tv: Boolean,
    bm: Boolean,
    f: Boolean,
    f1: Boolean,
    iscc: Number,
    mid: Number,
    mname: String,
    status: String,
    rc: Number,
    gscode: Number,
    m: Number,
    oid: Number,
    gtype: String,
    domain: String,
    imgUrl: String,
    isActive: {
      type: Boolean,
      default: true,
    },
    bet_config: {
      match: { type: Boolean, default: true },
      tiedMatch: { type: Boolean, default: true },
      match1: { type: Boolean, default: true },
      fancy: { type: Boolean, default: true },
      fancyBallByBall: { type: Boolean, default: true },
      fancyOverByOver: { type: Boolean, default: true },
      fancy3: { type: Boolean, default: true },
      khado: { type: Boolean, default: true },
      fancy1: { type: Boolean, default: true },
      oddeven: { type: Boolean, default: true },
      cricketcasino: { type: Boolean, default: true },
      meter: { type: Boolean, default: true },
    },
    bet_limit: {
      match: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      tiedMatch: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      match1: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      fancy: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      fancyBallByBall: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },

      fancyOverByOver: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      fancy3: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      khado: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      fancy1: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      oddeven: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      cricketcasino: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      meter: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
      casino: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
    },
    section: [
      {
        teamName: { type: String },
        sid: { type: Number },
      },
    ],
    result: Number,
  },
  { timestamps: true }
);
GamesSchema.index({ gmid: 1, domain: 1 }, { unique: true });



module.exports = mongoose.model("Game", GamesSchema);
