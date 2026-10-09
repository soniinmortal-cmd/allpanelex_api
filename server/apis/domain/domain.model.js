const mongoose = require("mongoose");
const { getCache, setCache, delCache } = require("../../helpers/cache");

const CACHE_KEY_ALL = "domains:active";

const DomainSchema = new mongoose.Schema(
  {
    isActive: {
      type: Boolean,
      default: true,
    },
    domain: { type: String },
    title: { type: String },
    theme: { type: String, default: "" },
    logo: { type: String },
    login_logo: { type: String },
    favicon: { type: String },
    user_announcement: { type: String },
    backend_announcement: { type: String },
    maintenance_mode: { type: Boolean, default: false },
    maintenance_message: { type: String },
    maintenance_deadline: { type: Date, default: null },
    security_password: { type: String },
    site_login_image: { type: String },
    site_live_mode: { type: Boolean, default: false },
    force_change_password: { type: Boolean, default: true },
    isTransactionpassword: {
        type: Boolean,
        default: true,
    },

    isSeat: {
      type: Boolean,
      default: true,
    },
    isMatchLock: {
      type: Boolean,
      default: true,
    },

    autoEnable: {
      type: Boolean,
      default: false,
    },


    online_deposit_withdrawal: { type: Boolean, default: true },
    domain_scheme: { type: Map, of: String, default: {} },
    show_login_page: { type: Boolean, default: false },
    show_other_fancies: { type: Boolean, default: false },
    hide_register_page: { type: Boolean, default: false },
    api_data_type: {
      type: String,
      enum: ["OLD_DIAMOND", "NEW_DIAMOND"],
      default: "OLD_DIAMOND",
    },
    api_casino_video: { type: String },

    isCasinoThirdParty: {
      type: Boolean,
      default: false,
    },

    video_link_type: {
      type: String,
      enum: ["NEW_VIDEO", "OLD_VIDEO"],
      default: "NEW_VIDEO",
    },
    socialLinks: {
      facebook: { type: String, trim: true },
      instagram: { type: String, trim: true },
      telegram: { type: String, trim: true },
      twitter: { type: String, trim: true },
      whatsapp: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

let originalFind = null;
let originalFindOne = null;

/**
 * 🔹 Refresh cache with latest active domains
 * (always hit MongoDB directly, bypass patched find)
 */
DomainSchema.statics.refreshCache = async function () {
  if (!originalFind) {
    originalFind = this.find.bind(this);
  }
  const domains = await originalFind({ isActive: true });
  await setCache(CACHE_KEY_ALL, domains, 50000); // TTL ~50s
  console.log("✅ Domain cache refreshed with", domains.length, "records");
  return domains;
};

/**
 * 🔹 Get all domains (cache first, fallback DB)
 */
DomainSchema.statics.getAllWithCache = async function () {
  const cached = await getCache(CACHE_KEY_ALL);
  if (cached) return cached;
  return await this.refreshCache();
};

/**
 * 🔹 Get single domain (cache per-domain key)
 */
DomainSchema.statics.getByDomainWithCache = async function (domain) {
  const key = `domain:${domain}`;
  const cached = await getCache(key);
  if (cached) return cached;

  if (!originalFindOne) {
    originalFindOne = this.findOne.bind(this);
  }

  const doc = await originalFindOne({ domain, isActive: true });
  if (doc) {
    await setCache(key, doc, 50000);
  }
  return doc;
};

/**
 * 🔹 Middleware: keep cache in sync after save/update/delete
 */
async function refreshAndClear(doc) {
  await doc.constructor.refreshCache();
  if (doc.domain) {
    await delCache(`domain:${doc.domain}`);
  }
}

DomainSchema.post("save", refreshAndClear);
DomainSchema.post("findOneAndUpdate", refreshAndClear);
DomainSchema.post("findOneAndDelete", refreshAndClear);
DomainSchema.post("findByIdAndDelete", refreshAndClear);

/**
 * 🔹 Monkey-patch .find and .findOne
 */
DomainSchema.statics.enableCache = function () {
  if (!originalFind) {
    originalFind = this.find.bind(this);
    originalFindOne = this.findOne.bind(this);

    // Patch .find()
    this.find = async function (conditions = {}, ...args) {
      if (
        Object.keys(conditions).length === 1 &&
        conditions.isActive === true
      ) {
        const cached = await getCache(CACHE_KEY_ALL);
        if (cached) return cached;
        const data = await originalFind(conditions, ...args);
        await setCache(CACHE_KEY_ALL, data, 50000);
        return data;
      }
      return originalFind(conditions, ...args);
    };

    // Patch .findOne()
    this.findOne = async function (conditions = {}, ...args) {
      if (conditions.domain && conditions.isActive === true) {
        const key = `domain:${conditions.domain}`;
        const cached = await getCache(key);
        if (cached) return cached;

        const data = await originalFindOne(conditions, ...args);
        if (data) await setCache(key, data, 50000);
        return data;
      }
      return originalFindOne(conditions, ...args);
    };
  }
};

module.exports = mongoose.model("Domain", DomainSchema);
