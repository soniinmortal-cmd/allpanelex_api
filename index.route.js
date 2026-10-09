const express = require('express');
const glob = require('glob');
const path = require('path');
const logger = require('./config/winston');

const router = express.Router(); // eslint-disable-line new-cap

/** GET /health-check - Check service health */
router.get('/health-check', (req, res) =>
  res.send('OK')
);

// Mount routes defined in *.route.js files
mountRoutes();

/**
* Mounts all routes defined in *.route.js files in server/
* @example
*   auth.route.js routes will be mounted to /auth
* @example
*   user.test.js routes will be mounted to /users
*/
// function mountRoutes() {
//   // Route definitions
//   const files = glob.sync('server/apis/**/*.route.js');
//   // Mount routes for each file
//   files.forEach((routeFilename) => {
//     const routes = require(`./${routeFilename}`); // eslint-disable-line global-require

//     // Create the url using the first part of the filename
//     // e.g. auth.route.js will generate /auth
//     const routeName = path.basename(routeFilename, '.route.js');
//     const url = `/${routeName}`;
//     // Mount the routes
//     logger.info(`${path.basename(routeFilename)} -> ${url}`);
//     // console.log(`${path.basename(routeFilename)} -> ${url}`);
//     router.use(url, routes);
//   });
// }

function mountRoutes() {
  const files = glob.sync("server/apis/**/*.route.js");

  files.forEach((routeFilename) => {
    const routes = require(path.resolve(routeFilename));

    // relative path inside server/apis
    let relativePath = path.relative("server/apis", routeFilename);

    // remove .route.js
    relativePath = relativePath.replace(/\.route\.js$/, "");

    // handle [param].route.js -> :param
    relativePath = relativePath.replace(/\[(.+?)\]/g, ":$1");

    // normalize slashes
    let url = "/" + relativePath.replace(/\\/g, "/");

    // 🩹 FIX: if folder name === file name, strip duplicate
    // e.g. "auth/auth" -> "auth", "bet/bet" -> "bet"
    const parts = url.split("/");
    if (parts.length === 3 && parts[1] === parts[2]) {
      url = "/" + parts[1];
    }

    logger.info(`${relativePath} -> ${url}`);
    router.use(url, routes);
  });
}

module.exports = router;
