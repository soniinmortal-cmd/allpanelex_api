const express = require("express");
const logger = require("morgan");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const compress = require("compression");
const methodOverride = require("method-override");
const cors = require("cors");
const httpStatus = require("http-status");
const expressWinston = require("express-winston");
const expressValidation = require("express-validation");

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const hpp = require("hpp");
const winstonInstance = require("./winston");
const routes = require("../index.route");
const config = require("./config");
const APIError = require("../server/helpers/APIError");
const Path = require("path");
const { requireDomain } = require("../server/Middleware/domain.middleware");
const { initialSetup } = require("../server/apis/users/users.controller");
const encryptionMiddleware = require("../server/Middleware/encryption.middleware");

const { getClientIp, httpsApiRequest } = require("../server/helpers/utils");
const fancyResultCallback = require("../server/helpers/thirdPartyResultCron");



const app = express();
app.set("trust proxy", true);

const imagesRoot = Path.join(__dirname, "..", "server", "uploads");


// 1. Static files
app.use(
  "/uploads",
  express.static(imagesRoot, {
    etag: false,
    lastModified: false,
    maxAge: 0,
    cacheControl: false,
  })
);

// 2. Logger (Dev)
if (config.env === "development") {
  app.use(logger("dev"));
}

// 3. Security Headers (Helmet) - Should be early
app.use(helmet({
  frameguard: false,
}));

// 4. CORS - Must be before routers and potential errors
const corsOptions = {
  origin: (origin, callback) => {
    // allow non-browser requests with no origin (curl, server-to-server)
    if (!origin) return callback(null, true);
    const allowed = config?.allowedOrigins?.split(",")?.map((c) => c?.trim());
    if (allowed?.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders:
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 600, // cache OPTIONS for 600 seconds (10 minutes)
};

app.use(cors(corsOptions));


// app.use(cors({
//   origin: "https://sportexchange.online/sport/",
//   credentials: true
// }));
 

// SHORTCIRCUIT OPTIONS — put this immediately after app.use(cors(corsOptions))
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = config?.allowedOrigins?.split(",")?.map((c) => c?.trim());
  if (origin && allowed?.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
  );
  res.setHeader("Access-Control-Max-Age", String(corsOptions.maxAge || 600));

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});


// 5. Rate Limiting
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 500, // limit each IP to 500 requests per windowMs
//   message: "Too many requests from this IP, please try again after 15 minutes",
// });
// app.use("/api", limiter);

// 6. Body Parsing (using express built-in)
app.use(
  express.json({
    limit: "50mb",
  })
);
app.use(
  express.urlencoded({
    parameterLimit: 100000,
    limit: "50mb",
    extended: true,
  })
);

// ===== API LATENCY MONITOR =====
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const ms =
      Number(process.hrtime.bigint() - start) / 1e6;

    if (ms >= 500) {
      console.warn(
        `[SLOW API] ${req.method} ${req.originalUrl} ` +
        `${ms.toFixed(0)}ms STATUS=${res.statusCode}`
      );
    }
  });

  next();
});

app.use(cookieParser());
app.use(compress());
app.use(methodOverride());

// 7. Sanitization (must be AFTER body parsing)
// Data sanitization against NoSQL query injection
// Custom middleware to support Express 5 (req.query is read-only)
app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (key.startsWith('$')) {
          delete obj[key];
        } else {
          sanitize(obj[key]);
        }
      }
    }
  };

  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  if (req.params) sanitize(req.params);
  next();
});

// Data sanitization against XSS
// app.use(xss());

// Prevent parameter pollution
// app.use(hpp());

// 8. Cache Control
app.use((req, res, next) => {
  req.clientIp = getClientIp(req);
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

//app.set("trust proxy", true);

app.route("/api/initial-setup").get(initialSetup);

const validOrigin = (s) => {
  if (!s) return false;
  s = s.trim();
  if (!s) return false;
  if (s === "'self'" || s === "self" || s === "'unsafe-inline'") return true;
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/.test(s);
};

// --- Configuration ---
// const casinoVideo = async (req, res, next) => {
//   try {
//     const { type } = req.params;
//     const referer = req.headers.referer;
//     if (!referer) {
//       return res.status(404).send("");
//     }
//     const baseUrl = process.env.JSK_CASINO_SERVER_URL;

//     if (!baseUrl) {
//       throw new Error("***_SERVER_URL is not defined in environment variables");
//     }

//     const cleanBase = baseUrl.replace(/\/$/, "");
//     const targetUrl = `${cleanBase}/video/${type}`;
//     const apiResponse = await httpsApiRequest({
//       url: targetUrl,
//       method: "GET",
//     });
//     const raw =
//       config && config.allowedOrigins ? String(config.allowedOrigins) : "";
//     const parts = raw
//       .split(",")
//       .map((p) => p.trim())
//       .filter(Boolean);
//     const origins = parts
//       .map((p) => {
//         if (validOrigin(p)) return p === "self" ? "'self'" : p;
//         if (/^[a-z0-9.-]+$/i.test(p)) return `https://${p}`;
//         return null;
//       })
//       .filter(Boolean);

//     if (!origins.includes("'self'")) origins.unshift("'self'");

//     const cspParts = [];
//     cspParts.push(`frame-ancestors ${origins.join(" ")}`);
//     cspParts.push(`default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: *`);
//     const secPolicy = cspParts.join("; ") + ";"; // yields single-line header

//     if (/[\r\n]/.test(secPolicy)) {
//       res.setHeader("Content-Security-Policy", "default-src 'self';");
//     } else {
//       res.setHeader("Content-Security-Policy", secPolicy);
//     }

//     res.setHeader("Content-Type", "text/html; charset=utf-8");
//     // res.setHeader("X-Skip-Encryption", "1");
//     res.locals = res.locals || {};
//     res.locals.skipEncryption = true;
//     res.status(httpStatus.OK).send(apiResponse);
//   } catch (err) {
//     next(err);
//   }
// };
const casinoVideo = async (req, res, next) => {
  try {
    const { type } = req.params;

    const url = `https://casino-stream-v2.cricketid.xyz/casino-tv?id=${type}`;

    return res.redirect(url); // 🔥 SIMPLE & CORRECT
  } catch (err) {
    next(err);
  }
};
const virtualVideo = async (req, res, next) => {
  try {
    const { type } = req.params;
    const baseUrl = process.env.JSK_SERVER_URL;

    if (!baseUrl) {
      throw new Error("JSK_SERVER_URL is not defined in environment variables");
    }

    const cleanBase = baseUrl.replace(/\/$/, "");
    const targetUrl = `${cleanBase}/video/virtualcricket1/${type}?page=/virtual-cricket/${type}`;
    const apiResponse = await httpsApiRequest({
      url: targetUrl,
      method: "GET",
    });
    const raw =
      config && config.allowedOrigins ? String(config.allowedOrigins) : "";
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const origins = parts
      .map((p) => {
        if (validOrigin(p)) return p === "self" ? "'self'" : p;
        if (/^[a-z0-9.-]+$/i.test(p)) return `https://${p}`;
        return null;
      })
      .filter(Boolean);

    if (!origins.includes("'self'")) origins.unshift("'self'");

    const cspParts = [];
    cspParts.push(`frame-ancestors ${origins.join(" ")}`);
    cspParts.push(`default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: *`);
    const secPolicy = cspParts.join("; ") + ";"; // yields single-line header

    if (/[\r\n]/.test(secPolicy)) {
      res.setHeader("Content-Security-Policy", "default-src 'self';");
    } else {
      res.setHeader("Content-Security-Policy", secPolicy);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.locals = res.locals || {};
    res.locals.skipEncryption = true;
    res.status(httpStatus.OK).send(apiResponse);
  } catch (err) {
    next(err);
  }
};

const liveStreamingVideo = async (req, res, next) => {
  try {
    const { type } = req.params;
    const referer = req.headers.referer;
    if (!referer) {
      return res.status(404).send("");
    }
    const baseUrl = process.env.JSK_LIVESTREAM_URL || process.env.JSK_SERVER_URL;

    if (!baseUrl) {
      throw new Error("JSK_LIVESTREAM_URL is not defined in environment variables");
    }

    const cleanBase = baseUrl.replace(/\/$/, "");
    const targetUrl = `${cleanBase}/livestream/${type}`;
    const apiResponse = await httpsApiRequest({
      url: targetUrl,
      method: "GET",
    });
    const raw =
      config && config.allowedOrigins ? String(config.allowedOrigins) : "";
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const origins = parts
      .map((p) => {
        if (validOrigin(p)) return p === "self" ? "'self'" : p;
        if (/^[a-z0-9.-]+$/i.test(p)) return `https://${p}`;
        return null;
      })
      .filter(Boolean);

    if (!origins.includes("'self'")) origins.unshift("'self'");

    const cspParts = [];
    cspParts.push(`frame-ancestors ${origins.join(" ")}`);
    cspParts.push(`default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: *`);
    const secPolicy = cspParts.join("; ") + ";"; // yields single-line header

    if (/[\r\n]/.test(secPolicy)) {
      res.setHeader("Content-Security-Policy", "default-src 'self';");
    } else {
      res.setHeader("Content-Security-Policy", secPolicy);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // res.setHeader("X-Skip-Encryption", "1");
    res.locals = res.locals || {};
    res.locals.skipEncryption = true;
    res.status(httpStatus.OK).send(apiResponse);
  } catch (err) {
    next(err);
  }
};

const downloadApk = (req, res, next) => {
  try {
    const apkPath = Path.join(
      __dirname,
      "..",
      "server",
      "uploads",
      "apk",
      "secureAuthApp.apk"
    );

    return res.download(apkPath, "secureAuthApp.apk");
  } catch (err) {
    next(err);
  }
};

const downloadSportsExchangeApk = (req, res, next) => {
  try {
    const apkPath = Path.join(
      __dirname,
      "..",
      "server",
      "uploads",
      "apk",
      "sportsexchange9.apk"
    );

    return res.download(apkPath, "sportsexchange9.apk");
  } catch (err) {
    next(err);
  }
};

// NOTE: These routes MUST be registered BEFORE requireDomain and encryptionMiddleware
app.get("/api/video/virtual/:type", virtualVideo);
app.get("/api/video/:type", casinoVideo);
app.get("/api/livestream/:type", liveStreamingVideo);
app.get("/api/apk/download", downloadApk);
app.get("/api/apk/sportsexchange9-download", downloadSportsExchangeApk);
app.get("/api/admin/apk/download", downloadApk);

const softApiRoutes =
  require("../server/apis/softapi/softapi.routes");
 
const secureAuthRoutes = require('../server/apis/secureAuth/secureAuth.routes');

const pendingbets = require('../server/helpers/pendingbets.routes');

app.use(
  "/api/pendingbets",
  pendingbets
);
 
app.use(
  "/api/softapi",
  softApiRoutes
);

app.use(
  "/api/admin/softapi",
  softApiRoutes
);
 
app.use(
  "/api/secure-auth",
  secureAuthRoutes
);

app.use(
  "/api/admin/secure-auth",
  secureAuthRoutes
);

app.use("/api/fancyCallback",fancyResultCallback.fancyResultCallback);


// License guard — blocks ALL API routes if license is inactive (after 6h grace period)


app.use(requireDomain);
app.use(encryptionMiddleware);
app.use("/api", routes);
app.use("/api/admin", routes);
// app.use("/admin", routes);

// enable detailed API logging in dev env
if (config.env === "development") {
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    winstonInstance.error(`${req.method} ${req.originalUrl} [${status}] - ${err.message}`);
    next(err);
  });
}

// if error is not an instanceOf APIError, convert it.
app.use((err, req, res, next) => {
  if (err instanceof expressValidation.ValidationError) {
    const unifiedErrorMessage = err.errors
      .map((error) => error.messages.join(". "))
      .join(" and ");
    const error = new APIError(unifiedErrorMessage, err.status, true);
    return next(error);
  } else if (!(err instanceof APIError)) {
    const apiError = new APIError(err.message, err.status, err.isPublic);
    return next(apiError);
  }
  return next(err);
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  const err = new APIError("API not found", httpStatus.NOT_FOUND);
  return next(err);
});

// log error in winston transports except when executing test suite
if (config.env !== "test") {
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    winstonInstance.error(`${req.method} ${req.originalUrl} [${status}] - ${err.message}`);
    next(err);
  });
}

// error handler, send stacktrace only during development
app.use(
  (
    err,
    req,
    res,
    next // eslint-disable-line no-unused-vars
  ) =>
    res.status(err.status).json({
      message: err.isPublic ? err.message : httpStatus[err.status],
      stack: config.env === "development" ? err.stack : {},
    })
);

module.exports = app;
