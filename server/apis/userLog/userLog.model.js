const mongoose = require("mongoose");
const { getCache, setCache, delCache } = require("../../helpers/cache");

const CACHE_KEY_ALL = "userlogs:all";

const UserLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    username: { type: String, required: true },
    ip: { type: String },
    type: { type: String, enum: ["login", "change_password", "partnership-update"], required: true },
    browserDetails: { type: String },
    isUser: { type: Boolean, default: true },
    remark: { type: String },
    data: { type: Object },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

let originalFind = null;
let originalFindOne = null;

UserLogSchema.statics.refreshCache = async function () {
  if (!originalFind) originalFind = this.find.bind(this);
  const logs = await originalFind().sort({ createdAt: -1 }).limit(500);
  await setCache(CACHE_KEY_ALL, logs, 50000);
  return logs;
};

UserLogSchema.statics.getAllWithCache = async function () {
  const cached = await getCache(CACHE_KEY_ALL);
  if (cached) return cached;
  return await this.refreshCache();
};

UserLogSchema.statics.getByUserWithCache = async function (userId) {
  const key = `userlog:${userId}`;
  const cached = await getCache(key);
  if (cached) return cached;

  if (!originalFind) originalFind = this.find.bind(this);

  const docs = await originalFind({ userId })
    .sort({ createdAt: -1 })
    .limit(100);

  if (docs.length > 0) {
    await setCache(key, docs, 50000);
  }
  return docs;
};

async function refreshAndClear(doc) {
  await doc.constructor.refreshCache();
  if (doc.userId) {
    await delCache(`userlog:${doc.userId}`);
  }
}

UserLogSchema.post("save", refreshAndClear);

UserLogSchema.statics.enableCache = function () {
  if (!originalFind) {
    originalFind = this.find.bind(this);
    originalFindOne = this.findOne.bind(this);
  }
};

module.exports = mongoose.model("UserLog", UserLogSchema);
