const WebSocket = require("ws");
const EventEmitter = require("events");

const {
  setCache,
} = require("../helpers/cache");

const INACTIVE_TIMEOUT = 10 * 60 * 1000;

class GameDataManager extends EventEmitter {
  constructor() {
    super();

    /*
     * One entry per gmid + etid.
     *
     * Example:
     *
     * 462855645:4
     *
     * {
     *   ws,
     *   inactiveSince,
     *   subscribers: Set()
     * }
     */
    this.activeGames = new Map();

    setInterval(() => {
        this.cleanupInactiveGames();
    }, 60 * 1000);
  }

  getGameKey(gmid, etid) {
    return `${gmid}:${etid}`;
  }

  getRedisKey(gmid, etid) {
    return `gamedata:${gmid}:${etid}`;
  }

  async ensureConnection(gmid, etid, socketId) {
    const gameKey =
      this.getGameKey(gmid, etid);

    let game =
      this.activeGames.get(gameKey);

    /*
     * ============================================================
     * ALREADY ACTIVE
     * ============================================================
     */

    if (game) {
      if (socketId) {
        game.subscribers.add(socketId);

        // Game is active again.
        // Cancel inactive timer.
        game.inactiveSince = null;
      }



      return game;
    }

    /*
     * ============================================================
     * CREATE NEW UPSTREAM CONNECTION
     * ============================================================
     */


    const wsUrl =
      `ws://68.183.90.58:9000/ws/gamedataPrivate` +
      `?gmid=${encodeURIComponent(gmid)}` +
      `&etid=${encodeURIComponent(etid)}` +
      `&key=${encodeURIComponent(
        process.env.JSK_KEY || ""
      )}`;



    const upstreamWs =
      new WebSocket(wsUrl);

    game = {
      gmid,
      etid,
      ws: upstreamWs,
      inactiveSince: null,
      subscribers: new Set(),
    };

    if (socketId) {
      game.subscribers.add(socketId);
    }

    this.activeGames.set(
      gameKey,
      game
    );

    /*
     * ============================================================
     * CONNECTED
     * ============================================================
     */


    /*
     * ============================================================
     * DATA RECEIVED
     * ============================================================
     */

    upstreamWs.on(
      "message",
      async (message) => {
        try {
          const response =
            JSON.parse(
              message.toString()
            );

          const data =
            response?.data;

          const currentGame =
            this.activeGames.get(
              gameKey
            );

          if (!currentGame) {
            return;
          }

          /*
           * Ignore upstream messages that do not
           * contain actual game data.
           */
          if (data === undefined) {


            return;
          }

          /*
           * ======================================================
           * VALID GAME DATA RECEIVED
           * ======================================================
           */

          const redisKey =
            this.getRedisKey(
              gmid,
              etid
            );

            data.lastUpdatedAt = response?.lastUpdatedAt;

          /*
           * Save the latest valid game data.
           */
          await setCache(
            redisKey,
            data
          );

          /*
           * Tell socket layer that new game data
           * is available.
           */
          this.emit(
            "gamedata",
            {
              gmid,
              etid,
              data,
            }
          );

        } catch (error) {
          console.error(
            `UPSTREAM DATA ERROR: ${gameKey}`,
            error
          );

          this.emit(
            "gamedataError",
            {
              gmid,
              etid,
              error,
            }
          );
        }
      }
    );

    /*
     * ============================================================
     * ERROR
     * ============================================================
     */

    upstreamWs.on(
      "error",
      (error) => {
        console.error(
          `UPSTREAM WEBSOCKET ERROR: ${gameKey}`,
          error
        );

        this.emit(
          "gamedataError",
          {
            gmid,
            etid,
            error,
          }
        );
      }
    );

    /*
     * ============================================================
     * CLOSED
     * ============================================================
     */

    upstreamWs.on(
      "close",
      () => {


        const currentGame =
          this.activeGames.get(
            gameKey
          );

        if (
          currentGame &&
          currentGame.ws === upstreamWs
        ) {
          this.activeGames.delete(
            gameKey
          );
        }
      }
    );

    return game;
  }

  /*
   * ============================================================
   * REMOVE SUBSCRIBER
   * ============================================================
   */

  removeSubscriber(
    gmid,
    etid,
    socketId
  ) {
    const gameKey =
      this.getGameKey(
        gmid,
        etid
      );

    const game =
      this.activeGames.get(
        gameKey
      );

    if (!game) {
      return;
    }

    game.subscribers.delete(
      socketId
    );

    /*
     * Nobody is watching this game anymore.
     * Start the 10-minute inactive timer.
     */
    if (
      game.subscribers.size === 0
    ) {
      game.inactiveSince =
        Date.now();


    }


  }

  /*
   * ============================================================
   * CLEANUP INACTIVE GAMES
   * ============================================================
   */

  cleanupInactiveGames() {
    const now = Date.now();

    for (
      const [
        gameKey,
        game,
      ]
      of this.activeGames.entries()
    ) {

      /*
       * Someone is still using this game.
       */
      if (
        game.subscribers.size > 0
      ) {
        continue;
      }

      /*
       * No subscribers.
       * Check whether the 10-minute timer has expired.
       */
      if (
        game.inactiveSince
      ) {

        const inactiveFor =
          now -
          game.inactiveSince;
        


        if (
          inactiveFor >=
          INACTIVE_TIMEOUT
        ) {



          try {

            if (
              game.ws.readyState ===
                WebSocket.OPEN ||
              game.ws.readyState ===
                WebSocket.CONNECTING
            ) {
              game.ws.close();
            }

          } catch (error) {

            console.error(
              `ERROR CLOSING ${gameKey}:`,
              error
            );
          }

          this.activeGames.delete(
            gameKey
          );
        }
      }
    }
  }
}

module.exports =
  new GameDataManager();